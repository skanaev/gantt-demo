import { Checkbox, Option, T, Tag } from "@admiral-ds/react-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Gantt from "frappe-gantt";
import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  DEMO_STAGES_DATA_URL,
  fetchStagesFromSource,
  PROCESS_UPDATE_API_BASE_DEFAULT_URL,
  resolveStagesDataMode,
  STAGES_API_DEFAULT_URL,
  STAGES_POLL_INTERVAL_MS,
  updateProcessOnApi,
} from "./api";
import { ProcessDetailsModal } from "./ProcessDetailsModal";
import { ProcessTooltip } from "./ProcessTooltip";
import type {
  GanttViewMode,
  ManualGanttViewMode,
  PendingProcessUpdate,
  ProcessPatch,
  Stage,
  StageTaskViewModel,
  TooltipState,
} from "./types";
import {
  applyProcessPatchToStages,
  areFrappeTasksEqual,
  cloneStages,
  countTimelineUnitsForMode,
  computeTimelinePadding,
  type FrappeTaskModel,
  resolveTimelinePaddingForMode,
  toFrappeTask,
  toStageTaskViewModel,
} from "./utils";
import {
  ChartViewport,
  Controls,
  GanttChromeStyle,
  HeaderBlock,
  LiveToggle,
  MetricCard,
  MetricsGrid,
  MetricValue,
  ModeField,
  Root,
  StatusRow,
  Toolbar,
} from "./styles";
import { VIEW_MODE_LABEL_BY_VALUE } from "./presentation";
import "./styles.css";

const VIEW_MODE_OPTIONS: { value: GanttViewMode; label: string }[] = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const THROTTLE_MS = 250;
const TOOLTIP_CLOSE_DELAY_MS = 180;
const NOW_LINE_REFRESH_MS = 60_000;
const STAGES_QUERY_RETRY_COUNT = 2;
const GANTT_CONTAINER_HEIGHT_PX = 500;
const DEFAULT_TIMELINE_RIGHT_AIR_HOURS = 0;
const EMPTY_HEADER_CELL = "\u00A0";
const DAY_MODE_SIDE_PADDING_PX = 32;
const INITIAL_HOUR_BAR_OFFSET_PX = 56;

const parseNonNegativeNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const TIMELINE_RIGHT_AIR_HOURS = parseNonNegativeNumber(
  import.meta.env.VITE_GANTT_TIMELINE_RIGHT_AIR_HOURS as string | undefined,
  DEFAULT_TIMELINE_RIGHT_AIR_HOURS,
);

const cloneTask = (task: FrappeTaskModel): FrappeTaskModel => ({ ...task });

const toFrappeTaskWithinTimeline = (task: StageTaskViewModel, desiredStart: Date | null): FrappeTaskModel => {
  if (!desiredStart || task.start.getTime() >= desiredStart.getTime()) {
    return toFrappeTask(task);
  }

  const durationMs = Math.max(60_000, task.end.getTime() - task.start.getTime());
  const clampedStart = new Date(desiredStart.getTime());
  const clampedEnd = new Date(clampedStart.getTime() + durationMs);

  return toFrappeTask({
    ...task,
    start: clampedStart,
    end: clampedEnd,
  });
};

const emptyTooltipState: TooltipState = {
  open: false,
  stageId: null,
  targetElement: null,
};

const stageIdFromTarget = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const wrapper = target.closest<HTMLElement>(".bar-wrapper[data-id]");
  return wrapper?.dataset.id ?? null;
};

interface ProcessUpdateMutationInput {
  stageId: string;
  processId: string;
  patch: ProcessPatch;
  rollbackStages: Stage[];
}

interface FrappeBarLike {
  gantt: Gantt;
  task: {
    _start: Date;
    _end: Date;
    actual_duration?: number;
    ignored_duration?: number;
  };
  duration: number;
  actual_duration_raw: number;
  ignored_duration_raw: number;
}

type PatchedBarPrototype = {
  compute_duration: (this: FrappeBarLike) => void;
  __hourDurationPatched?: boolean;
};

function patchedHourBarComputeDuration(this: FrappeBarLike, originalComputeDuration: PatchedBarPrototype["compute_duration"]) {
  const ganttConfig = (this.gantt as Gantt & { config: { unit: string; step: number } }).config;
  if (ganttConfig.unit !== "hour") {
    originalComputeDuration.call(this);
    return;
  }

  const durationHours = Math.max(1 / 60, (this.task._end.getTime() - this.task._start.getTime()) / 3_600_000);
  const normalizedDuration = durationHours / ganttConfig.step;

  this.task.actual_duration = durationHours;
  this.task.ignored_duration = 0;
  this.duration = normalizedDuration;
  this.actual_duration_raw = normalizedDuration;
  this.ignored_duration_raw = 0;
}

const ensureHourDurationPatch = (gantt: Gantt): boolean => {
  const firstBar = (gantt as Gantt & { bars?: unknown[] }).bars?.[0];
  if (!firstBar) {
    return false;
  }

  const prototype = Object.getPrototypeOf(firstBar) as PatchedBarPrototype;
  if (prototype.__hourDurationPatched) {
    return false;
  }

  const originalComputeDuration = prototype.compute_duration;
  prototype.compute_duration = function patchedComputeDuration(this: FrappeBarLike) {
    return patchedHourBarComputeDuration.call(this, originalComputeDuration);
  };
  prototype.__hourDurationPatched = true;

  return true;
};

const formatMonthLabel = (date: Date): string => {
  return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
};

const VIEW_MODE_BY_MANUAL: Record<ManualGanttViewMode, Gantt.ViewModeObject> = {
  hour: {
    name: "Hour",
    padding: ["0s", "0s"],
    step: "1h",
    date_format: "YYYY-MM-DD HH:",
    // date_format: "DD HH:",
    column_width: 36,
    lower_text: (date: Date) => {
      if (date.getMinutes() !== 0) {
        return "";
      }
      return `${date.getHours()}`.padStart(2, "0");
    },
    upper_text: (date: Date, lastDate: Date | null) => {
      if (!lastDate || date.getDate() !== lastDate.getDate() || date.getMonth() !== lastDate.getMonth()) {
        return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
      }
      return EMPTY_HEADER_CELL;
    },
    thick_line: (date: Date) => date.getMinutes() === 0,
  },
  day: {
    name: "Day",
    padding: ["0s", "0s"],
    step: "1d",
    date_format: "YYYY-MM-DD",
    column_width: 84,
    lower_text: (date: Date) => `${date.getDate()}`,
    upper_text: (date: Date, lastDate: Date | null) => {
      if (!lastDate || date.getMonth() !== lastDate.getMonth()) {
        return formatMonthLabel(date);
      }
      return EMPTY_HEADER_CELL;
    },
    thick_line: (date: Date) => date.getDay() === 1,
  },
  week: {
    name: "Week",
    padding: ["0s", "0s"],
    step: "1d",
    date_format: "YYYY-MM-DD",
    column_width: 124,
    lower_text: (date: Date) => date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
    upper_text: (date: Date, lastDate: Date | null) => {
      if (!lastDate || date.getMonth() !== lastDate.getMonth()) {
        return formatMonthLabel(date);
      }
      return EMPTY_HEADER_CELL;
    },
    thick_line: (date: Date) => date.getDay() === 1,
  },
  month: {
    name: "Month",
    padding: ["0s", "0s"],
    step: "1d",
    date_format: "YYYY-MM-DD",
    column_width: 62,
    lower_text: (date: Date) => `${date.getDate()}`,
    upper_text: (date: Date, lastDate: Date | null) => {
      if (!lastDate || date.getMonth() !== lastDate.getMonth()) {
        return formatMonthLabel(date);
      }
      return EMPTY_HEADER_CELL;
    },
    thick_line: (date: Date) => date.getDate() === 1,
  },
};

const getViewModeWithDynamicPadding = (
  mode: ManualGanttViewMode,
  startPadding: string,
  endPadding: string,
  columnWidth?: number,
): Gantt.ViewModeObject => {
  const baseMode = VIEW_MODE_BY_MANUAL[mode];
  return {
    ...baseMode,
    padding: [startPadding, endPadding],
    column_width: columnWidth ?? baseMode.column_width,
  };
};

const resolveColumnWidthForMode = (
  mode: ManualGanttViewMode,
  timeline: ReturnType<typeof computeTimelinePadding>,
  viewportWidth: number,
): number => {
  const baseWidth = VIEW_MODE_BY_MANUAL[mode].column_width ?? 45;
  if (mode !== "day" || !timeline || viewportWidth <= 0) {
    return baseWidth;
  }

  const unitCount = countTimelineUnitsForMode(mode, timeline);
  const availableWidth = Math.max(baseWidth, viewportWidth - DAY_MODE_SIDE_PADDING_PX);
  return Math.max(baseWidth, Math.floor(availableWidth / unitCount));
};

const resolveScrollTargetForMode = (mode: ManualGanttViewMode, timelineStart: Date | null): string | "start" => {
  if (mode !== "hour" || !timelineStart) {
    return "start";
  }

  return timelineStart.toISOString();
};

export function StagesGantt() {
  const stagesDataMode = resolveStagesDataMode(import.meta.env.VITE_STAGES_DATA_MODE as string | undefined);
  const isDemoMode = stagesDataMode === "demo";
  const [stages, setStages] = useState<Stage[]>([]);
  const [viewMode, setViewMode] = useState<GanttViewMode>("hour");
  const [pollingEnabled, setPollingEnabled] = useState<boolean>(() => !isDemoMode);
  const [tooltipState, setTooltipState] = useState<TooltipState>(emptyTooltipState);
  const [modalTarget, setModalTarget] = useState<{ stageId: string; processId: string } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  const stagesRef = useRef<Stage[]>(stages);
  const pendingUpdatesRef = useRef<PendingProcessUpdate[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const tooltipCloseTimerRef = useRef<number | null>(null);
  const nowLineTimerRef = useRef<number | null>(null);
  const previousTaskMapRef = useRef<Map<string, FrappeTaskModel>>(new Map());
  const initialHourAutoscrollDoneRef = useRef<boolean>(false);

  const queryClient = useQueryClient();
  const stagesApiUrl = (import.meta.env.VITE_STAGES_API_URL as string | undefined) ?? STAGES_API_DEFAULT_URL;
  const processUpdateApiBase =
    (import.meta.env.VITE_PROCESS_UPDATE_API_BASE_URL as string | undefined) ?? PROCESS_UPDATE_API_BASE_DEFAULT_URL;
  const stagesQueryKey = isDemoMode ? ["stages", "demo"] : ["stages", "api", stagesApiUrl];
  const stagesSourceLabel = isDemoMode ? DEMO_STAGES_DATA_URL : stagesApiUrl;
  const writesSourceLabel = isDemoMode ? "Local demo only" : processUpdateApiBase;
  const applyStages = useCallback((nextStages: Stage[]) => {
    stagesRef.current = nextStages;
    setStages(nextStages);
  }, []);

  const stagesQuery = useQuery<Stage[], Error>({
    queryKey: stagesQueryKey,
    queryFn: ({ signal }) => fetchStagesFromSource({ mode: stagesDataMode, apiUrl: stagesApiUrl, signal }),
    enabled: isDemoMode ? true : pollingEnabled,
    refetchInterval: isDemoMode ? false : pollingEnabled ? STAGES_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: !isDemoMode,
    staleTime: isDemoMode ? Number.POSITIVE_INFINITY : STAGES_POLL_INTERVAL_MS / 2,
    retry: STAGES_QUERY_RETRY_COUNT,
    refetchOnWindowFocus: false,
  });

  const processUpdateMutation = useMutation<void, Error, ProcessUpdateMutationInput>({
    mutationFn: ({ stageId, processId, patch }) => updateProcessOnApi(processUpdateApiBase, stageId, processId, patch),
    onSuccess: () => {
      if (isDemoMode) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      void stagesQuery.refetch();
    },
    onError: (_error, variables) => {
      applyStages(variables.rollbackStages);
    },
  });

  const taskViewModels = useMemo(() => stages.map(toStageTaskViewModel), [stages]);
  const timelinePadding = useMemo(
    () => computeTimelinePadding(stages, taskViewModels, TIMELINE_RIGHT_AIR_HOURS),
    [stages, taskViewModels],
  );
  const initialColumnWidth = useMemo(
    () => resolveColumnWidthForMode(viewMode, timelinePadding, viewportWidth),
    [timelinePadding, viewMode, viewportWidth],
  );
  const effectiveColumnWidth = useMemo(
    () => resolveColumnWidthForMode(viewMode, timelinePadding, viewportWidth),
    [timelinePadding, viewMode, viewportWidth],
  );
  const initialTimelinePadding = resolveTimelinePaddingForMode(viewMode, timelinePadding);
  const effectiveTimelinePadding = resolveTimelinePaddingForMode(viewMode, timelinePadding);
  const timelineDesiredStart = timelinePadding?.desiredStart ?? null;
  const initialScrollTarget = resolveScrollTargetForMode(viewMode, timelineDesiredStart);
  const effectiveScrollTarget = resolveScrollTargetForMode(viewMode, timelineDesiredStart);
  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const computedMap = useMemo(
    () => new Map(taskViewModels.map((taskViewModel) => [taskViewModel.stageId, taskViewModel])),
    [taskViewModels],
  );
  const totalProcesses = useMemo(() => stages.reduce((acc, stage) => acc + stage.processes.length, 0), [stages]);
  const initialGanttSnapshotRef = useRef<{
    tasks: FrappeTaskModel[];
    viewMode: Gantt.ViewModeObject;
    scrollTarget: string | "start";
  } | null>(null);

  const activeTooltipStage = tooltipState.stageId ? stageMap.get(tooltipState.stageId) ?? null : null;
  const activeTooltipComputed = tooltipState.stageId ? computedMap.get(tooltipState.stageId) ?? null : null;
  const activeModalStage = modalTarget ? stageMap.get(modalTarget.stageId) ?? null : null;
  const activeModalProcess =
    modalTarget && activeModalStage
      ? activeModalStage.processes.find((process) => process.id === modalTarget.processId) ?? null
      : null;
  const activeModalKey =
    modalTarget && activeModalProcess ? `${modalTarget.stageId}:${modalTarget.processId}` : null;

  if (initialGanttSnapshotRef.current === null) {
    const initialTasks = taskViewModels.map((task) => toFrappeTaskWithinTimeline(task, timelineDesiredStart));
    initialGanttSnapshotRef.current = {
      tasks: initialTasks,
      viewMode: getViewModeWithDynamicPadding(
        viewMode,
        initialTimelinePadding.startPadding,
        initialTimelinePadding.endPadding,
        initialColumnWidth,
      ),
      scrollTarget: initialScrollTarget,
    };
  }

  useEffect(() => {
    if (!stagesQuery.data) {
      return;
    }
    startTransition(() => {
      applyStages(cloneStages(stagesQuery.data));
    });
  }, [applyStages, stagesQuery.data]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;
    const updateViewportWidth = () => {
      const nextWidth = container.clientWidth;
      setViewportWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    frameId = window.requestAnimationFrame(updateViewportWidth);
    const observer = new ResizeObserver(() => {
      updateViewportWidth();
    });
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushQueuedUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.length === 0) {
      return;
    }

    let nextStages = stagesRef.current;
    for (const update of pendingUpdatesRef.current) {
      nextStages = applyProcessPatchToStages(nextStages, update.stageId, update.processId, update.patch);
    }

    pendingUpdatesRef.current = [];
    applyStages(nextStages);
  }, [applyStages]);
  //test comment

  const queueProcessUpdate = useCallback(
    (update: PendingProcessUpdate, immediate: boolean) => {
      pendingUpdatesRef.current.push(update);

      if (immediate) {
        clearFlushTimer();
        flushQueuedUpdates();
        return;
      }

      if (flushTimerRef.current !== null) {
        return;
      }

      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushQueuedUpdates();
      }, THROTTLE_MS);
    },
    [clearFlushTimer, flushQueuedUpdates],
  );

  const findBarNode = useCallback((stageId: string): HTMLElement | null => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    return container.querySelector<HTMLElement>(`.bar-wrapper[data-id="${stageId}"]`);
  }, []);

  const findTimelineScroller = useCallback((): HTMLElement | null => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const candidates = [container, ...Array.from(container.querySelectorAll<HTMLElement>("div"))];
    let bestCandidate: HTMLElement | null = null;
    let bestOverflowWidth = 0;

    for (const candidate of candidates) {
      const overflowWidth = candidate.scrollWidth - candidate.clientWidth;
      if (overflowWidth <= 4 || candidate.clientWidth <= 0) {
        continue;
      }
      if (overflowWidth > bestOverflowWidth) {
        bestCandidate = candidate;
        bestOverflowWidth = overflowWidth;
      }
    }

    return bestCandidate;
  }, []);

  const decorateBarNodes = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const barWrappers = container.querySelectorAll<HTMLElement>(".bar-wrapper[data-id]");
    barWrappers.forEach((wrapper) => {
      const stageId = wrapper.dataset.id;
      const stage = stageId ? stagesRef.current.find((item) => item.id === stageId) : undefined;
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("aria-haspopup", "dialog");
      wrapper.setAttribute(
        "aria-label",
        stage ? `Stage ${stage.title}. Show processes and actions` : "Show stage processes",
      );
    });
  }, []);

  const closeTooltipNow = useCallback(() => {
    if (tooltipCloseTimerRef.current !== null) {
      window.clearTimeout(tooltipCloseTimerRef.current);
      tooltipCloseTimerRef.current = null;
    }
    setTooltipState(emptyTooltipState);
  }, []);

  const keepTooltipOpen = useCallback(() => {
    if (tooltipCloseTimerRef.current !== null) {
      window.clearTimeout(tooltipCloseTimerRef.current);
      tooltipCloseTimerRef.current = null;
    }
  }, []);

  const scheduleTooltipClose = useCallback(() => {
    keepTooltipOpen();
    tooltipCloseTimerRef.current = window.setTimeout(() => {
      tooltipCloseTimerRef.current = null;
      setTooltipState(emptyTooltipState);
    }, TOOLTIP_CLOSE_DELAY_MS);
  }, [keepTooltipOpen]);

  const openTooltipForStage = useCallback(
    (stageId: string) => {
      const node = findBarNode(stageId);
      if (!node) {
        return;
      }
      keepTooltipOpen();
      setTooltipState({
        open: true,
        stageId,
        targetElement: node,
      });
    },
    [findBarNode, keepTooltipOpen],
  );

  const refreshTooltipAnchor = useCallback(() => {
    setTooltipState((current) => {
      if (!current.open || !current.stageId) {
        return current;
      }
      const node = findBarNode(current.stageId);
      if (!node) {
        return emptyTooltipState;
      }
      if (current.targetElement === node) {
        return current;
      }
      return { ...current, targetElement: node };
    });
  }, [findBarNode]);

  const refreshNowLine = useEffectEvent(() => {
    const gantt = ganttRef.current;
    if (!gantt) {
      return;
    }

    const nextViewMode = getViewModeWithDynamicPadding(
      viewMode,
      effectiveTimelinePadding.startPadding,
      effectiveTimelinePadding.endPadding,
      effectiveColumnWidth,
    );
    gantt.change_view_mode(nextViewMode, true);
    decorateBarNodes();
    refreshTooltipAnchor();
  });

  const alignInitialHourViewport = useEffectEvent(() => {
    if (initialHourAutoscrollDoneRef.current || viewMode !== "hour" || taskViewModels.length === 0) {
      return;
    }

    let earliestTask = taskViewModels[0];
    for (const task of taskViewModels) {
      if (task.start.getTime() < earliestTask.start.getTime()) {
        earliestTask = task;
      }
    }

    const scroller = findTimelineScroller();
    const firstBarNode = findBarNode(earliestTask.stageId);
    if (!scroller || !firstBarNode) {
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const barRect = firstBarNode.getBoundingClientRect();
    const barLeft = barRect.left - scrollerRect.left + scroller.scrollLeft;
    const nextScrollLeft = Math.max(0, Math.round(barLeft - INITIAL_HOUR_BAR_OFFSET_PX));

    scroller.scrollLeft = nextScrollLeft;
    initialHourAutoscrollDoneRef.current = true;
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialSnapshot = initialGanttSnapshotRef.current;
    if (!initialSnapshot) {
      return;
    }

    const gantt = new Gantt(container, initialSnapshot.tasks, {
      view_mode: initialSnapshot.viewMode as unknown as Gantt.viewMode,
      language: "ru",
      popup: false,
      readonly: true,
      readonly_dates: true,
      readonly_progress: true,
      auto_move_label: false,
      infinite_padding: false,
      scroll_to: initialSnapshot.scrollTarget,
      today_button: false,
      bar_corner_radius: 5,
      container_height: GANTT_CONTAINER_HEIGHT_PX,
      on_click: (task: Gantt.Task) => {
        if (!task.id) {
          return false;
        }
        openTooltipForStage(task.id);
        return false;
      },
    });

    ganttRef.current = gantt;
    if (ensureHourDurationPatch(gantt)) {
      gantt.refresh(initialSnapshot.tasks);
    }
    previousTaskMapRef.current = new Map(initialSnapshot.tasks.map((task) => [task.id, cloneTask(task)]));
    decorateBarNodes();

    const onMouseOver = (event: MouseEvent) => {
      const stageId = stageIdFromTarget(event.target);
      if (!stageId) {
        return;
      }
      openTooltipForStage(stageId);
    };

    const onMouseOut = (event: MouseEvent) => {
      const stageId = stageIdFromTarget(event.target);
      if (!stageId) {
        return;
      }
      const nextNode = event.relatedTarget as Node | null;
      if (nextNode && tooltipRef.current?.contains(nextNode)) {
        return;
      }
      if (nextNode instanceof Element && nextNode.closest(".bar-wrapper[data-id]")) {
        return;
      }
      scheduleTooltipClose();
    };

    const onFocusIn = (event: FocusEvent) => {
      const stageId = stageIdFromTarget(event.target);
      if (!stageId) {
        return;
      }
      openTooltipForStage(stageId);
    };

    const onFocusOut = (event: FocusEvent) => {
      const stageId = stageIdFromTarget(event.target);
      if (!stageId) {
        return;
      }
      const nextNode = event.relatedTarget as Node | null;
      if (nextNode && tooltipRef.current?.contains(nextNode)) {
        return;
      }
      if (nextNode instanceof Element && nextNode.closest(".bar-wrapper[data-id]")) {
        return;
      }
      scheduleTooltipClose();
    };

    const onScroll = () => {
      refreshTooltipAnchor();
    };

    container.addEventListener("mouseover", onMouseOver);
    container.addEventListener("mouseout", onMouseOut);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    container.addEventListener("scroll", onScroll, true);

    return () => {
      container.removeEventListener("mouseover", onMouseOver);
      container.removeEventListener("mouseout", onMouseOut);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("scroll", onScroll, true);
      container.innerHTML = "";
      ganttRef.current = null;
    };
  }, [decorateBarNodes, openTooltipForStage, refreshTooltipAnchor, scheduleTooltipClose]);

  useLayoutEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt) {
      return;
    }

    const refreshViewMode = getViewModeWithDynamicPadding(
      viewMode,
      effectiveTimelinePadding.startPadding,
      effectiveTimelinePadding.endPadding,
      effectiveColumnWidth,
    );

    const nextTasks = taskViewModels.map((task) => toFrappeTaskWithinTimeline(task, timelineDesiredStart));
    const nextTaskMap = new Map(nextTasks.map((task) => [task.id, cloneTask(task)]));
    const previousTaskMap = previousTaskMapRef.current;

    const sameIds =
      previousTaskMap.size === nextTaskMap.size &&
      Array.from(nextTaskMap.keys()).every((taskId) => previousTaskMap.has(taskId));

    const hasTimelineMutation = nextTasks.some((task) => {
      const previousTask = previousTaskMap.get(task.id);
      if (!previousTask) {
        return true;
      }
      return previousTask.start !== task.start || previousTask.end !== task.end;
    });

    if (!sameIds || hasTimelineMutation) {
      gantt.refresh(nextTasks);
      if (ensureHourDurationPatch(gantt)) {
        gantt.refresh(nextTasks);
      }
      gantt.options.scroll_to = effectiveScrollTarget;
      gantt.change_view_mode(refreshViewMode, false);
      gantt.options.scroll_to = undefined;
    } else {
      for (const task of nextTasks) {
        const previousTask = previousTaskMap.get(task.id);
        if (!previousTask || !areFrappeTasksEqual(previousTask, task)) {
          gantt.update_task(task.id, task);
        }
      }
    }

    previousTaskMapRef.current = nextTaskMap;
    decorateBarNodes();

    const frameId = window.requestAnimationFrame(() => {
      refreshTooltipAnchor();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    decorateBarNodes,
    effectiveColumnWidth,
    effectiveScrollTarget,
    effectiveTimelinePadding.endPadding,
    effectiveTimelinePadding.startPadding,
    refreshTooltipAnchor,
    taskViewModels,
    timelineDesiredStart,
    viewMode,
  ]);

  useLayoutEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt) {
      return;
    }

    const nextViewMode = getViewModeWithDynamicPadding(
      viewMode,
      effectiveTimelinePadding.startPadding,
      effectiveTimelinePadding.endPadding,
      effectiveColumnWidth,
    );
    gantt.options.scroll_to = effectiveScrollTarget;
    gantt.change_view_mode(nextViewMode, true);
    gantt.options.scroll_to = undefined;

    decorateBarNodes();

    const frameId = window.requestAnimationFrame(() => {
      refreshTooltipAnchor();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    decorateBarNodes,
    effectiveColumnWidth,
    effectiveScrollTarget,
    effectiveTimelinePadding.endPadding,
    effectiveTimelinePadding.startPadding,
    refreshTooltipAnchor,
    viewMode,
  ]);

  useLayoutEffect(() => {
    if (viewMode !== "hour" || taskViewModels.length === 0 || initialHourAutoscrollDoneRef.current) {
      return;
    }

    let secondFrameId = 0;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        alignInitialHourViewport();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (secondFrameId !== 0) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [taskViewModels.length, viewMode]);

  useEffect(() => {
    if (!tooltipState.open) {
      return;
    }

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (tooltipRef.current?.contains(target)) {
        return;
      }
      if (tooltipState.stageId) {
        const barNode = findBarNode(tooltipState.stageId);
        if (barNode?.contains(target)) {
          return;
        }
      }
      closeTooltipNow();
    };

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTooltipNow();
      }
    };

    const onResize = () => {
      refreshTooltipAnchor();
    };

    document.addEventListener("mousedown", onDocumentMouseDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [closeTooltipNow, findBarNode, refreshTooltipAnchor, tooltipState.open, tooltipState.stageId]);

  useEffect(() => {
    nowLineTimerRef.current = window.setInterval(() => {
      refreshNowLine();
    }, NOW_LINE_REFRESH_MS);
    return () => {
      if (nowLineTimerRef.current !== null) {
        window.clearInterval(nowLineTimerRef.current);
        nowLineTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearFlushTimer();
      if (tooltipCloseTimerRef.current !== null) {
        window.clearTimeout(tooltipCloseTimerRef.current);
        tooltipCloseTimerRef.current = null;
      }
      if (nowLineTimerRef.current !== null) {
        window.clearInterval(nowLineTimerRef.current);
        nowLineTimerRef.current = null;
      }
    };
  }, [clearFlushTimer]);

  const openProcessDetails = useCallback((stageId: string, processId: string) => {
    closeTooltipNow();
    setModalTarget({ stageId, processId });
  }, [closeTooltipNow]);

  const closeProcessDetails = useCallback(() => {
    setModalTarget(null);
  }, []);

  const saveProcessDetails = useCallback(
    (stageId: string, processId: string, patch: ProcessPatch) => {
      if (!isDemoMode && processUpdateMutation.isPending) {
        return;
      }
      const rollbackStages = cloneStages(stagesRef.current);
      queueProcessUpdate({ stageId, processId, patch }, true);
      if (isDemoMode) {
        return;
      }
      processUpdateMutation.mutate({ stageId, processId, patch, rollbackStages });
    },
    [isDemoMode, processUpdateMutation, queueProcessUpdate],
  );

  return (
    <Root>
      <GanttChromeStyle />

      <Toolbar>
        <HeaderBlock>
          <T as="h2" font="Header/H5">
            Stages Gantt viewer
          </T>
          <T as="p" font="Body/Body 2 Long" color="Neutral/Neutral 50">
            Wider time ticks and AdmiralDS controls make the schedule easier to scan.
          </T>
        </HeaderBlock>

        <Controls>
          <ModeField
            label="Timeline scale"
            value={viewMode}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => setViewMode(event.target.value as GanttViewMode)}
            aria-label="Timeline view mode"
          >
            {VIEW_MODE_OPTIONS.map((option) => (
              <Option value={option.value} key={option.value}>
                {option.label}
              </Option>
            ))}
          </ModeField>

          <LiveToggle>
            <Checkbox
              checked={pollingEnabled}
              disabled={isDemoMode}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPollingEnabled(event.target.checked)}
            />
            <T as="span" font="Body/Body 2 Long">
              {isDemoMode ? "Demo mode: local static data" : "Sync from API every 30s"}
            </T>
          </LiveToggle>
        </Controls>
      </Toolbar>

      <MetricsGrid>
        <MetricCard>
          <T as="span" font="Caption/Caption 1" color="Neutral/Neutral 50">
            Data source
          </T>
          <MetricValue title={stagesSourceLabel}>{stagesSourceLabel}</MetricValue>
        </MetricCard>

        <MetricCard>
          <T as="span" font="Caption/Caption 1" color="Neutral/Neutral 50">
            Writes backend
          </T>
          <MetricValue title={writesSourceLabel}>{writesSourceLabel}</MetricValue>
        </MetricCard>

        <MetricCard>
          <T as="span" font="Caption/Caption 1" color="Neutral/Neutral 50">
            Loaded items
          </T>
          <MetricValue>{`${stages.length} stages / ${totalProcesses} processes`}</MetricValue>
        </MetricCard>

        <MetricCard>
          <T as="span" font="Caption/Caption 1" color="Neutral/Neutral 50">
            Visible range
          </T>
          <MetricValue
            title={
              timelinePadding
                ? `${timelinePadding.desiredStart.toLocaleString()} - ${timelinePadding.desiredEnd.toLocaleString()}`
                : "No data"
            }
          >
            {timelinePadding
              ? `${timelinePadding.desiredStart.toLocaleString()} - ${timelinePadding.desiredEnd.toLocaleString()}`
              : "No data"}
          </MetricValue>
        </MetricCard>
      </MetricsGrid>

      <StatusRow>
        {isDemoMode ? (
          <Tag dimension="s" kind="success">
            Demo mode
          </Tag>
        ) : (
          <Tag dimension="s" kind={pollingEnabled ? "success" : "warning"}>
            {pollingEnabled ? "Polling ON" : "Polling OFF"}
          </Tag>
        )}
        <Tag dimension="s" kind="primary">
          {`Scale: ${VIEW_MODE_LABEL_BY_VALUE[viewMode]}`}
        </Tag>
        <Tag dimension="s" kind={stagesQuery.isFetching ? "primary" : "neutral"}>
          {stagesQuery.isFetching ? "Syncing..." : "Sync idle"}
        </Tag>
        <Tag dimension="s" kind={processUpdateMutation.isPending ? "warning" : isDemoMode ? "success" : "neutral"}>
          {processUpdateMutation.isPending
            ? "Saving process..."
            : isDemoMode
              ? "Local demo edits"
              : "Writes idle"}
        </Tag>
        {stagesQuery.isError ? (
          <Tag dimension="s" kind="danger">
            {stagesQuery.error.message}
          </Tag>
        ) : null}
        {processUpdateMutation.isError ? (
          <Tag dimension="s" kind="danger">
            {processUpdateMutation.error.message}
          </Tag>
        ) : null}
      </StatusRow>

      <ChartViewport ref={containerRef} />

      <ProcessTooltip
        open={tooltipState.open}
        stage={activeTooltipStage}
        computed={activeTooltipComputed}
        targetElement={tooltipState.targetElement}
        tooltipRef={tooltipRef}
        onProcessOpen={openProcessDetails}
        onRequestClose={closeTooltipNow}
        onKeepOpen={keepTooltipOpen}
        onScheduleClose={scheduleTooltipClose}
      />

      {modalTarget && activeModalProcess && activeModalStage && activeModalKey ? (
        <ProcessDetailsModal
          key={activeModalKey}
          open
          stage={activeModalStage}
          process={activeModalProcess}
          onClose={closeProcessDetails}
          onSave={saveProcessDetails}
        />
      ) : null}
    </Root>
  );
}

import { Checkbox } from "@admiral-ds/react-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Gantt from "frappe-gantt";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  fetchStagesFromApi,
  PROCESS_UPDATE_API_BASE_DEFAULT_URL,
  STAGES_API_DEFAULT_URL,
  STAGES_POLL_INTERVAL_MS,
  updateProcessOnApi,
} from "./api";
import { mockStages } from "./mock";
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
  computeTimelinePadding,
  type FrappeTaskModel,
  pickAutoViewMode,
  resolveTimelinePaddingForMode,
  toFrappeTask,
  toStageTaskViewModel,
} from "./utils";
import "./styles.css";

const VIEW_MODE_OPTIONS: { value: GanttViewMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const THROTTLE_MS = 250;
const TOOLTIP_CLOSE_DELAY_MS = 180;
const NOW_LINE_REFRESH_MS = 60_000;
const STAGES_QUERY_RETRY_COUNT = 2;
const GANTT_CONTAINER_HEIGHT_PX = 460;
const DEFAULT_TIMELINE_RIGHT_AIR_HOURS = 0;
const EMPTY_HEADER_CELL = "\u00A0";

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
    column_width: 20,
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
    column_width: 56,
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
    column_width: 86,
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
    column_width: 44,
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
): Gantt.ViewModeObject => {
  const baseMode = VIEW_MODE_BY_MANUAL[mode];
  return {
    ...baseMode,
    padding: [startPadding, endPadding],
  };
};

export function StagesGantt() {
  const [stages, setStages] = useState<Stage[]>(() => cloneStages(mockStages));
  const [viewMode, setViewMode] = useState<GanttViewMode>("auto");
  const [pollingEnabled, setPollingEnabled] = useState<boolean>(true);
  const [tooltipState, setTooltipState] = useState<TooltipState>(emptyTooltipState);
  const [modalTarget, setModalTarget] = useState<{ stageId: string; processId: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);
  const stagesRef = useRef<Stage[]>(stages);
  const viewModeRef = useRef<ManualGanttViewMode>("day");
  const pendingUpdatesRef = useRef<PendingProcessUpdate[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const tooltipCloseTimerRef = useRef<number | null>(null);
  const nowLineTimerRef = useRef<number | null>(null);
  const previousTaskMapRef = useRef<Map<string, FrappeTaskModel>>(new Map());

  const queryClient = useQueryClient();
  const stagesApiUrl = (import.meta.env.VITE_STAGES_API_URL as string | undefined) ?? STAGES_API_DEFAULT_URL;
  const processUpdateApiBase =
    (import.meta.env.VITE_PROCESS_UPDATE_API_BASE_URL as string | undefined) ?? PROCESS_UPDATE_API_BASE_DEFAULT_URL;

  const stagesQuery = useQuery<Stage[], Error>({
    queryKey: ["stages", stagesApiUrl],
    queryFn: ({ signal }) => fetchStagesFromApi(stagesApiUrl, signal),
    enabled: pollingEnabled,
    refetchInterval: pollingEnabled ? STAGES_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
    staleTime: STAGES_POLL_INTERVAL_MS / 2,
    retry: STAGES_QUERY_RETRY_COUNT,
    refetchOnWindowFocus: false,
  });

  const processUpdateMutation = useMutation<void, Error, ProcessUpdateMutationInput>({
    mutationFn: ({ stageId, processId, patch }) => updateProcessOnApi(processUpdateApiBase, stageId, processId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stages", stagesApiUrl] });
      void stagesQuery.refetch();
    },
    onError: (_error, variables) => {
      stagesRef.current = variables.rollbackStages;
      setStages(variables.rollbackStages);
    },
  });

  const taskViewModels = useMemo(() => stages.map(toStageTaskViewModel), [stages]);
  const effectiveViewMode = useMemo<ManualGanttViewMode>(() => {
    return viewMode === "auto" ? pickAutoViewMode(taskViewModels) : viewMode;
  }, [taskViewModels, viewMode]);
  const timelinePadding = useMemo(
    () => computeTimelinePadding(stages, taskViewModels, TIMELINE_RIGHT_AIR_HOURS),
    [stages, taskViewModels],
  );
  const initialTimelinePadding = resolveTimelinePaddingForMode(viewModeRef.current, timelinePadding);
  const effectiveTimelinePadding = resolveTimelinePaddingForMode(effectiveViewMode, timelinePadding);
  const timelineDesiredStart = timelinePadding?.desiredStart ?? null;
  const timelinePaddingKey = timelinePadding
    ? `${timelinePadding.desiredStart.getTime()}|${timelinePadding.desiredEnd.getTime()}|${timelinePadding.minTaskStart.getTime()}|${timelinePadding.maxTaskEnd.getTime()}`
    : "0s|0s|0|0";
  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const computedMap = useMemo(
    () => new Map(taskViewModels.map((taskViewModel) => [taskViewModel.stageId, taskViewModel])),
    [taskViewModels],
  );

  const activeTooltipStage = tooltipState.stageId ? stageMap.get(tooltipState.stageId) ?? null : null;
  const activeTooltipComputed = tooltipState.stageId ? computedMap.get(tooltipState.stageId) ?? null : null;
  const activeModalStage = modalTarget ? stageMap.get(modalTarget.stageId) ?? null : null;
  const activeModalProcess =
    modalTarget && activeModalStage
      ? activeModalStage.processes.find((process) => process.id === modalTarget.processId) ?? null
      : null;

  useEffect(() => {
    stagesRef.current = stages;
  }, [stages]);

  useEffect(() => {
    viewModeRef.current = effectiveViewMode;
  }, [effectiveViewMode]);

  useEffect(() => {
    if (!stagesQuery.data) {
      return;
    }
    const nextStages = cloneStages(stagesQuery.data);
    stagesRef.current = nextStages;
    setStages(nextStages);
  }, [stagesQuery.data]);

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
    stagesRef.current = nextStages;
    setStages(nextStages);
  }, []);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialTasks = stagesRef.current
      .map(toStageTaskViewModel)
      .map((task) => toFrappeTaskWithinTimeline(task, timelineDesiredStart));
    const initialViewMode = getViewModeWithDynamicPadding(
      viewModeRef.current,
      initialTimelinePadding.startPadding,
      initialTimelinePadding.endPadding,
    );
    const gantt = new Gantt(container, initialTasks, {
      view_mode: initialViewMode as unknown as Gantt.viewMode,
      language: "ru",
      popup: false,
      readonly: true,
      readonly_dates: true,
      readonly_progress: true,
      auto_move_label: false,
      infinite_padding: false,
      scroll_to: "start",
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
    previousTaskMapRef.current = new Map(initialTasks.map((task) => [task.id, cloneTask(task)]));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt) {
      return;
    }

    const refreshViewMode = getViewModeWithDynamicPadding(
      viewModeRef.current,
      effectiveTimelinePadding.startPadding,
      effectiveTimelinePadding.endPadding,
    );

    const nextTasks = taskViewModels.map((task) => toFrappeTaskWithinTimeline(task, timelineDesiredStart));
    const nextTaskMap = new Map(nextTasks.map((task) => [task.id, cloneTask(task)]));
    const previousTaskMap = previousTaskMapRef.current;

    const sameIds =
      previousTaskMap.size === nextTaskMap.size &&
      Array.from(nextTaskMap.keys()).every((taskId) => previousTaskMap.has(taskId));

    if (!sameIds) {
      gantt.refresh(nextTasks);
      gantt.options.scroll_to = "start";
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
    refreshTooltipAnchor();
  }, [
    decorateBarNodes,
    effectiveTimelinePadding.endPadding,
    effectiveTimelinePadding.startPadding,
    refreshTooltipAnchor,
    taskViewModels,
    timelineDesiredStart,
    timelinePaddingKey,
  ]);

  useEffect(() => {
    const gantt = ganttRef.current;
    if (!gantt) {
      return;
    }

    const nextViewMode = getViewModeWithDynamicPadding(
      effectiveViewMode,
      effectiveTimelinePadding.startPadding,
      effectiveTimelinePadding.endPadding,
    );
    gantt.options.scroll_to = undefined;
    gantt.change_view_mode(nextViewMode, true);

    decorateBarNodes();
    refreshTooltipAnchor();
  }, [
    decorateBarNodes,
    effectiveViewMode,
    effectiveTimelinePadding.endPadding,
    effectiveTimelinePadding.startPadding,
    refreshTooltipAnchor,
  ]);

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
    const tickNowLine = () => {
      const gantt = ganttRef.current;
      if (!gantt) {
        return;
      }
      const nextViewMode = getViewModeWithDynamicPadding(
        viewModeRef.current,
        effectiveTimelinePadding.startPadding,
        effectiveTimelinePadding.endPadding,
      );
      gantt.change_view_mode(nextViewMode, true);
      decorateBarNodes();
      refreshTooltipAnchor();
    };

    nowLineTimerRef.current = window.setInterval(tickNowLine, NOW_LINE_REFRESH_MS);
    return () => {
      if (nowLineTimerRef.current !== null) {
        window.clearInterval(nowLineTimerRef.current);
        nowLineTimerRef.current = null;
      }
    };
  }, [
    decorateBarNodes,
    effectiveTimelinePadding.endPadding,
    effectiveTimelinePadding.startPadding,
    refreshTooltipAnchor,
  ]);

  useEffect(() => {
    if (!modalTarget) {
      return;
    }
    closeTooltipNow();
  }, [closeTooltipNow, modalTarget]);

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
    setModalTarget({ stageId, processId });
  }, []);

  const closeProcessDetails = useCallback(() => {
    setModalTarget(null);
  }, []);

  const saveProcessDetails = useCallback(
    (stageId: string, processId: string, patch: ProcessPatch) => {
      if (processUpdateMutation.isPending) {
        return;
      }
      const rollbackStages = cloneStages(stagesRef.current);
      queueProcessUpdate({ stageId, processId, patch }, true);
      processUpdateMutation.mutate({ stageId, processId, patch, rollbackStages });
    },
    [processUpdateMutation, queueProcessUpdate],
  );

  return (
    <section className="stages-gantt">
      <div className="stages-gantt__toolbar">
        <h2 className="stages-gantt__title">Stages Gantt viewer</h2>
        <div className="stages-gantt__controls">
          <select
            className="stages-gantt__mode"
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as GanttViewMode)}
            aria-label="Timeline view mode"
          >
            {VIEW_MODE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="stages-gantt__live">
            <Checkbox
              checked={pollingEnabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPollingEnabled(event.target.checked)}
            />
            Sync from API every 30s
          </label>
        </div>
      </div>

      <div className="stages-gantt__sync">
        <span>API: {stagesApiUrl}</span>
        <span>PATCH: {processUpdateApiBase}</span>
        <span>{pollingEnabled ? "Polling: ON" : "Polling: OFF"}</span>
        <span>{viewMode === "auto" ? `Scale: AUTO (${effectiveViewMode})` : `Scale: ${effectiveViewMode}`}</span>
        {timelinePadding ? (
          <span>
            Range: {timelinePadding.desiredStart.toLocaleString()} - {timelinePadding.desiredEnd.toLocaleString()}
          </span>
        ) : null}
        <span>{stagesQuery.isFetching ? "Syncing..." : "Idle"}</span>
        <span>{processUpdateMutation.isPending ? "Saving process..." : "Writes: idle"}</span>
        {stagesQuery.isError ? <span className="stages-gantt__sync-error">{stagesQuery.error.message}</span> : null}
        {processUpdateMutation.isError ? (
          <span className="stages-gantt__sync-error">{processUpdateMutation.error.message}</span>
        ) : null}
      </div>

      <div ref={containerRef} className="stages-gantt__chart" />

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

      <ProcessDetailsModal
        open={Boolean(modalTarget && activeModalProcess && activeModalStage)}
        stage={activeModalStage}
        process={activeModalProcess}
        onClose={closeProcessDetails}
        onSave={saveProcessDetails}
      />
    </section>
  );
}

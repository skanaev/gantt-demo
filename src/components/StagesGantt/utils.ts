import type Gantt from "frappe-gantt";
import type {
  ComputedStageTask,
  ManualGanttViewMode,
  ProcessPatch,
  Stage,
  StageProcess,
  StageStatus,
  StageTaskViewModel,
} from "./types";

const STATUS_PRIORITY: StageStatus[] = ["EXPIRED", "IN_WORK", "QUEUED", "COMPLETED"];
const BAR_CLASS_BY_STAGE_STATUS: Record<StageStatus, string> = {
  QUEUED: "stage-bar--queued",
  IN_WORK: "stage-bar--in-work",
  COMPLETED: "stage-bar--completed",
  EXPIRED: "stage-bar--expired",
};
const MAX_STAGE_BAR_TITLE_CHARS = 20;

export type FrappeTaskModel = Gantt.Task & {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class?: string;
};
const MAX_TIMELINE_AIR_HOURS = 5;

export interface TimelinePadding {
  desiredStart: Date;
  desiredEnd: Date;
  minTaskStart: Date;
  maxTaskEnd: Date;
}

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60_000);
};

const normalizeDuration = (durationMin: number): number => {
  if (!Number.isFinite(durationMin)) {
    return 1;
  }
  return Math.max(1, Math.round(durationMin));
};

export const deriveStageStatus = (processes: StageProcess[]): StageStatus => {
  if (processes.length === 0) {
    return "QUEUED";
  }

  const allDone = processes.every((process) => process.status === "COMPLETED");
  if (allDone) {
    return "COMPLETED";
  }

  for (const status of STATUS_PRIORITY) {
    if (processes.some((process) => process.status === status)) {
      return status;
    }
  }

  return "QUEUED";
};

const toTimestamp = (value?: Date): number | null => {
  return value ? value.getTime() : null;
};

const resolveProcessDisplayEndTs = (process: StageProcess): number | null => {
  const candidates = [
    toTimestamp(process.plannedEndAt),
    toTimestamp(process.regFinishDate),
    toTimestamp(process.startAt),
    toTimestamp(process.regStartDate),
  ].filter((value): value is number => value !== null);

  if (candidates.length === 0) {
    return null;
  }

  return Math.max(...candidates);
};

const resolveProcessDisplayStartTs = (
  process: StageProcess,
  previousProcessEndTs: number | null,
  stageStartTs: number,
): number => {
  const actualStartTs = toTimestamp(process.startAt);
  const regStartTs = toTimestamp(process.regStartDate);

  if (actualStartTs !== null && previousProcessEndTs !== null && previousProcessEndTs < actualStartTs) {
    return actualStartTs;
  }

  if (regStartTs !== null) {
    return regStartTs;
  }

  if (actualStartTs !== null) {
    return actualStartTs;
  }

  return stageStartTs;
};

export const computeStageTask = (stage: Stage): ComputedStageTask => {
  const stageStartTs = stage.start.getTime();
  let minStageStartTs = Number.POSITIVE_INFINITY;
  let maxStageEndTs = Number.NEGATIVE_INFINITY;
  let previousProcessEndTs: number | null = null;

  for (const process of stage.processes) {
    const processStartTs = resolveProcessDisplayStartTs(process, previousProcessEndTs, stageStartTs);
    const processEndTs = resolveProcessDisplayEndTs(process) ?? addMinutes(new Date(processStartTs), process.durationMin).getTime();

    minStageStartTs = Math.min(minStageStartTs, processStartTs);
    maxStageEndTs = Math.max(maxStageEndTs, processEndTs);
    previousProcessEndTs = processEndTs;
  }

  const stageStart = Number.isFinite(minStageStartTs) ? new Date(minStageStartTs) : stage.start;
  const processCount = stage.processes.length;
  const totalWorkDurationMin = stage.processes.reduce(
    (acc, process) => acc + normalizeDuration(process.durationMin),
    0,
  );
  const doneDurationMin = stage.processes.reduce((acc, process) => {
    if (process.status !== "COMPLETED") {
      return acc;
    }
    return acc + normalizeDuration(process.durationMin);
  }, 0);

  const doneCount = stage.processes.filter((process) => process.status === "COMPLETED").length;
  const progressPercent =
    totalWorkDurationMin <= 0 ? 0 : Math.min(100, Math.round((doneDurationMin / totalWorkDurationMin) * 100));
  const fallbackEnd = addMinutes(stageStart, totalWorkDurationMin);
  const end = Number.isFinite(maxStageEndTs) ? new Date(maxStageEndTs) : fallbackEnd;
  const totalDurationMin = Math.max(1, Math.round((end.getTime() - stageStart.getTime()) / 60_000));
  const derivedStatus = deriveStageStatus(stage.processes);

  return {
    stageId: stage.id,
    stageTitle: stage.title,
    start: stageStart,
    end,
    totalDurationMin,
    doneDurationMin,
    processCount,
    doneCount,
    progressPercent,
    derivedStatus,
  };
};

export const toStageTaskViewModel = (stage: Stage): StageTaskViewModel => {
  const computed = computeStageTask(stage);
  return {
    ...computed,
    barClassName: BAR_CLASS_BY_STAGE_STATUS[computed.derivedStatus],
  };
};

const truncateStageTitleForBar = (title: string): string => {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length <= MAX_STAGE_BAR_TITLE_CHARS) {
    return normalizedTitle;
  }
  return `${normalizedTitle.slice(0, MAX_STAGE_BAR_TITLE_CHARS - 1).trimEnd()}…`;
};

export const toFrappeTask = (stageTask: StageTaskViewModel): FrappeTaskModel => {
  const toFrappeDate = (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${date.getUTCDate()}`.padStart(2, "0");
    const hours = `${date.getUTCHours()}`.padStart(2, "0");
    const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
    const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  return {
    id: stageTask.stageId,
    name: `${stageTask.doneCount}/${stageTask.processCount} ${truncateStageTitleForBar(stageTask.stageTitle)}`,
    start: toFrappeDate(stageTask.start),
    end: toFrappeDate(stageTask.end),
    progress: stageTask.progressPercent,
    custom_class: stageTask.barClassName,
  };
};

export const computeTimelinePadding = (
  stages: Stage[],
  tasks: StageTaskViewModel[],
  maxEndAirHours: number = MAX_TIMELINE_AIR_HOURS,
): TimelinePadding | null => {
  if (tasks.length === 0) {
    return null;
  }

  let minTaskStartTs = Number.POSITIVE_INFINITY;
  let maxTaskEndTs = Number.NEGATIVE_INFINITY;
  for (const task of tasks) {
    minTaskStartTs = Math.min(minTaskStartTs, task.start.getTime());
    maxTaskEndTs = Math.max(maxTaskEndTs, task.end.getTime());
  }

  let minProcessStartTs = Number.POSITIVE_INFINITY;
  let maxProcessEndTs = Number.NEGATIVE_INFINITY;
  for (const stage of stages) {
    for (const process of stage.processes) {
      const startCandidates = [process.startAt, process.regStartDate]
        .filter((value): value is Date => value instanceof Date)
        .map((value) => value.getTime());
      const endCandidates = [process.plannedEndAt, process.regFinishDate]
        .filter((value): value is Date => value instanceof Date)
        .map((value) => value.getTime());

      if (startCandidates.length > 0) {
        minProcessStartTs = Math.min(minProcessStartTs, ...startCandidates);
      }
      if (endCandidates.length > 0) {
        maxProcessEndTs = Math.max(maxProcessEndTs, ...endCandidates);
      }
    }
  }

  const desiredStartTs = Number.isFinite(minProcessStartTs) ? minProcessStartTs : minTaskStartTs;
  const rawEndTs = Number.isFinite(maxProcessEndTs) ? maxProcessEndTs : maxTaskEndTs;
  const desiredEndDate = new Date(rawEndTs);
  desiredEndDate.setUTCHours(23, 59, 59, 999);
  const maxEndAirMinutes = Math.max(0, Math.round(maxEndAirHours * 60));
  const desiredEndTs = desiredEndDate.getTime() + maxEndAirMinutes * 60_000;

  return {
    desiredStart: new Date(desiredStartTs),
    desiredEnd: new Date(desiredEndTs),
    minTaskStart: new Date(minTaskStartTs),
    maxTaskEnd: new Date(maxTaskEndTs),
  };
};

const toIntervalSeconds = (milliseconds: number): string => {
  const safeMs = Number.isFinite(milliseconds) ? milliseconds : 0;
  const seconds = Math.max(0, Math.ceil(safeMs / 1000));
  return `${seconds}s`;
};

const ceilToNextLocalHour = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  if (date.getTime() < timestamp) {
    date.setHours(date.getHours() + 1);
  }
  return date.getTime();
};

export const resolveTimelinePaddingForMode = (
  mode: ManualGanttViewMode,
  timeline: TimelinePadding | null,
): { startPadding: string; endPadding: string } => {
  if (!timeline) {
    return {
      startPadding: "0s",
      endPadding: "0s",
    };
  }

  const desiredEndTs = timeline.desiredEnd.getTime();
  const maxTaskEndTs = timeline.maxTaskEnd.getTime();

  const endPadMs =
    mode === "hour"
      ? Math.max(0, ceilToNextLocalHour(maxTaskEndTs) - maxTaskEndTs)
      : Math.max(0, desiredEndTs - maxTaskEndTs);

  return {
    startPadding: "0s",
    endPadding: toIntervalSeconds(endPadMs),
  };
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const countTimelineUnitsForMode = (mode: ManualGanttViewMode, timeline: TimelinePadding | null): number => {
  if (!timeline) {
    return 1;
  }

  if (mode === "day") {
    const startTs = startOfLocalDay(timeline.desiredStart).getTime();
    const endTs = startOfLocalDay(timeline.desiredEnd).getTime();
    return Math.max(1, Math.round((endTs - startTs) / DAY_IN_MS) + 1);
  }

  return 1;
};

export const formatDuration = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const restMinutes = safeMinutes % 60;
  if (hours <= 0) {
    return `${restMinutes} мин`;
  }
  if (restMinutes === 0) {
    return `${hours} ч`;
  }
  return `${hours} ч ${restMinutes} мин`;
};

export const cloneStages = (stages: Stage[]): Stage[] => {
  return stages.map((stage) => ({
    ...stage,
    start: new Date(stage.start.getTime()),
    processes: stage.processes.map((process) => ({
      ...process,
      startAt: process.startAt ? new Date(process.startAt.getTime()) : undefined,
      plannedEndAt: process.plannedEndAt ? new Date(process.plannedEndAt.getTime()) : undefined,
      regStartDate: process.regStartDate ? new Date(process.regStartDate.getTime()) : undefined,
      regFinishDate: process.regFinishDate ? new Date(process.regFinishDate.getTime()) : undefined,
      updatedAt: new Date(process.updatedAt.getTime()),
      meta: { ...process.meta },
    })),
  }));
};

export const applyProcessPatchToStages = (
  stages: Stage[],
  stageId: string,
  processId: string,
  patch: ProcessPatch,
): Stage[] => {
  return stages.map((stage) => {
    if (stage.id !== stageId) {
      return stage;
    }

    return {
      ...stage,
      processes: stage.processes.map((process) => {
        if (process.id !== processId) {
          return process;
        }

        const nextStatus = patch.status ?? process.status;
        const nextDuration = patch.durationMin ?? process.durationMin;
        const normalizedDuration = normalizeDuration(nextDuration);

        return {
          ...process,
          status: nextStatus,
          durationMin: normalizedDuration,
          comment: patch.comment ?? process.comment,
          delayReason: patch.delayReason ?? process.delayReason,
          updatedAt: new Date(),
        };
      }),
    };
  });
};

export const areFrappeTasksEqual = (left: FrappeTaskModel, right: FrappeTaskModel): boolean => {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.start === right.start &&
    left.end === right.end &&
    left.progress === right.progress &&
    left.custom_class === right.custom_class
  );
};

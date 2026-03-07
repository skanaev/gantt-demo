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

const STATUS_PRIORITY: StageStatus[] = ["blocked", "delayed", "ok", "done"];

export type FrappeTaskModel = Gantt.Task & {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class?: string;
};

type FrappeViewMode = Gantt.viewMode;
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
    return "ok";
  }

  const allDone = processes.every((process) => process.status === "done");
  if (allDone) {
    return "done";
  }

  for (const status of STATUS_PRIORITY) {
    if (processes.some((process) => process.status === status)) {
      return status;
    }
  }

  return "ok";
};

export const computeStageTask = (stage: Stage): ComputedStageTask => {
  const processStarts = stage.processes
    .map((process) => process.startAt?.getTime())
    .filter((value): value is number => Number.isFinite(value));
  const stageStart = processStarts.length > 0 ? new Date(Math.min(...processStarts)) : stage.start;
  const processCount = stage.processes.length;
  const totalDurationMin = stage.processes.reduce(
    (acc, process) => acc + normalizeDuration(process.durationMin),
    0,
  );
  const doneDurationMin = stage.processes.reduce((acc, process) => {
    if (process.status !== "done") {
      return acc;
    }
    return acc + normalizeDuration(process.durationMin);
  }, 0);

  const doneCount = stage.processes.filter((process) => process.status === "done").length;
  const progressPercent =
    totalDurationMin <= 0 ? 0 : Math.min(100, Math.round((doneDurationMin / totalDurationMin) * 100));
  const end = addMinutes(stageStart, totalDurationMin);
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
    barClassName: `stage-bar--${computed.derivedStatus}`,
  };
};

export const toFrappeTask = (stageTask: StageTaskViewModel): FrappeTaskModel => {
  const toFrappeDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const hours = `${date.getHours()}`.padStart(2, "0");
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    const seconds = `${date.getSeconds()}`.padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  return {
    id: stageTask.stageId,
    name: stageTask.stageTitle,
    start: toFrappeDate(stageTask.start),
    end: toFrappeDate(stageTask.end),
    progress: stageTask.progressPercent,
    custom_class: stageTask.barClassName,
  };
};

export const mapViewModeToFrappe = (mode: ManualGanttViewMode): FrappeViewMode => {
  if (mode === "hour") {
    return "Hour";
  }
  if (mode === "day") {
    return "Day";
  }
  if (mode === "week") {
    return "Week";
  }
  return "Month";
};

export const pickAutoViewMode = (tasks: StageTaskViewModel[]): ManualGanttViewMode => {
  if (tasks.length === 0) {
    return "day";
  }

  let minStartTs = Number.POSITIVE_INFINITY;
  let maxEndTs = Number.NEGATIVE_INFINITY;

  for (const task of tasks) {
    minStartTs = Math.min(minStartTs, task.start.getTime());
    maxEndTs = Math.max(maxEndTs, task.end.getTime());
  }

  const spanMinutes = Math.max(1, (maxEndTs - minStartTs) / 60_000);
  if (spanMinutes <= 72 * 60) {
    return "hour";
  }
  if (spanMinutes <= 90 * 24 * 60) {
    return "day";
  }
  if (spanMinutes <= 365 * 24 * 60) {
    return "week";
  }
  return "month";
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
      if (process.startAt) {
        minProcessStartTs = Math.min(minProcessStartTs, process.startAt.getTime());
      }
      if (process.plannedEndAt) {
        maxProcessEndTs = Math.max(maxProcessEndTs, process.plannedEndAt.getTime());
      }
    }
  }

  const rawStartTs = Number.isFinite(minProcessStartTs) ? minProcessStartTs : minTaskStartTs;
  const desiredStartDate = new Date(rawStartTs);
  desiredStartDate.setHours(0, 0, 0, 0);
  const desiredStartTs = desiredStartDate.getTime();
  const rawEndTs = Number.isFinite(maxProcessEndTs) ? maxProcessEndTs : maxTaskEndTs;
  const desiredEndDate = new Date(rawEndTs);
  desiredEndDate.setHours(23, 59, 59, 999);
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

  const desiredStartTs = timeline.desiredStart.getTime();
  const desiredEndTs = timeline.desiredEnd.getTime();
  const minTaskStartTs = timeline.minTaskStart.getTime();
  const maxTaskEndTs = timeline.maxTaskEnd.getTime();

  const startPadMs = mode === "hour" ? Math.max(0, minTaskStartTs - desiredStartTs) : 0;
  const endPadMs = Math.max(0, desiredEndTs - maxTaskEndTs);

  return {
    startPadding: toIntervalSeconds(startPadMs),
    endPadding: toIntervalSeconds(endPadMs),
  };
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

export type ProcessStatus = "QUEUED" | "IN_WORK" | "COMPLETED" | "EXPIRED";
export type StageStatus = ProcessStatus;

export type ManualGanttViewMode = "hour" | "day" | "week" | "month";
export type GanttViewMode = ManualGanttViewMode;

export type ProcessMetaValue = string | number | boolean | null;
export type ProcessMeta = Record<string, ProcessMetaValue>;

export interface StageProcess {
  id: string;
  title: string;
  durationMin: number;
  startAt?: Date;
  plannedEndAt?: Date;
  regStartDate?: Date;
  regFinishDate?: Date;
  status: ProcessStatus;
  comment?: string;
  delayReason?: string;
  meta: ProcessMeta;
  updatedAt: Date;
}

export interface Stage {
  id: string;
  title: string;
  start: Date;
  processes: StageProcess[];
}

export interface ComputedStageTask {
  stageId: string;
  stageTitle: string;
  start: Date;
  end: Date;
  totalDurationMin: number;
  doneDurationMin: number;
  processCount: number;
  doneCount: number;
  progressPercent: number;
  derivedStatus: StageStatus;
}

export interface StageTaskViewModel extends ComputedStageTask {
  barClassName: string;
}

export interface ProcessPatch {
  status?: ProcessStatus;
  durationMin?: number;
  comment?: string;
  delayReason?: string;
}

export interface PendingProcessUpdate {
  stageId: string;
  processId: string;
  patch: ProcessPatch;
}

export interface TooltipState {
  open: boolean;
  stageId: string | null;
  targetElement: Element | null;
}

export interface StageProcessApiDto {
  id: string;
  title: string;
  durationMin: number;
  startAt?: string;
  plannedEndAt?: string;
  regStartDate?: string;
  regFinishDate?: string;
  status: ProcessStatus;
  comment?: string;
  delayReason?: string;
  meta?: ProcessMeta;
  updatedAt: string;
}

export interface StageApiDto {
  id: string;
  title: string;
  start: string;
  processes: StageProcessApiDto[];
}

export interface StagesApiResponse {
  generatedAt: string;
  source: string;
  stages: StageApiDto[];
}

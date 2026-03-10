import type { GanttViewMode, ProcessStatus } from "./types";

type StatusTagKind = "success" | "warning" | "danger" | "primary" | "neutral";

export const STATUS_KIND_BY_PROCESS_STATUS: Record<ProcessStatus, StatusTagKind> = {
  QUEUED: "neutral",
  IN_WORK: "primary",
  COMPLETED: "success",
  EXPIRED: "danger",
};

export const STATUS_LABEL_BY_PROCESS_STATUS: Record<ProcessStatus, string> = {
  QUEUED: "В очереди",
  IN_WORK: "В работе",
  COMPLETED: "Завершен",
  EXPIRED: "Просрочен",
};

export const VIEW_MODE_LABEL_BY_VALUE: Record<GanttViewMode, string> = {
  hour: "Hour",
  day: "Day",
  week: "Week",
  month: "Month",
};

import type { ProcessMeta, ProcessStatus, Stage, StageApiDto } from "./types";

export type StagesDataMode = "api" | "demo";

export const STAGES_API_DEFAULT_URL = "http://localhost:3001/api/stages";
export const PROCESS_UPDATE_API_BASE_DEFAULT_URL = "http://localhost:3001/api/stages";
export const STAGES_POLL_INTERVAL_MS = 30_000;
export const DEMO_STAGES_DATA_URL = `${import.meta.env.BASE_URL}demo/stages.json`;

const PROCESS_STATUSES: readonly ProcessStatus[] = ["QUEUED", "IN_WORK", "COMPLETED", "EXPIRED"];
const LEGACY_PROCESS_STATUS_MAP: Record<string, ProcessStatus> = {
  ok: "IN_WORK",
  delayed: "EXPIRED",
  blocked: "QUEUED",
  done: "COMPLETED",
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
};

const readNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const toDate = (value: unknown, fallback: Date): Date => {
  const parsed = new Date(readString(value, ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const readOptionalDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeStatus = (value: unknown): ProcessStatus => {
  if (typeof value === "string" && PROCESS_STATUSES.includes(value as ProcessStatus)) {
    return value as ProcessStatus;
  }
  if (typeof value === "string" && value in LEGACY_PROCESS_STATUS_MAP) {
    return LEGACY_PROCESS_STATUS_MAP[value];
  }
  return "QUEUED";
};

const normalizeMeta = (value: unknown): ProcessMeta => {
  if (!isObject(value)) {
    return {};
  }

  const next: ProcessMeta = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean" ||
      rawValue === null
    ) {
      next[key] = rawValue;
    }
  }
  return next;
};

const toStageApiDtoArray = (payload: unknown): StageApiDto[] => {
  if (Array.isArray(payload)) {
    return payload as StageApiDto[];
  }

  if (isObject(payload) && Array.isArray(payload.stages)) {
    return payload.stages as StageApiDto[];
  }

  return [];
};

export const resolveStagesDataMode = (value: string | undefined): StagesDataMode => {
  return value === "demo" ? "demo" : "api";
};

export const parseStagesPayload = (payload: unknown): Stage[] => {
  const rawStages = toStageApiDtoArray(payload);
  if (rawStages.length === 0) {
    return [];
  }

  return rawStages
    .map((rawStage, stageIndex) => {
      const stageRecord: Record<string, unknown> = isObject(rawStage) ? rawStage : {};
      const stageId = readString(stageRecord.id, `stage-${stageIndex + 1}`);
      const start = toDate(stageRecord.start, new Date());
      const processes: unknown[] = Array.isArray(stageRecord.processes) ? stageRecord.processes : [];

      return {
        id: stageId,
        title: readString(stageRecord.title, `Stage ${stageIndex + 1}`),
        start,
        processes: processes.map((rawProcess: unknown, processIndex: number) => {
          const processRecord: Record<string, unknown> = isObject(rawProcess) ? rawProcess : {};
          const startAt = readOptionalDate(processRecord.startAt ?? processRecord.start);
          const plannedEndAt = readOptionalDate(
            processRecord.plannedEndAt ?? processRecord.regulatoryEndAt ?? processRecord.end,
          );
          const regStartDate = readOptionalDate(processRecord.regStartDate ?? processRecord.regulatoryStartAt);
          const regFinishDate = readOptionalDate(processRecord.regFinishDate ?? processRecord.regulatoryEndAt);
          return {
            id: readString(processRecord.id, `${stageId}-process-${processIndex + 1}`),
            title: readString(processRecord.title, `Process ${processIndex + 1}`),
            durationMin: Math.max(1, Math.round(readNumber(processRecord.durationMin, 1))),
            startAt,
            plannedEndAt,
            regStartDate,
            regFinishDate,
            status: normalizeStatus(processRecord.status),
            comment: typeof processRecord.comment === "string" ? processRecord.comment : undefined,
            delayReason: typeof processRecord.delayReason === "string" ? processRecord.delayReason : undefined,
            meta: normalizeMeta(processRecord.meta),
            updatedAt: toDate(processRecord.updatedAt, new Date()),
          };
        }),
      };
    })
    .filter((stage) => stage.processes.length > 0);
};

export const fetchStagesFromApi = async (
  url: string,
  signal?: AbortSignal,
): Promise<Stage[]> => {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch stages: ${response.status} ${response.statusText}`);
  }

  const payload: unknown = await response.json();
  const parsedStages = parseStagesPayload(payload);

  if (parsedStages.length === 0) {
    throw new Error("Stages API returned empty or invalid payload.");
  }

  return parsedStages;
};

export const fetchStagesFromSource = async ({
  mode,
  apiUrl,
  signal,
}: {
  mode: StagesDataMode;
  apiUrl: string;
  signal?: AbortSignal;
}): Promise<Stage[]> => {
  const sourceUrl = mode === "demo" ? DEMO_STAGES_DATA_URL : apiUrl;
  return fetchStagesFromApi(sourceUrl, signal);
};

export const updateProcessOnApi = async (
  baseUrl: string,
  stageId: string,
  processId: string,
  patch: {
    status?: ProcessStatus;
    durationMin?: number;
    comment?: string;
    delayReason?: string;
  },
): Promise<void> => {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(stageId)}/processes/${encodeURIComponent(processId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(patch),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to update process: ${response.status} ${response.statusText}`);
  }
};

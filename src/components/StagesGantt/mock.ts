import type { Stage } from "./types";

const now = new Date();
const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);

const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60_000);
};

const toProcess = (
  id: string,
  title: string,
  startAt: Date,
  durationMin: number,
  status: "ok" | "delayed" | "blocked" | "done",
  meta: Record<string, string | number | boolean>,
  extras?: { comment?: string; delayReason?: string },
) => {
  const plannedEndAt = addMinutes(startAt, durationMin);
  return {
    id,
    title,
    durationMin,
    startAt,
    plannedEndAt,
    status,
    comment: extras?.comment,
    delayReason: extras?.delayReason,
    meta,
    updatedAt: plannedEndAt,
  };
};

const intakeStart = base;
const integrationStart = addMinutes(base, 260);
const releaseStart = addMinutes(base, 580);

export const mockStages: Stage[] = [
  {
    id: "stage-intake",
    title: "Intake / Input preparation",
    start: intakeStart,
    processes: [
      toProcess(
        "proc-1",
        "Collect source data",
        intakeStart,
        95,
        "done",
        { owner: "Anna", ticket: "OPS-101", system: "CRM" },
        { comment: "Export finished without errors." },
      ),
      toProcess("proc-2", "Validate required fields", addMinutes(intakeStart, 100), 60, "ok", {
        owner: "Ilya",
        ticket: "OPS-114",
        retries: 1,
      }),
      toProcess(
        "proc-3",
        "Normalize timezone",
        addMinutes(intakeStart, 165),
        45,
        "delayed",
        { owner: "Nikita", ticket: "INT-33" },
        { delayReason: "Waiting for UTC offset fix in source system" },
      ),
      toProcess("proc-4", "Build payload", addMinutes(intakeStart, 220), 35, "ok", {
        owner: "Sveta",
        queue: "etl-stage-a",
      }),
    ],
  },
  {
    id: "stage-integration",
    title: "Integration and orchestration",
    start: integrationStart,
    processes: [
      toProcess("proc-5", "Run orchestration DAG", integrationStart, 75, "done", {
        owner: "Pavel",
        scheduler: "Airflow",
        runId: 23874,
      }),
      toProcess(
        "proc-6",
        "Sync customer profiles",
        addMinutes(integrationStart, 80),
        120,
        "blocked",
        { owner: "Oleg", ticket: "AUTH-52", partner: "BillingCore" },
        { delayReason: "Partner token expired" },
      ),
      toProcess("proc-7", "Check idempotency keys", addMinutes(integrationStart, 210), 55, "ok", {
        owner: "Alina",
        ticket: "INT-79",
      }),
      toProcess(
        "proc-8",
        "Collect lag telemetry",
        addMinutes(integrationStart, 270),
        40,
        "delayed",
        { owner: "Denis", topic: "metrics-lag", partition: 6 },
        { delayReason: "Kafka backlog" },
      ),
    ],
  },
  {
    id: "stage-release",
    title: "Verification and release",
    start: releaseStart,
    processes: [
      toProcess("proc-9", "Checksum verification", releaseStart, 50, "done", {
        owner: "Marina",
        checksum: "sha256",
      }),
      toProcess("proc-10", "Business rules validation", addMinutes(releaseStart, 55), 70, "done", {
        owner: "Roman",
        ruleset: "v7.1",
        qa: true,
      }),
      toProcess("proc-11", "Smoke test", addMinutes(releaseStart, 130), 30, "ok", {
        owner: "Natalia",
        env: "staging-eu",
      }),
      toProcess("proc-12", "Publish report", addMinutes(releaseStart, 165), 20, "ok", {
        owner: "Fedor",
        channel: "release-notes",
      }),
    ],
  },
];

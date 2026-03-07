# Mockoon setup for StagesGantt

## Option A: import ready environment

1. Open Mockoon.
2. Import file: `mockoon/stages-environment.json`.
3. Start the environment on `http://localhost:3001`.

The endpoint is:
- `GET /api/stages`
- `PATCH /api/stages/:stageId/processes/:processId`

Important payload fields for timeline bounds:
- `processes[].startAt` - process start date
- `processes[].plannedEndAt` - planned/regulatory process end date

## Option B: use body payload file manually

1. Create `GET /api/stages` in Mockoon.
2. Set `Content-Type: application/json`.
3. Copy body from `mockoon/stages-response.json`.

## Option C: import as OpenAPI (Swagger/OpenAPI dialog)

1. In Mockoon choose `File -> New local environment from OpenAPI/Swagger`.
2. Import file `mockoon/openapi-stages.yaml`.
3. Start generated environment (set port `3001` if needed).

## Frontend config

Set endpoint URL for app:

```bash
VITE_STAGES_API_URL=http://localhost:3001/api/stages
VITE_PROCESS_UPDATE_API_BASE_URL=http://localhost:3001/api/stages
```

Then run app:

```bash
npm run dev
```

Polling interval is fixed in code:
- `30_000ms` (30 seconds).

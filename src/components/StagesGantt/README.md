# StagesGantt Architecture Guide

This document explains how `StagesGantt` works end-to-end after migration to Admiral UI.

## 1) What the widget does

- Renders one Gantt row per stage (processes are not separate rows).
- Stage bar length is derived from process dates, not from raw duration sum.
- Stage progress is derived from `COMPLETED` process durations.
- Stage color is derived from process statuses (`QUEUED`, `IN_WORK`, `COMPLETED`, `EXPIRED`).
- Time scale can switch (`hour`, `day`, `week`, `month`).
- Tooltip is interactive and anchored to the stage bar.
- Modal edits process fields and updates chart immediately.
- Supports frequent runtime updates with throttled batching.

## 2) Main files

- `types.ts`: strict domain types and UI state contracts.
- `mock.ts`: demo data for stages/processes.
- `utils.ts`: all pure calculations and mapping to `frappe-gantt` tasks.
- `StagesGantt.tsx`: orchestration, effects, batching, chart sync.
- `ProcessTooltip.tsx`: Admiral `Tooltip` with clickable process actions.
- `ProcessDetailsModal.tsx`: Admiral `Modal` with process edit actions.
- `styles.tsx`: AdmiralDS layout wrappers + themed chart/tooltip/modal styling.
- `styles.css`: base `frappe-gantt` stylesheet import only.

## 3) Data model and derived values

Input model:
- `Stage`: `id`, `title`, `start`, `processes[]`.
- `StageProcess`: `durationMin`, `status`, `comment`, `delayReason`, `meta`, `startAt`, `plannedEndAt`, `regStartDate`, `regFinishDate`.

Derived model (`computeStageTask`):
- `start`: regulatory start by default, or actual start when the previous process finished earlier.
- `end`: max date among process finish dates inside the stage.
- `doneDurationMin`: sum of durations with `status === "COMPLETED"`.
- `progressPercent`: `doneDurationMin / totalDurationMin * 100`.
- `derivedStatus`: priority `EXPIRED > IN_WORK > QUEUED`; if all completed then `COMPLETED`.

Normalization:
- Duration is clamped to at least `1`.
- Invalid numbers are sanitized.

## 4) Why there are many refs

DOM refs:
- `containerRef`: mount point for `new Gantt(...)`, delegated mouse/focus listeners.
- `tooltipRef`: click-outside and hover transition checks.

Imperative integration:
- `ganttRef`: external chart instance (`refresh`, `update_task`, `change_view_mode`).

Async state snapshots (avoid stale closure):
- `stagesRef`: always-current value inside intervals/callbacks.
- `pendingUpdatesRef`: in-memory queue for incoming process patches.
- `previousTaskMapRef`: previous chart tasks for diff-based minimal updates.

Timer refs:
- `flushTimerRef`: throttled flush timer.
- `tooltipCloseTimerRef`: delayed close timer for anti-flicker.
- `nowLineTimerRef`: minute tick for current-time line refresh.

## 5) State overview

- `stages`: source of truth for data.
- `viewMode`: active chart scale.
- `pollingEnabled`: toggles backend polling.
- `tooltipState`: open flag + stage id + current tooltip target element.
- `modalTarget`: selected `{ stageId, processId }` for edit modal.

Memoized maps:
- `taskViewModels`: computed stage bars.
- `stageMap`, `computedMap`: O(1) lookup for tooltip/modal contexts.

## 6) Runtime flow

### 6.1 Incoming updates

Any patch (`stageId`, `processId`, `patch`) goes through one gateway:

1. `queueProcessUpdate`.
2. Added into `pendingUpdatesRef`.
3. Immediate flush (for user action) or throttled flush.
4. `flushQueuedUpdates` applies all queued patches immutably.
5. `setStages(nextStages)` triggers recomputation.
6. `useMutation(PATCH)` sends the same patch to backend.
7. On success: query invalidation + immediate `refetch()` of stages.
8. On error: rollback to pre-change snapshot.

### 6.2 Chart synchronization

Effect on `taskViewModels`:
- Build `nextTasks`.
- Compare with `previousTaskMapRef`.
- If ids changed: full `gantt.refresh`.
- Else: call `gantt.update_task` only for changed tasks.

This keeps re-renders and visual artifacts low under frequent updates.

## 7) Interactive tooltip logic

Tooltip uses Admiral `Tooltip` with `targetElement` set to current stage bar node.

Anti-flicker behavior:
- On bar/tooltip enter: cancel close timer (`keepTooltipOpen`).
- On leave: delayed close (`scheduleTooltipClose`).
- On outside click or `Esc`: immediate close.

Result:
- Tooltip stays open while pointer moves from bar to tooltip.
- Tooltip supports clickable actions without instant disappear.

## 8) Modal edit flow

`ProcessDetailsModal` uses Admiral `Modal`:
- edit `status`, `durationMin`, `comment`, `delayReason`;
- view process `meta`;
- save writes patch back to chart pipeline.

Save path:
1. User clicks save.
2. `onSave(stageId, processId, patch)` stores rollback snapshot.
3. `queueProcessUpdate(..., true)` for optimistic immediate flush.
4. `PATCH /api/stages/:stageId/processes/:processId` is called.
5. Success => immediate backend refetch; Error => rollback.

## 9) REST backend integration

`react-query` handles both polling and user-driven sync:

- `useQuery` calls `fetchStagesFromApi`.
- `refetchInterval`: `30_000ms`.
- On new payload the component replaces `stages` with normalized data.
- Modal save uses optimistic local update + `useMutation` PATCH.
- After successful PATCH, chart data is force-refetched immediately (not waiting 30s).

Recommended:
- keep one in-flight poll only (`react-query` + `AbortSignal` in queryFn).
- use `updatedSince` or ETag to reduce payload.
- optimistic UI for modal edits + rollback on API error.

## 10) Admiral UI usage in this module

- `Tooltip`: process list overlay.
- `Modal`, `ModalTitle`, `ModalContent`, `ModalButtonPanel`: process editor.
- `Button`: actions in tooltip and modal.
- `Checkbox`: live-update toggle.
- Root setup in `main.tsx`: `QueryClientProvider`, `ThemeProvider`, `DropdownProvider`, `FontsVTBGroup`.

## 11) Extension points

- Add more process actions: extend `ProcessPatch`, update modal form.
- Add stage-level modal: reuse `stageMap` + selected stage id state.
- Replace polling with websocket: keep same queue/flush path.
- Add domain status rules: update `deriveStageStatus` only.

Core rule to keep stability:
- all state changes must go through `queueProcessUpdate`.

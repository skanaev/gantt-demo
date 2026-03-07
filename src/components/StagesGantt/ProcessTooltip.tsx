import { Button, Tooltip } from "@admiral-ds/react-ui";
import type { FocusEvent, KeyboardEvent, RefObject } from "react";
import type { ComputedStageTask, Stage } from "./types";
import { formatDuration } from "./utils";

interface ProcessTooltipProps {
  open: boolean;
  stage: Stage | null;
  computed: ComputedStageTask | null;
  targetElement: Element | null;
  tooltipRef: RefObject<HTMLDivElement | null>;
  onProcessOpen: (stageId: string, processId: string) => void;
  onRequestClose: () => void;
  onKeepOpen: () => void;
  onScheduleClose: () => void;
}

export function ProcessTooltip({
  open,
  stage,
  computed,
  targetElement,
  tooltipRef,
  onProcessOpen,
  onRequestClose,
  onKeepOpen,
  onScheduleClose,
}: ProcessTooltipProps) {
  if (!open || !stage || !computed || !targetElement) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onRequestClose();
    }
  };

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const nextNode = event.relatedTarget as Node | null;
    if (nextNode && event.currentTarget.contains(nextNode)) {
      return;
    }
    onScheduleClose();
  };

  return (
    <Tooltip
      className="process-tooltip-shell"
      ref={tooltipRef}
      targetElement={targetElement}
      tooltipPosition="bottom"
      renderContent={() => (
        <div
          className="process-tooltip"
          role="dialog"
          aria-label={`Процессы этапа ${stage.title}`}
          onMouseEnter={onKeepOpen}
          onMouseLeave={onScheduleClose}
          onFocusCapture={onKeepOpen}
          onBlurCapture={onBlurCapture}
          onKeyDown={onKeyDown}
          tabIndex={-1}
        >
          <div className="process-tooltip__header">
            <div>
              <div className="process-tooltip__title">{stage.title}</div>
              <div className="process-tooltip__summary">
                Длительность: {formatDuration(computed.totalDurationMin)} | Прогресс: {computed.progressPercent}%
              </div>
            </div>
            <Button type="button" appearance="ghost" dimension="s" onClick={onRequestClose}>
              Закрыть
            </Button>
          </div>

          <ul className="process-tooltip__list">
            {stage.processes.map((process) => (
              <li key={process.id} className="process-tooltip__item">
                <div className="process-tooltip__row">
                  <span className="process-tooltip__name">{process.title}</span>
                  <span className={`status-chip status-chip--${process.status}`}>{process.status}</span>
                </div>
                <div className="process-tooltip__meta">
                  {formatDuration(process.durationMin)}
                  {process.delayReason ? ` | ${process.delayReason}` : ""}
                </div>
                <Button
                  type="button"
                  className="process-tooltip__open"
                  appearance="secondary"
                  dimension="s"
                  onClick={() => onProcessOpen(stage.id, process.id)}
                >
                  Подробнее
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    />
  );
}

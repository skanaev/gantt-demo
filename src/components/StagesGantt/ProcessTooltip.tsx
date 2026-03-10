import { Button, Tag, T, Tooltip } from "@admiral-ds/react-ui";
import type { FocusEvent, KeyboardEvent, RefObject } from "react";
import {
  TooltipCard,
  TooltipHeader,
  TooltipItem,
  TooltipItemHeader,
  TooltipList,
  TooltipMeta,
  TooltipTitleBlock,
} from "./styles";
import { STATUS_KIND_BY_PROCESS_STATUS, STATUS_LABEL_BY_PROCESS_STATUS } from "./presentation";
import type { ComputedStageTask, Stage } from "./types";
import { formatDuration } from "./utils";

const TOOLTIP_VIEWPORT_GAP_PX = 12;
const TOOLTIP_MIN_HEIGHT_PX = 180;

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

  const targetRect = targetElement.getBoundingClientRect();
  const spaceAbove = Math.max(0, targetRect.top - TOOLTIP_VIEWPORT_GAP_PX);
  const spaceBelow = Math.max(0, window.innerHeight - targetRect.bottom - TOOLTIP_VIEWPORT_GAP_PX);
  const tooltipPosition = spaceBelow >= spaceAbove ? "bottom" : "top";
  const tooltipMaxHeight = Math.max(
    TOOLTIP_MIN_HEIGHT_PX,
    (tooltipPosition === "bottom" ? spaceBelow : spaceAbove) - TOOLTIP_VIEWPORT_GAP_PX,
  );

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
      tooltipPosition={tooltipPosition}
      renderContent={() => (
        <TooltipCard
          $maxHeight={tooltipMaxHeight}
          role="dialog"
          aria-label={`Processes for ${stage.title}`}
          onMouseEnter={onKeepOpen}
          onMouseLeave={onScheduleClose}
          onFocusCapture={onKeepOpen}
          onBlurCapture={onBlurCapture}
          onKeyDown={onKeyDown}
          tabIndex={-1}
        >
          <TooltipHeader>
            <TooltipTitleBlock>
              <T as="div" font="Subtitle/Subtitle 2">
                {stage.title}
              </T>
              <T as="div" font="Body/Body 2 Long" color="Neutral/Neutral 50">
                Duration: {formatDuration(computed.totalDurationMin)} | Progress: {computed.progressPercent}% | Processes:{" "}
                {computed.processCount}
              </T>
            </TooltipTitleBlock>

            <Button type="button" appearance="ghost" dimension="s" onClick={onRequestClose}>
              Close
            </Button>
          </TooltipHeader>

          <TooltipList>
            {stage.processes.map((process) => (
              <TooltipItem key={process.id}>
                <TooltipItemHeader>
                  <div>
                    <T as="div" font="Subtitle/Subtitle 3">
                      {process.title}
                    </T>
                    <T as="div" font="Body/Body 2 Long" color="Neutral/Neutral 50">
                      {formatDuration(process.durationMin)}
                    </T>
                  </div>

                  <Tag dimension="s" kind={STATUS_KIND_BY_PROCESS_STATUS[process.status]}>
                    {STATUS_LABEL_BY_PROCESS_STATUS[process.status]}
                  </Tag>
                </TooltipItemHeader>

                <TooltipMeta>
                  {process.regStartDate ? (
                    <Tag dimension="s" kind="neutral">
                      Reg start: {process.regStartDate.toLocaleString()}
                    </Tag>
                  ) : null}
                  {process.regFinishDate ? (
                    <Tag dimension="s" kind="neutral">
                      Reg end: {process.regFinishDate.toLocaleString()}
                    </Tag>
                  ) : null}
                  {process.startAt ? (
                    <Tag dimension="s" kind="neutral">
                      Start: {process.startAt.toLocaleString()}
                    </Tag>
                  ) : null}
                  {process.plannedEndAt ? (
                    <Tag dimension="s" kind="neutral">
                      End: {process.plannedEndAt.toLocaleString()}
                    </Tag>
                  ) : null}
                  {process.delayReason ? (
                    <Tag dimension="s" kind="warning">
                      {process.delayReason}
                    </Tag>
                  ) : null}
                </TooltipMeta>

                <Button
                  type="button"
                  appearance="secondary"
                  dimension="s"
                  onClick={() => onProcessOpen(stage.id, process.id)}
                >
                  Details
                </Button>
              </TooltipItem>
            ))}
          </TooltipList>
        </TooltipCard>
      )}
    />
  );
}

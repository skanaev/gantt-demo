import {
  Button,
  Modal,
  ModalButtonPanel,
  ModalContent,
  ModalTitle,
  NumberInputField,
  Option,
  SelectField,
  T,
  TextField,
} from "@admiral-ds/react-ui";
import { useState, type ChangeEvent } from "react";
import {
  FormGrid,
  MetaHint,
  MetaKey,
  MetaList,
  MetaRow,
  MetaSection,
  MetaValue,
  ModalIntro,
} from "./styles";
import { STATUS_KIND_BY_PROCESS_STATUS, STATUS_LABEL_BY_PROCESS_STATUS } from "./presentation";
import type { ProcessPatch, ProcessStatus, Stage, StageProcess } from "./types";
import { formatDuration } from "./utils";

interface ProcessDetailsModalProps {
  open: boolean;
  stage: Stage | null;
  process: StageProcess | null;
  onClose: () => void;
  onSave: (stageId: string, processId: string, patch: ProcessPatch) => void;
}

const STATUS_OPTIONS: ProcessStatus[] = ["QUEUED", "IN_WORK", "COMPLETED", "EXPIRED"];

const parseDurationValue = (raw: string, fallback: number): number => {
  const digitsOnly = raw.replace(/[^\d]/g, "");
  const parsed = Number(digitsOnly);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

export function ProcessDetailsModal({ open, stage, process, onClose, onSave }: ProcessDetailsModalProps) {
  const [durationMin, setDurationMin] = useState<number>(process?.durationMin ?? 1);
  const [status, setStatus] = useState<ProcessStatus>(process?.status ?? "QUEUED");
  const [comment, setComment] = useState<string>(process?.comment ?? "");
  const [delayReason, setDelayReason] = useState<string>(process?.delayReason ?? "");

  if (!open || !stage || !process) {
    return null;
  }

  const metaEntries = Object.entries(process.meta);

  const saveChanges = () => {
    onSave(stage.id, process.id, {
      status,
      durationMin: Math.max(1, Number.isFinite(durationMin) ? durationMin : process.durationMin),
      comment: comment.trim(),
      delayReason: delayReason.trim(),
    });
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      closeOnEscapeKeyDown
      closeOnOutsideClick
      displayCloseIcon
      aria-label={`Edit process ${process.title}`}
    >
      <ModalTitle>{process.title}</ModalTitle>
      <ModalContent>
        <ModalIntro>
          <T as="div" font="Body/Body 2 Long" color="Neutral/Neutral 50">
            Stage: {stage.title}
          </T>
          <T as="div" font="Body/Body 2 Long" color="Neutral/Neutral 50">
            Last update: {process.updatedAt.toLocaleString()}
          </T>
          <T as="div" font="Body/Body 2 Long" color="Neutral/Neutral 50">
            Current status: {STATUS_LABEL_BY_PROCESS_STATUS[process.status]}
          </T>
        </ModalIntro>

        <FormGrid>
          <SelectField
            label="Status"
            value={status}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value as ProcessStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <Option value={option} key={option}>
                {STATUS_LABEL_BY_PROCESS_STATUS[option]}
              </Option>
            ))}
          </SelectField>

          <NumberInputField
            label="Duration, min"
            value={String(durationMin)}
            precision={0}
            minValue={1}
            step={1}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDurationMin(parseDurationValue(event.target.value, process.durationMin))
            }
          />

          <TextField
            label="Comment"
            value={comment}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setComment(event.target.value)}
            autoHeight={{ minRows: 3, maxRows: 6 }}
          />

          <TextField
            label="Delay reason"
            value={delayReason}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDelayReason(event.target.value)}
            autoHeight={{ minRows: 2, maxRows: 5 }}
          />
        </FormGrid>

        <MetaSection>
          <T as="div" font="Subtitle/Subtitle 2">
            Meta
          </T>
          <MetaList>
            {metaEntries.map(([key, value]) => (
              <MetaRow key={key}>
                <MetaKey>
                  <T as="span" font="Body/Body 2 Long" color="Neutral/Neutral 50">
                    {key}
                  </T>
                </MetaKey>
                <MetaValue>
                  <T as="span" font="Body/Body 2 Long">
                    {String(value)}
                  </T>
                </MetaValue>
              </MetaRow>
            ))}
          </MetaList>

          <MetaHint>
            <T as="div" font="Body/Body 2 Long">
              Planned duration: {formatDuration(process.durationMin)} | Status token:{" "}
              {STATUS_KIND_BY_PROCESS_STATUS[status]}
            </T>
          </MetaHint>
        </MetaSection>
      </ModalContent>
      <ModalButtonPanel>
        <Button type="button" appearance="primary" onClick={saveChanges}>
          Save
        </Button>
        <Button type="button" appearance="secondary" onClick={onClose}>
          Cancel
        </Button>
      </ModalButtonPanel>
    </Modal>
  );
}

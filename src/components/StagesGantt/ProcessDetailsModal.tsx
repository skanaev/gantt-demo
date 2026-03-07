import { Button, Checkbox, Modal, ModalButtonPanel, ModalContent, ModalTitle } from "@admiral-ds/react-ui";
import { useEffect, useMemo, useState } from "react";
import type { ProcessPatch, ProcessStatus, Stage, StageProcess } from "./types";
import { formatDuration } from "./utils";

interface ProcessDetailsModalProps {
  open: boolean;
  stage: Stage | null;
  process: StageProcess | null;
  onClose: () => void;
  onSave: (stageId: string, processId: string, patch: ProcessPatch) => void;
}

const STATUS_OPTIONS: ProcessStatus[] = ["ok", "delayed", "blocked", "done"];

export function ProcessDetailsModal({ open, stage, process, onClose, onSave }: ProcessDetailsModalProps) {
  const [durationMin, setDurationMin] = useState<number>(process?.durationMin ?? 1);
  const [status, setStatus] = useState<ProcessStatus>(process?.status ?? "ok");
  const [comment, setComment] = useState<string>(process?.comment ?? "");
  const [delayReason, setDelayReason] = useState<string>(process?.delayReason ?? "");

  useEffect(() => {
    if (!open || !process) {
      return;
    }
    setDurationMin(process.durationMin);
    setStatus(process.status);
    setComment(process.comment ?? "");
    setDelayReason(process.delayReason ?? "");
  }, [open, process]);

  const metaEntries = useMemo(() => {
    if (!process) {
      return [];
    }
    return Object.entries(process.meta);
  }, [process]);

  if (!open || !stage || !process) {
    return null;
  }

  const saveChanges = () => {
    onSave(stage.id, process.id, {
      status,
      durationMin: Math.max(1, Number.isFinite(durationMin) ? durationMin : process.durationMin),
      comment: comment.trim(),
      delayReason: delayReason.trim(),
    });
    onClose();
  };

  const markDone = () => {
    setStatus("done");
  };

  return (
    <Modal
      onClose={onClose}
      closeOnEscapeKeyDown
      closeOnOutsideClick
      displayCloseIcon
      aria-label={`Редактирование процесса ${process.title}`}
    >
      <ModalTitle>{process.title}</ModalTitle>
      <ModalContent>
        <div className="process-modal__section">
          <div className="process-modal__stage">Этап: {stage.title}</div>
          <div className="process-modal__updated">Последнее обновление: {process.updatedAt.toLocaleString()}</div>
        </div>

        <div className="process-modal__section process-modal__fields">
          <label className="process-modal__label">
            <span>Статус</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ProcessStatus)}>
              {STATUS_OPTIONS.map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="process-modal__label">
            <span>Duration (мин)</span>
            <input
              type="number"
              min={1}
              value={durationMin}
              onChange={(event) => setDurationMin(Math.max(1, Number(event.target.value)))}
            />
          </label>

          <label className="process-modal__label process-modal__checkbox">
            <Checkbox checked={status === "done"} onChange={markDone} />
            <span>Пометить выполненным</span>
          </label>

          <label className="process-modal__label">
            <span>Комментарий</span>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} />
          </label>

          <label className="process-modal__label">
            <span>Причина задержки</span>
            <textarea value={delayReason} onChange={(event) => setDelayReason(event.target.value)} rows={2} />
          </label>
        </div>

        <div className="process-modal__section">
          <div className="process-modal__subtitle">Meta</div>
          <dl className="process-modal__meta">
            {metaEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="process-modal__hint">Текущая длительность: {formatDuration(process.durationMin)}</div>
        </div>
      </ModalContent>
      <ModalButtonPanel>
        <Button type="button" appearance="primary" onClick={saveChanges}>
          Сохранить
        </Button>
        <Button type="button" appearance="secondary" onClick={onClose}>
          Отмена
        </Button>
      </ModalButtonPanel>
    </Modal>
  );
}

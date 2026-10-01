import { useEffect, useRef } from 'react';
import { Button, Dialog } from './ui';
interface Props {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
  loading?: boolean;
}
export default function ConfirmModal({
  isOpen,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Да, удалить',
  cancelLabel = 'Отмена',
  confirmClass,
  loading,
}: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) cancel.current?.focus();
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <Dialog
      title="Подтвердите действие"
      onClose={onCancel}
      footer={
        <>
          <Button ref={cancel} variant="secondary" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="danger"
            loading={loading}
            className={confirmClass || ''}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
    </Dialog>
  );
}

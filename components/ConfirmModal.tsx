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
  error?: string | null;
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
  error,
}: Props) {
  if (!isOpen) return null;
  return (
    <Dialog
      title="Подтвердите действие"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={onCancel}>
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
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm leading-relaxed text-red-800"
        >
          {error}
        </p>
      )}
    </Dialog>
  );
}

import React, { useEffect, useId, useRef } from 'react';

interface Props {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
}

const ConfirmModal: React.FC<Props> = ({ isOpen, message, onConfirm, onCancel,
  confirmLabel = 'Да, удалить', cancelLabel = 'Отмена', confirmClass = 'bg-red-600 active:bg-red-700' }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const label = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!isOpen || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    cancelButton.current?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return <dialog ref={dialog} aria-labelledby={label}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm">
    <div className="flex h-full items-center justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl">
        <h2 id={label} className="mb-6 text-center text-lg font-bold leading-tight text-gray-900">{message}</h2>
        <div className="flex gap-3">
          <button ref={cancelButton} type="button" onClick={onCancel}
            className="flex-1 rounded-2xl bg-gray-100 py-3.5 text-xs font-black uppercase tracking-wider text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500">{cancelLabel}</button>
          <button type="button" onClick={onConfirm}
            className={`flex-1 rounded-2xl py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  </dialog>;
};
export default ConfirmModal;

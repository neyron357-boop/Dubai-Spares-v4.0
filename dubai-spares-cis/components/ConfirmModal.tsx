import React from 'react';

interface Props {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
}

const ConfirmModal: React.FC<Props> = ({ 
  isOpen, 
  message, 
  onConfirm, 
  onCancel,
  confirmLabel = 'Да, удалить',
  cancelLabel = 'Отмена',
  confirmClass = 'bg-red-600 active:bg-red-700'
}) => {
  if (!isOpen) return null;
  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" 
      onClick={onCancel}
    >
      <div 
        className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 border border-gray-100" 
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-center mb-6 text-gray-900 leading-tight">{message}</h3>
        <div className="flex gap-3">
          <button 
            onClick={onCancel} 
            className="flex-1 py-3.5 bg-gray-100 rounded-2xl font-black text-gray-600 active:bg-gray-200 transition-colors uppercase text-xs tracking-wider"
          >
            {cancelLabel}
          </button>
          <button 
            onClick={onConfirm} 
            className={`flex-1 py-3.5 rounded-2xl font-black text-white transition-colors shadow-lg uppercase text-xs tracking-wider ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;

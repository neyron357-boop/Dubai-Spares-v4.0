import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import MessagePressSurface from './MessagePressSurface';
import { ModalSurface } from './ui';
import '../styles/chat-messages.css';

export default function DraftAttachment({
  children,
  onRemove,
  label,
  className = '',
}: {
  children: ReactNode;
  onRemove: () => void;
  label: string;
  className?: string;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <>
      <MessagePressSurface
        as="div"
        label={label}
        className={`chat-draft-media ${className}`}
        onActions={() => setMenu(true)}
      >
        {children}
      </MessagePressSurface>
      {menu && (
        <ModalSurface
          label="Действия с вложением"
          onClose={() => setMenu(false)}
          className="chat-actions-layer"
        >
          <div className="chat-actions-panel">
            <span className="chat-actions-handle" aria-hidden="true" />
            <div className="chat-actions-heading">Вложение в черновике</div>
            <button
              type="button"
              className="chat-action is-danger"
              onClick={() => {
                setMenu(false);
                onRemove();
              }}
            >
              <Trash2 size={21} />
              <span>Убрать из черновика</span>
            </button>
            <button
              type="button"
              className="chat-action chat-action-cancel"
              onClick={() => setMenu(false)}
            >
              Отмена
            </button>
          </div>
        </ModalSurface>
      )}
    </>
  );
}

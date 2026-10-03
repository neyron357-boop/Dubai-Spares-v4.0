import { ImagePlus, Pencil, Phone, Pin, PinOff, Heart, Trash2 } from 'lucide-react';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import type { Supplier } from '../types';
import { ModalSurface } from './ui';
import '../styles/supplier-actions.css';

export type SupplierActionsProps = {
  supplier: Supplier;
  error?: string | null;
  onPin: () => boolean;
  onFavorite: () => boolean;
  onPhoto: () => void;
  onEdit: () => void;
  onContact: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function SupplierActions({
  supplier,
  error,
  onPin,
  onFavorite,
  onPhoto,
  onEdit,
  onContact,
  onDelete,
  onClose,
}: SupplierActionsProps) {
  const viewport = useVisibleViewport();
  const name = supplier.name.trim() || 'Поставщик без названия';
  const PinIcon = supplier.isPinned ? PinOff : Pin;
  const act = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ModalSurface
      label="Действия с поставщиком"
      onClose={onClose}
      className="supplier-actions-layer"
    >
      <div
        className="supplier-actions-frame"
        style={{ top: viewport.offsetTop, height: viewport.height }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section className="supplier-actions-panel" aria-label={name}>
          <header className="supplier-actions-heading">
            <span className="supplier-actions-handle" aria-hidden="true" />
            <p>Действия с поставщиком</p>
            <h2 title={name}>{name}</h2>
          </header>

          <div className="supplier-actions-content">
            {error && (
              <p className="supplier-actions-error" role="alert">
                {error}
              </p>
            )}
            <div className="supplier-actions-list">
              <button
                type="button"
                onClick={() => {
                  if (onPin()) onClose();
                }}
              >
                <PinIcon size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>{supplier.isPinned ? 'Открепить' : 'Закрепить'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onFavorite()) onClose();
                }}
              >
                <Heart
                  size={20}
                  strokeWidth={1.7}
                  className={supplier.isFavorite ? 'is-favorite' : undefined}
                  aria-hidden="true"
                />
                <span>{supplier.isFavorite ? 'Убрать из избранного' : 'В избранное'}</span>
              </button>
              <button type="button" onClick={() => act(onContact)}>
                <Phone size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>Изменить контакты</span>
              </button>
              <button type="button" onClick={() => act(onPhoto)}>
                <ImagePlus size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>Добавить фото</span>
              </button>
              <button type="button" onClick={() => act(onEdit)}>
                <Pencil size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>Редактировать</span>
              </button>
              <button type="button" className="is-danger" onClick={() => act(onDelete)}>
                <Trash2 size={20} strokeWidth={1.7} aria-hidden="true" />
                <span>Удалить</span>
              </button>
            </div>
          </div>

          <footer className="supplier-actions-footer">
            <button type="button" onClick={onClose}>
              Закрыть
            </button>
          </footer>
        </section>
      </div>
    </ModalSurface>
  );
}

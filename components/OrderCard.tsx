import {
  Archive,
  ArrowUpRight,
  BadgeCheck,
  Car,
  Check,
  ChevronRight,
  Copy,
  Flag,
  FolderInput,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pin,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Order } from '../types';
import { Priority } from '../types';
import { getOrderCardView, isArchivedOrder } from '../utils/orderCard';
import { isUnreadLeadOrder } from '../utils/orderClassification';
import SafeImage from './SafeImage';
import { ModalSurface } from './ui';
import '../styles/order-cards.css';

type Props = {
  order: Order;
  selectionMode: boolean;
  selected: boolean;
  disabled?: boolean;
  contactLabel: string;
  contactAvailable: boolean;
  onActivate: () => void;
  onContact: () => void;
  onCopy: () => Promise<boolean>;
  onTogglePin: () => Promise<boolean>;
  onArchive: () => Promise<boolean>;
  onMove: () => void;
  onDelete: () => void;
};

export default function OrderCard({
  order,
  selectionMode,
  selected,
  disabled = false,
  contactLabel,
  contactAvailable,
  onActivate,
  onContact,
  onCopy,
  onTogglePin,
  onArchive,
  onMove,
  onDelete,
}: Props) {
  const view = useMemo(() => getOrderCardView(order), [order]);
  const archived = isArchivedOrder(order);
  const unread = isUnreadLeadOrder(order);
  const photo = order.carPhotos?.find(Boolean) || order.carPhotoUrl;
  const createdDate = new Date(order.createdAt);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdCleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(0);
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdCleanup.current?.();
    holdCleanup.current = null;
  }, []);
  useEffect(() => clearHold, [clearHold, selectionMode, disabled]);

  const openMenu = () => {
    if (selectionMode || disabled) return;
    setError('');
    trigger.current?.focus({ preventScroll: true });
    setMenu(true);
  };
  const action = async (label: string, run: () => Promise<boolean>) => {
    if (busy) return;
    setError('');
    setBusy(label);
    try {
      if (await run()) setMenu(false);
      else setError('Изменение не сохранено. Попробуйте ещё раз.');
    } catch {
      setError('Не удалось выполнить действие. Попробуйте ещё раз.');
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <article
        data-order-id={order.id}
        aria-label={`Заказ ${view.vehicleLabel}`}
        className={`order-card ${selected && selectionMode ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}`}
        onClick={(event) => {
          if (performance.now() < suppressClick.current) {
            event.preventDefault();
            return;
          }
          if (disabled || (event.target as Element).closest('button, a')) return;
          onActivate();
        }}
        onPointerDown={(event) => {
          clearHold();
          if (
            selectionMode ||
            disabled ||
            event.button !== 0 ||
            !event.isPrimary ||
            (event.target as Element).closest('button, a')
          )
            return;
          const { clientX: x, clientY: y, pointerId } = event;
          const move = (next: PointerEvent) => {
            if (next.pointerId === pointerId && Math.hypot(next.clientX - x, next.clientY - y) > 10)
              clearHold();
          };
          window.addEventListener('pointermove', move, { passive: true });
          window.addEventListener('pointerup', clearHold);
          window.addEventListener('pointercancel', clearHold);
          window.addEventListener('scroll', clearHold, { capture: true, passive: true });
          window.addEventListener('blur', clearHold);
          holdCleanup.current = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', clearHold);
            window.removeEventListener('pointercancel', clearHold);
            window.removeEventListener('scroll', clearHold, true);
            window.removeEventListener('blur', clearHold);
          };
          holdTimer.current = window.setTimeout(() => {
            suppressClick.current = performance.now() + 1000;
            clearHold();
            openMenu();
          }, 550);
        }}
        onContextMenu={(event) => {
          if (selectionMode || disabled) return;
          event.preventDefault();
          clearHold();
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <div className="order-card-top">
          <div className={`order-card-stage tone-${view.tone}`}>
            <span className="order-card-stage-dot" aria-hidden="true" />
            <span>{view.statusLabel}</span>
          </div>
          <div className="order-card-markers">
            {order.isPinned && <Pin size={13} aria-label="Закреплён" />}
            {order.isVip && <Star size={13} className="order-card-vip" aria-label="VIP" />}
            <time
              className="order-card-age"
              dateTime={
                Number.isFinite(createdDate.getTime()) ? createdDate.toISOString() : undefined
              }
            >
              {view.ageLabel}
            </time>
          </div>
          {selectionMode ? (
            <button
              type="button"
              className={`order-card-select ${selected ? 'is-checked' : ''}`}
              disabled={disabled}
              aria-label={selected ? 'Снять выбор заказа' : 'Выбрать заказ'}
              aria-pressed={selected}
              onClick={onActivate}
            >
              {selected ? <Check size={19} /> : <span aria-hidden="true" />}
            </button>
          ) : (
            <button
              type="button"
              ref={trigger}
              className="order-card-menu-trigger"
              aria-label={`Действия с заказом ${view.title}`}
              aria-haspopup="dialog"
              aria-expanded={menu}
              disabled={disabled}
              onClick={openMenu}
            >
              <MoreHorizontal size={20} />
            </button>
          )}
        </div>

        <div className="order-card-identity">
          <div className="order-card-photo">
            {photo ? (
              <SafeImage
                src={photo}
                alt={view.title}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ) : (
              <Car size={29} strokeWidth={1.4} aria-hidden="true" />
            )}
          </div>
          <div className="order-card-details">
            <h3 className="order-card-title">
              <button
                type="button"
                aria-label={`${selectionMode ? (selected ? 'Снять выбор заказа' : 'Выбрать заказ') : 'Открыть заказ'} ${view.title}`}
                disabled={disabled}
                onClick={onActivate}
              >
                {view.title}
              </button>
            </h3>
            <p className="order-card-subtitle">
              {order.year && <span>{order.year}</span>}
              {unread && <span className="order-card-new">Новая заявка</span>}
              {order.priority === Priority.HIGH && (
                <span className="order-card-urgent">
                  <Flag size={11} aria-hidden="true" /> Срочно
                </span>
              )}
            </p>
            <p className="order-card-client">{view.clientLabel}</p>
          </div>
        </div>
        {order.vin?.trim() && (
          <p className="order-card-vin">
            <span>VIN</span>
            <span>{order.vin}</span>
          </p>
        )}

        <div className="order-card-progress">
          {view.totalParts > 0 ? (
            <>
              <div className="order-card-progress-heading">
                <span>Подобрано деталей</span>
                <strong>
                  {view.foundParts} <span>из {view.totalParts}</span>
                </strong>
              </div>
              <div
                className={`order-card-progress-track ${view.foundParts === view.totalParts ? 'is-complete' : ''}`}
                role="progressbar"
                aria-label="Подобрано деталей"
                aria-valuenow={view.foundParts}
                aria-valuemin={0}
                aria-valuemax={view.totalParts}
                aria-valuetext={`${view.foundParts} из ${view.totalParts}`}
              >
                <span style={{ width: `${view.progress}%` }} />
              </div>
            </>
          ) : (
            <p className="order-card-no-parts">
              Детали не добавлены <ChevronRight size={14} aria-hidden="true" />
            </p>
          )}
        </div>

        <div className="order-card-bottom">
          {view.paymentLabel ? (
            <span className="order-card-payment">
              <BadgeCheck size={14} strokeWidth={1.7} aria-hidden="true" />
              {view.paymentLabel}
            </span>
          ) : (
            <span className="order-card-order-ref">Заказ · {order.id.slice(0, 8)}</span>
          )}
          <ArrowUpRight size={17} className="order-card-open-hint" aria-hidden="true" />
        </div>
        {view.attention && (
          <p className="order-card-attention">
            <Flag size={13} aria-hidden="true" />
            {view.attention}
          </p>
        )}
      </article>

      {menu && (
        <ModalSurface
          label="Действия с заказом"
          onClose={() => {
            if (!busy) setMenu(false);
          }}
          className="order-actions-layer"
        >
          <div className="order-actions-panel">
            <div className="order-actions-scroll">
              <span className="order-actions-handle" aria-hidden="true" />
              <div className="order-actions-heading">
                <p>Действия с заказом</p>
                <h2>{view.vehicleLabel}</h2>
              </div>
              <div className="order-actions-list">
                <button
                  type="button"
                  disabled={!contactAvailable || !!busy}
                  onClick={() => {
                    onContact();
                    setMenu(false);
                  }}
                >
                  <MessageCircle size={19} />
                  <span>
                    {contactAvailable ? `Связаться · ${contactLabel}` : 'Контакт не указан'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  aria-busy={busy === 'copy'}
                  aria-label="Скопировать марку, модель и год"
                  onClick={() => void action('copy', onCopy)}
                >
                  {busy === 'copy' ? (
                    <LoaderCircle className="animate-spin" size={19} />
                  ) : (
                    <Copy size={19} />
                  )}
                  <span>Скопировать автомобиль</span>
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  aria-busy={busy === 'pin'}
                  onClick={() => void action('pin', onTogglePin)}
                >
                  {busy === 'pin' ? (
                    <LoaderCircle className="animate-spin" size={19} />
                  ) : (
                    <Pin size={19} />
                  )}
                  <span>{order.isPinned ? 'Открепить заказ' : 'Закрепить заказ'}</span>
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    setMenu(false);
                    onMove();
                  }}
                >
                  <FolderInput size={19} />
                  <span>Переместить заказ</span>
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  aria-busy={busy === 'archive'}
                  onClick={() => void action('archive', onArchive)}
                >
                  {busy === 'archive' ? (
                    <LoaderCircle className="animate-spin" size={19} />
                  ) : archived ? (
                    <RotateCcw size={19} />
                  ) : (
                    <Archive size={19} />
                  )}
                  <span>{archived ? 'Восстановить заказ' : 'В архив'}</span>
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  className="is-danger"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={19} />
                  <span>Удалить заказ</span>
                </button>
              </div>
              {error && (
                <p className="order-actions-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button
              type="button"
              className="order-actions-cancel"
              disabled={!!busy}
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

import {
  Check,
  Heart,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pin,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { Supplier, SupplierType } from '../types';
import {
  getSupplierBrands,
  getSupplierContacts,
  getSupplierLocationLabel,
} from '../utils/supplierPresentation';
import SafeImage from './SafeImage';
import '../styles/supplier-card.css';

export type SupplierCardProps = {
  supplier: Supplier;
  onOpen: () => void;
  onFavorite: () => void;
  onWhatsApp: () => void;
  onCall: () => void;
  onMenu: () => void;
  onEditContact?: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  favoriteBusy?: boolean;
  whatsappAvailable?: boolean;
  callAvailable?: boolean;
};

const TYPE_LABELS: Record<SupplierType, string> = {
  new_parts: 'Новые детали',
  scrapyard: 'Разбор',
  engine_specialist: 'Двигатели',
  body_parts: 'Кузов',
  electrical: 'Электрика',
  mixed: 'Запчасти',
  dealer: 'Дилер',
  warehouse: 'Склад',
};

const uniqueText = (values: string[] = []) =>
  Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() || '')
    .join('') || 'П';

export default function SupplierCard({
  supplier,
  onOpen,
  onFavorite,
  onWhatsApp,
  onCall,
  onMenu,
  onEditContact,
  selectionMode = false,
  selected = false,
  onSelect,
  disabled = false,
  favoriteBusy = false,
  whatsappAvailable,
  callAvailable,
}: SupplierCardProps) {
  const name = supplier.name.trim() || 'Поставщик без названия';
  const photo = supplier.photos?.find(Boolean) || supplier.photoUrl;
  const brands = getSupplierBrands(supplier);
  const contacts = getSupplierContacts(supplier);
  const canWhatsApp = whatsappAvailable ?? Boolean(contacts.whatsapp);
  const canCall = callAvailable ?? Boolean(contacts.phone);
  const models = uniqueText(supplier.models);
  const specialty = [brands.slice(0, 3).join(', '), models.slice(0, 2).join(', ')]
    .filter(Boolean)
    .join(' · ');
  const additionalSpecialties = Math.max(0, brands.length - 3) + Math.max(0, models.length - 2);
  const typeLabels = uniqueText(
    (supplier.types?.length ? supplier.types : supplier.type ? [supplier.type] : []).map(
      (type) => TYPE_LABELS[type] || '',
    ),
  );
  const place = getSupplierLocationLabel(supplier);
  const verified = supplier.supplierStatus === 'verified' || supplier.supplierStatus === 'trusted';
  const blacklisted = supplier.supplierStatus === 'blacklist';
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdCleanup = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdCleanup.current?.();
    holdCleanup.current = null;
  }, []);
  useEffect(() => clearHold, [clearHold, selectionMode, disabled]);

  const openMenu = () => {
    if (disabled || selectionMode) return;
    menuTrigger.current?.focus({ preventScroll: true });
    onMenu();
  };
  const activate = () => {
    if (disabled) return;
    if (selectionMode) onSelect?.();
    else onOpen();
  };

  return (
    <article
      id={`supplier-card-${supplier.id}`}
      data-supplier-id={supplier.id}
      aria-label={`Поставщик ${name}`}
      className={`supplier-card ${selectionMode && selected ? 'is-selected' : ''} ${blacklisted ? 'is-blacklisted' : ''}`}
      onClick={(event) => {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          return;
        }
        if ((event.target as Element).closest('button, a')) return;
        activate();
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
        const escape = (next: KeyboardEvent) => {
          if (next.key === 'Escape') clearHold();
        };
        window.addEventListener('pointermove', move, { passive: true });
        window.addEventListener('pointerup', clearHold);
        window.addEventListener('pointercancel', clearHold);
        window.addEventListener('scroll', clearHold, { capture: true, passive: true });
        window.addEventListener('blur', clearHold);
        window.addEventListener('keydown', escape);
        holdCleanup.current = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', clearHold);
          window.removeEventListener('pointercancel', clearHold);
          window.removeEventListener('scroll', clearHold, true);
          window.removeEventListener('blur', clearHold);
          window.removeEventListener('keydown', escape);
        };
        holdTimer.current = window.setTimeout(() => {
          suppressClickUntil.current = performance.now() + 1000;
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
      <div className="supplier-card-top">
        <div className="supplier-card-type">
          {supplier.isPinned && <Pin size={13} strokeWidth={1.8} aria-label="Закреплён" />}
          <span>{typeLabels.join(' · ') || 'Поставщик'}</span>
        </div>
        {selectionMode ? (
          <button
            type="button"
            className={`supplier-card-select ${selected ? 'is-checked' : ''}`}
            aria-label={`${selected ? 'Снять выбор поставщика' : 'Выбрать поставщика'} ${name}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
          >
            {selected ? <Check size={19} /> : <span aria-hidden="true" />}
          </button>
        ) : (
          <div className="supplier-card-tools">
            <button
              type="button"
              className={`supplier-card-favorite ${supplier.isFavorite ? 'is-favorite' : ''}`}
              aria-label={`${supplier.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}: ${name}`}
              aria-pressed={supplier.isFavorite === true}
              aria-busy={favoriteBusy || undefined}
              disabled={disabled || favoriteBusy}
              onClick={onFavorite}
            >
              {favoriteBusy ? (
                <LoaderCircle size={19} className="supplier-card-spinner" />
              ) : (
                <Heart size={19} strokeWidth={1.7} />
              )}
            </button>
            <button
              type="button"
              ref={menuTrigger}
              className="supplier-card-menu"
              aria-label="Действия поставщика"
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={openMenu}
            >
              <MoreHorizontal size={21} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      <div className="supplier-card-identity">
        <div className="supplier-card-avatar" aria-hidden="true">
          {photo ? (
            <SafeImage src={photo} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <span>{initials(name)}</span>
          )}
        </div>
        <div className="supplier-card-details">
          <h3 className="supplier-card-name">
            <button
              type="button"
              aria-label={`${selectionMode ? (selected ? 'Снять выбор поставщика' : 'Выбрать поставщика') : 'Открыть поставщика'}: ${name}`}
              disabled={disabled}
              onClick={activate}
            >
              {name}
            </button>
          </h3>
          {specialty ? (
            <p className="supplier-card-specialty">
              {specialty}
              {additionalSpecialties > 0 && (
                <span className="supplier-card-more-specialties"> +{additionalSpecialties}</span>
              )}
            </p>
          ) : (
            <p className="supplier-card-specialty">Специализация не указана</p>
          )}
        </div>
      </div>

      <div className="supplier-card-meta">
        <p className={`supplier-card-location ${!place ? 'is-missing' : ''}`}>
          <MapPin size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>{place || 'Местоположение не указано'}</span>
        </p>
        {blacklisted ? (
          <p className="supplier-card-warning">
            <TriangleAlert size={14} aria-hidden="true" />
            <span>В чёрном списке</span>
          </p>
        ) : verified ? (
          <p className="supplier-card-verified">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>
              {supplier.supplierStatus === 'trusted' ? 'Доверенный поставщик' : 'Проверен'}
            </span>
          </p>
        ) : null}
      </div>

      {!selectionMode && (
        <div className={`supplier-card-actions ${canWhatsApp && canCall ? '' : 'is-single'}`}>
          <button
            type="button"
            className={canWhatsApp ? 'supplier-card-whatsapp' : 'supplier-card-contact'}
            disabled={disabled}
            aria-label={`${canWhatsApp ? 'WhatsApp' : canCall ? 'Позвонить' : 'Добавить контакт'}: ${name}`}
            onClick={canWhatsApp ? onWhatsApp : canCall ? onCall : onEditContact || onOpen}
          >
            {canWhatsApp ? (
              <MessageCircle size={18} strokeWidth={1.8} aria-hidden="true" />
            ) : canCall ? (
              <Phone size={18} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <UserPlus size={18} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span>
              {canWhatsApp ? 'Написать в WhatsApp' : canCall ? 'Позвонить' : 'Добавить контакт'}
            </span>
          </button>
          {canWhatsApp && canCall && (
            <button
              type="button"
              className="supplier-card-call"
              disabled={disabled}
              aria-label={`Позвонить: ${name}`}
              onClick={onCall}
            >
              <Phone size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

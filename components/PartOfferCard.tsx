import { Check, Images, MapPin, MessageCircle, Pencil, Star, Trash2 } from 'lucide-react';
import { PriceVariant } from '../types';
import { Button, IconButton } from './ui';
import { availabilityLabels, conditionLabels } from './PartOfferEditor';

export function formatOfferPrice(value: number | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: amount % 1 ? 2 : 0 })} AED`
    : 'Не указана';
}
export default function PartOfferCard({
  variant,
  selected,
  lowest,
  photo,
  photoCount,
  busy,
  editable,
  onSelect,
  onEdit,
  onDelete,
  onPhoto,
  onPhotoError,
  onWhatsapp,
  highlighted,
}: {
  variant: PriceVariant;
  selected: boolean;
  lowest: boolean;
  photo?: string;
  photoCount: number;
  busy: boolean;
  editable: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPhoto: () => void;
  onPhotoError: () => void;
  onWhatsapp: () => void;
}) {
  const hasPhone = (variant.phone || '').replace(/\D/g, '').length >= 7;
  return (
    <article
      id={`variant-${variant.id}`}
      className={`part-offer-card ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
      aria-label={`Вариант от ${variant.shopName || 'поставщика'}`}
    >
      {(selected || lowest) && (
        <div className="part-offer-flags">
          {selected ? (
            <span className="is-selected">
              <Check size={14} aria-hidden="true" /> Выбран для заказа
            </span>
          ) : (
            <span>Минимальная цена</span>
          )}
        </div>
      )}
      <div className="part-offer-top">
        {photo ? (
          <button
            type="button"
            className="part-offer-photo"
            aria-label={`Открыть фотографии варианта от ${variant.shopName}`}
            onClick={onPhoto}
          >
            <img src={photo} alt={`Предложение от ${variant.shopName}`} onError={onPhotoError} />
            {photoCount > 1 && <span>{photoCount}</span>}
          </button>
        ) : (
          <span className="part-offer-photo is-empty" aria-label="Фото не добавлено">
            <Images size={25} aria-hidden="true" />
          </span>
        )}
        <div className="part-offer-identity">
          <h3>{variant.shopName || 'Поставщик без названия'}</h3>
          <div className="part-offer-tags">
            <span>{conditionLabels[variant.condition || 'used']}</span>
            <span>{availabilityLabels[variant.availability || 'in_stock']}</span>
          </div>
          {(variant.locationText || variant.location) && (
            <p>
              <MapPin size={14} aria-hidden="true" />
              {variant.locationText || variant.location}
            </p>
          )}
        </div>
      </div>
      <div className="part-offer-price">
        <span>Закупка</span>
        <strong>{formatOfferPrice(variant.purchasePriceAed ?? variant.priceAed)}</strong>
        {variant.salePriceAed &&
        variant.salePriceAed !== (variant.purchasePriceAed ?? variant.priceAed) ? (
          <small>Продажа · {formatOfferPrice(variant.salePriceAed)}</small>
        ) : null}
      </div>
      {variant.note && <p className="part-offer-note">{variant.note}</p>}
      <div className="part-offer-actions">
        <Button
          variant={selected ? 'secondary' : 'primary'}
          disabled={busy}
          icon={selected ? Check : Star}
          aria-pressed={selected}
          title={selected ? 'Нажмите, чтобы отменить выбор' : 'Выбрать для заказа'}
          onClick={onSelect}
        >
          {selected ? 'Выбрано' : 'Выбрать'}
        </Button>
        <Button
          variant="secondary"
          icon={MessageCircle}
          disabled={!hasPhone}
          title={hasPhone ? 'Открыть чат поставщика' : 'Телефон поставщика не указан'}
          onClick={onWhatsapp}
        >
          WhatsApp
        </Button>
      </div>
      <footer>
        <span>{hasPhone ? variant.phone : 'Телефон не указан'}</span>
        <div>
          <IconButton
            label={`Редактировать вариант от ${variant.shopName}`}
            icon={Pencil}
            disabled={busy || !editable}
            onClick={onEdit}
          />
          <IconButton
            label={`Удалить вариант от ${variant.shopName}`}
            icon={Trash2}
            disabled={busy}
            onClick={onDelete}
          />
        </div>
      </footer>
    </article>
  );
}

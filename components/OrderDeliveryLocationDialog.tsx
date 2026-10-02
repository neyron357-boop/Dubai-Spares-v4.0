import { LoaderCircle, MapPin } from 'lucide-react';
import { useId, useState } from 'react';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { ModalSurface } from './ui';
import '../styles/order-delivery-location.css';

export type OrderDeliveryLocationDialogProps = {
  initialCountry: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (country: string) => void;
};

export default function OrderDeliveryLocationDialog({
  initialCountry,
  busy,
  error,
  onClose,
  onSave,
}: OrderDeliveryLocationDialogProps) {
  const [country, setCountry] = useState(initialCountry);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const viewport = useVisibleViewport();
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <ModalSurface label="Место доставки" onClose={close} className="order-delivery-layer">
      <div
        className="order-delivery-frame"
        style={{ top: viewport.offsetTop, height: viewport.height }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <form
          className="order-delivery-panel"
          aria-busy={busy || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            const value = country.trim();
            if (value && !busy) onSave(value);
          }}
        >
          <header className="order-delivery-heading">
            <span className="order-delivery-handle" aria-hidden="true" />
            <div>
              <span className="order-delivery-heading-icon" aria-hidden="true">
                <MapPin size={21} strokeWidth={1.7} />
              </span>
              <div>
                <h2>Место доставки</h2>
                <p id={hintId}>Для доставки за пределы ОАЭ.</p>
              </div>
            </div>
          </header>

          <div className="order-delivery-content">
            <label htmlFor={inputId}>Страна доставки</label>
            <input
              id={inputId}
              type="text"
              name="cargoCountry"
              autoComplete="country-name"
              placeholder="Например, Казахстан"
              value={country}
              disabled={busy}
              aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
              onChange={(event) => setCountry(event.target.value)}
            />
            {error && (
              <p id={errorId} className="order-delivery-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <footer className="order-delivery-footer">
            <button type="button" className="order-delivery-cancel" disabled={busy} onClick={close}>
              Отмена
            </button>
            <button
              type="submit"
              className="order-delivery-save"
              disabled={busy || !country.trim()}
              aria-busy={busy || undefined}
            >
              {busy && <LoaderCircle size={17} aria-hidden="true" />}
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </footer>
        </form>
      </div>
    </ModalSurface>
  );
}

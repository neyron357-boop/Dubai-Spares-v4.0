import { ArrowLeft, CircleAlert, LoaderCircle, Search, X, type LucideIcon } from 'lucide-react';
import React, { forwardRef, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    loading?: boolean;
    icon?: LucideIcon;
  }
>(function Button(
  {
    variant = 'primary',
    loading,
    icon: Icon,
    children,
    className = '',
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ui-button ${{ primary: 'ui-button-primary', secondary: 'ui-button-secondary', ghost: 'ui-button-ghost', danger: 'ui-button-danger' }[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={18} aria-hidden="true" />
      )}
      {children}
    </button>
  );
});
export const IconButton = ({
  label,
  icon: Icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) => (
  <button
    type="button"
    {...props}
    aria-label={label}
    title={label}
    className={`ui-icon-button ${props.className || ''}`}
  >
    <Icon size={20} aria-hidden="true" />
  </button>
);
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  back,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  back?: () => void;
}) {
  return (
    <header className="ui-page-header">
      {back && <IconButton label="Назад" icon={ArrowLeft} onClick={back} />}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="ui-description">{description}</p>}
      </div>
      {actions && <div className="ui-header-actions">{actions}</div>}
    </header>
  );
}
export function Panel({
  title,
  description,
  icon: Icon,
  children,
  className = '',
}: React.PropsWithChildren<{
  title?: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
}>) {
  return (
    <section className={`ui-panel ${className}`}>
      {title && (
        <div className="ui-panel-heading">
          {Icon && (
            <span className="ui-section-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          <div>
            <h2>{title}</h2>
            {description && <p className="ui-description">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: React.PropsWithChildren<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}>) {
  const id = useId(),
    labelId = `${id}-label`,
    hintId = `${id}-hint`;
  const control = React.isValidElement(children)
    ? React.cloneElement(
        children as React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>,
        {
          id,
          'aria-labelledby': labelId,
          'aria-describedby': hint || error ? hintId : undefined,
          'aria-invalid': error ? true : undefined,
          'aria-required': required || undefined,
        },
      )
    : children;
  return (
    <div className={`ui-field ${error ? 'has-error' : ''} ${className}`}>
      <label id={labelId} htmlFor={id}>
        {label}
        {required && (
          <span className="ui-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {control}
      {(error || hint) && (
        <small
          id={hintId}
          className={error ? 'ui-field-error' : ''}
          role={error ? 'alert' : undefined}
        >
          {error && <CircleAlert size={14} aria-hidden="true" />}
          {error || hint}
        </small>
      )}
    </div>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`ui-search ${className}`} role="search">
      <Search size={18} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder || label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить поиск"
          title="Очистить поиск"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

let openModalCount = 0;
let previousBodyOverflow = '';
/** Native top layer keeps nested dialogs above their parent and makes the background inert. */
export function ModalSurface({
  label,
  onClose,
  children,
  className = '',
  initialFocus,
}: React.PropsWithChildren<{
  label: string;
  onClose: () => void;
  className?: string;
  initialFocus?: React.RefObject<HTMLElement>;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (openModalCount++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialog?.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog?.close();
      if (--openModalCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return createPortal(
    <dialog
      ref={ref}
      className="ui-modal-root"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length && !element.closest('[inert]'));
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <div
        className={`ui-modal-layer ${className}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) close.current();
        }}
      >
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-icon">
        <Icon size={30} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  footer,
}: React.PropsWithChildren<{ title: string; onClose: () => void; footer?: React.ReactNode }>) {
  return (
    <ModalSurface label={title} onClose={onClose} className="ui-dialog-layer">
      <div className="ui-dialog-card">
        <header>
          <h2>{title}</h2>
          <IconButton label="Закрыть" icon={X} onClick={onClose} />
        </header>
        <div className="ui-dialog-content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </ModalSurface>
  );
}
export const LoadingState = () => (
  <div role="status" className="ui-loading">
    <LoaderCircle size={24} className="animate-spin" />
    <span>Открываем экран…</span>
  </div>
);

import { ArrowLeft, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import React, { forwardRef, useEffect, useId, useRef } from 'react';

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
  children,
  className = '',
}: React.PropsWithChildren<{ label: string; hint?: string; className?: string }>) {
  const id = useId(),
    labelId = `${id}-label`,
    hintId = `${id}-hint`;
  const control = React.isValidElement(children)
    ? React.cloneElement(
        children as React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>,
        { id, 'aria-labelledby': labelId, 'aria-describedby': hint ? hintId : undefined },
      )
    : children;
  return (
    <div className={`ui-field ${className}`}>
      <label id={labelId} htmlFor={id}>
        {label}
      </label>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
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
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current,
      previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div className="ui-dialog-card">
        <header>
          <h2 id={id}>{title}</h2>
          <IconButton label="Закрыть" icon={X} onClick={onClose} />
        </header>
        <div className="ui-dialog-content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </dialog>
  );
}
export const LoadingState = () => (
  <div role="status" className="ui-loading">
    <LoaderCircle size={24} className="animate-spin" />
    <span>Открываем экран…</span>
  </div>
);

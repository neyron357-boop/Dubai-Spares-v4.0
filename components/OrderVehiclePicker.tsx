import { Check, ChevronDown, CircleAlert, Search, X } from 'lucide-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconButton, ModalSurface } from './ui';

type Option = { label: string; value: string };

/** A searchable sheet keeps vehicle choices clear of the form and mobile navigation. */
export default function OrderVehiclePicker({
  label,
  value,
  placeholder,
  options,
  onChange,
  required,
  error,
  allowCustom,
  grid,
  featuredCount = 0,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Option[];
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  allowCustom?: boolean;
  grid?: boolean;
  featuredCount?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [viewport, setViewport] = useState({ height: window.innerHeight, keyboardOffset: 0 });
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const choices = useMemo(() => {
    const filtered = options.filter((option) =>
      option.label.toLocaleLowerCase().includes(normalized),
    );
    if (
      allowCustom &&
      normalized &&
      !options.some((option) => option.value.toLocaleLowerCase() === normalized)
    )
      return [...filtered, { value: query.trim(), label: `Использовать «${query.trim()}»` }];
    return filtered;
  }, [options, normalized, allowCustom, query]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const visible = window.visualViewport;
      const height = visible?.height ?? window.innerHeight;
      setViewport({
        height,
        keyboardOffset: Math.max(0, window.innerHeight - height - (visible?.offsetTop ?? 0)),
      });
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (keyboardNavigation)
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, keyboardNavigation]);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    const step = grid ? 3 : 1;
    const change: Record<string, number> = {
      ArrowDown: step,
      ArrowUp: -step,
      ...(grid ? { ArrowRight: 1, ArrowLeft: -1 } : {}),
    };
    if (event.key in change || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setKeyboardNavigation(true);
      setActive((previous) =>
        Math.max(
          0,
          Math.min(
            choices.length - 1,
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : previous + change[event.key],
          ),
        ),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (choices[active]) select(choices[active].value);
    }
  };

  return (
    <div className={`vehicle-field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-value${error ? ` ${id}-error` : ''}`}
        title={value || placeholder}
        className={`vehicle-field-trigger ${value ? 'has-value' : ''}`}
        onClick={() => {
          trigger.current?.focus({ preventScroll: true });
          setQuery('');
          setActive(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
          setKeyboardNavigation(false);
          setOpen(true);
        }}
      >
        <span id={`${id}-value`}>{value || placeholder}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {error && (
        <p id={`${id}-error`} role="alert" className="vehicle-field-error">
          <CircleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
      {open && (
        <ModalSurface
          label={`Выберите: ${label}`}
          onClose={() => setOpen(false)}
          className="vehicle-picker-layer"
          initialFocus={title}
        >
          <div
            className="vehicle-picker-card"
            style={
              {
                '--picker-viewport': `${viewport.height}px`,
                '--picker-keyboard-offset': `${viewport.keyboardOffset}px`,
              } as React.CSSProperties
            }
          >
            <div className="vehicle-picker-handle" aria-hidden="true" />
            <header>
              <div>
                <h2 ref={title} tabIndex={-1}>
                  {label === 'Год' ? 'Год выпуска' : label}
                </h2>
                <p>
                  {allowCustom
                    ? 'Выберите из списка или укажите свой вариант.'
                    : label === 'Год'
                      ? 'Выберите год выпуска автомобиля.'
                      : 'Найдите нужный вариант в списке.'}
                </p>
              </div>
              <IconButton label="Закрыть выбор" icon={X} onClick={() => setOpen(false)} />
            </header>
            <div className="vehicle-picker-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={search}
                type="search"
                inputMode={grid ? 'numeric' : 'search'}
                autoComplete="off"
                maxLength={grid ? 4 : 80}
                spellCheck={false}
                role="combobox"
                aria-label={`Поиск: ${label}`}
                aria-expanded="true"
                aria-controls={`${id}-options`}
                aria-autocomplete="list"
                aria-activedescendant={choices[active] ? `${id}-option-${active}` : undefined}
                placeholder={label === 'Год' ? 'Например, 2020' : `Поиск: ${label.toLowerCase()}`}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                  setKeyboardNavigation(false);
                }}
                onKeyDown={handleKeyDown}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => {
                    setQuery('');
                    setActive(0);
                    search.current?.focus();
                  }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            <div
              ref={list}
              id={`${id}-options`}
              role="listbox"
              aria-label={label}
              className={`vehicle-picker-options ${grid ? 'is-grid' : ''}`}
            >
              {choices.map((option, index) => (
                <React.Fragment key={option.value}>
                  {!normalized && featuredCount > 0 && (index === 0 || index === featuredCount) && (
                    <div className="vehicle-picker-group" role="presentation">
                      {index === 0 ? 'Популярные марки' : 'Все остальные марки'}
                    </div>
                  )}
                  <button
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={value === option.value}
                    tabIndex={-1}
                    data-active={keyboardNavigation && active === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(option.value)}
                  >
                    <span>{option.label}</span>
                    {value === option.value && <Check size={18} aria-hidden="true" />}
                  </button>
                </React.Fragment>
              ))}
              {choices.length === 0 && (
                <div className="vehicle-picker-empty" role="status">
                  <Search size={24} aria-hidden="true" />
                  <strong>Ничего не найдено</strong>
                  <p>Попробуйте другой запрос.</p>
                </div>
              )}
            </div>
            <footer>Выбранный вариант появится в форме.</footer>
          </div>
        </ModalSurface>
      )}
    </div>
  );
}

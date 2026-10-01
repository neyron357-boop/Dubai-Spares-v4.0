import { ChevronDown } from 'lucide-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
type DropdownOption = { label: string; value: string };
const inputClass = 'ui-input';
const SearchableSelect: React.FC<{
  value: string;
  placeholder: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  options: DropdownOption[];
  loading?: boolean;
  required?: boolean;
  noOptionsText?: string;
  allowCustom?: boolean;
  onChange: (value: string) => void;
}> = ({
  value,
  placeholder,
  label = placeholder,
  error,
  disabled,
  options,
  loading,
  required,
  noOptionsText = 'Нет доступных вариантов',
  allowCustom,
  onChange,
}) => {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlighted(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const trimmedQuery = query.trim();
  const exactQueryMatch = filteredOptions.some(
    (option) =>
      option.value.toLowerCase() === trimmedQuery.toLowerCase() ||
      option.label.toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const showCustomOption = Boolean(allowCustom && trimmedQuery && !exactQueryMatch);
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(prev - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (allowCustom && trimmedQuery) {
        onChange(trimmedQuery);
      } else if (filteredOptions[highlighted]) {
        onChange(filteredOptions[highlighted].value);
      }
      setOpen(false);
      if (!allowCustom) triggerRef.current?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      if (!allowCustom) triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {allowCustom ? (
        <div
          className={`${inputClass} relative flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-slate-100`}
        >
          <input
            aria-label={label}
            ref={inputRef}
            role="combobox"
            aria-controls={`${id}-options`}
            aria-activedescendant={
              open && filteredOptions[highlighted] ? `${id}-option-${highlighted}` : undefined
            }
            aria-autocomplete="list"
            value={open ? query : value}
            disabled={disabled}
            aria-expanded={open}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onFocus={() => {
              setQuery(value);
              setOpen(true);
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              onChange(nextValue);
              setOpen(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setQuery(value);
              setOpen((prev) => !prev);
            }}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400"
            aria-label="Открыть список"
          >
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          ref={triggerRef}
          aria-label={label}
          aria-controls={`${id}-options`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className={`${inputClass} relative flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-100`}
        >
          <span className={value ? 'text-slate-900' : 'text-slate-400'}>
            {value || placeholder}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {open && (
        <div className="ui-select-popup absolute z-[60] mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {!allowCustom && (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label={`Поиск: ${label}`}
              role="combobox"
              aria-controls={`${id}-options`}
              aria-expanded={open}
              aria-autocomplete="list"
              aria-activedescendant={
                filteredOptions[highlighted] ? `${id}-option-${highlighted}` : undefined
              }
              placeholder="Поиск..."
              className="mb-2 h-11 w-full rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-300"
            />
          )}
          {loading ? (
            <div className="space-y-2 p-1">
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : (
            <div
              id={`${id}-options`}
              role="listbox"
              aria-label={`Варианты: ${placeholder}`}
              className="max-h-52 overflow-y-auto"
            >
              {showCustomOption && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onChange(trimmedQuery);
                  }}
                  className="mb-1 flex w-full items-center rounded-lg bg-blue-50 min-h-11 px-3 py-2.5 text-left text-sm font-bold text-blue-700"
                >
                  Указать вручную: "{trimmedQuery}"
                </button>
              )}
              {filteredOptions.map((option, index) => (
                <button
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={value === option.value}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  key={option.value}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    onChange(option.value);
                    if (!allowCustom) triggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center rounded-lg min-h-11 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 ${highlighted === index ? 'bg-slate-100' : ''}`}
                >
                  {option.label}
                </button>
              ))}
              {filteredOptions.length === 0 && !showCustomOption && (
                <p className="px-2 py-2 text-xs text-slate-500">{noOptionsText}</p>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
};

export default SearchableSelect;

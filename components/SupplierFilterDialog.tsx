import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  Clock3,
  MessageCircle,
  Pin,
  RotateCcw,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { ModalSurface } from './ui';
import '../styles/supplier-filters.css';

export type SupplierFilterValue = {
  brand: string;
  model: string;
  year: string;
  category: string;
  zone: string;
  fast: boolean;
  unvisited: boolean;
};

export type SupplierFilterOptions = {
  brands: string[];
  models: string[];
  modelsByBrand?: Record<string, string[]>;
  years: string[];
  categories: string[];
  zones: string[];
};

export type SupplierFilterDialogProps = {
  value: SupplierFilterValue;
  options: SupplierFilterOptions;
  onApply: (value: SupplierFilterValue) => void;
  onClose: () => void;
};

export type SupplierSort = 'smart' | 'name' | 'recent' | 'fast';

export type SupplierSortDialogProps = {
  value: SupplierSort;
  onChange: (value: SupplierSort) => void;
  onClose: () => void;
};

function SupplierDialogFrame({
  title,
  description,
  icon: Icon,
  children,
  footer,
  headerAction,
  onClose,
  sort = false,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
  footer: ReactNode;
  headerAction?: ReactNode;
  onClose: () => void;
  sort?: boolean;
}) {
  const viewport = useVisibleViewport();
  return (
    <ModalSurface label={title} onClose={onClose} className="supplier-filters-layer">
      <div
        className="supplier-filters-frame"
        style={{ top: viewport.offsetTop, height: viewport.height }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section className={`supplier-filters-panel ${sort ? 'supplier-sort-panel' : ''}`}>
          <header className="supplier-filters-heading">
            <span className="supplier-filters-handle" aria-hidden="true" />
            <div className="supplier-filters-heading-row">
              <span className="supplier-filters-heading-icon" aria-hidden="true">
                <Icon size={21} strokeWidth={1.7} />
              </span>
              <div>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
              </div>
            </div>
            {headerAction}
          </header>
          {children}
          <footer className={`supplier-filters-footer ${sort ? 'is-sort' : ''}`}>{footer}</footer>
        </section>
      </div>
    </ModalSurface>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const choices = [...new Set([...options, ...(value !== 'all' ? [value] : [])])].filter(
    (option) => option.trim() && option !== 'all',
  );
  return (
    <div className="supplier-filter-field">
      <label htmlFor={id}>{label}</label>
      <div className="supplier-filter-select">
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="all">{allLabel}</option>
          {choices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={17} strokeWidth={1.7} aria-hidden="true" />
      </div>
    </div>
  );
}

function FilterCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="supplier-filter-checkbox">
      <input
        type="checkbox"
        checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span id={`${id}-label`} className="supplier-filter-checkbox-title">
          {label}
        </span>
        <span id={`${id}-hint`} className="supplier-filter-checkbox-hint">
          {description}
        </span>
      </span>
    </label>
  );
}

export default function SupplierFilterDialog({
  value,
  options,
  onApply,
  onClose,
}: SupplierFilterDialogProps) {
  const [draft, setDraft] = useState<SupplierFilterValue>(() => ({ ...value }));
  const formId = useId();
  const models =
    draft.brand === 'all' || !options.modelsByBrand
      ? options.models
      : options.modelsByBrand[draft.brand] || [];
  const patch = (next: Partial<SupplierFilterValue>) =>
    setDraft((previous) => ({ ...previous, ...next }));
  return (
    <SupplierDialogFrame
      title="Фильтры поставщиков"
      description="Уточните автомобиль, детали и район."
      icon={SlidersHorizontal}
      onClose={onClose}
      headerAction={
        <button
          type="button"
          className="supplier-filters-reset"
          onClick={() =>
            setDraft({
              brand: 'all',
              model: 'all',
              year: 'all',
              category: 'all',
              zone: 'all',
              fast: false,
              unvisited: false,
            })
          }
        >
          <RotateCcw size={15} strokeWidth={1.7} aria-hidden="true" />
          Сбросить фильтры
        </button>
      }
      footer={
        <>
          <button type="button" className="supplier-filters-cancel" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" form={formId} className="supplier-filters-apply">
            Показать поставщиков
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="supplier-filters-scroll"
        onSubmit={(event) => {
          event.preventDefault();
          onApply({ ...draft });
        }}
      >
        <div className="supplier-filters-fields">
          <FilterSelect
            label="Марка"
            value={draft.brand}
            allLabel="Все марки"
            options={options.brands}
            onChange={(brand) => patch({ brand, model: 'all' })}
          />
          <FilterSelect
            label="Модель"
            value={draft.model}
            allLabel="Все модели"
            options={models}
            onChange={(model) => patch({ model })}
          />
          <FilterSelect
            label="Год"
            value={draft.year}
            allLabel="Любой год"
            options={options.years}
            onChange={(year) => patch({ year })}
          />
          <FilterSelect
            label="Категория деталей"
            value={draft.category}
            allLabel="Все категории"
            options={options.categories}
            onChange={(category) => patch({ category })}
          />
          <FilterSelect
            label="Район"
            value={draft.zone}
            allLabel="Все районы"
            options={options.zones}
            onChange={(zone) => patch({ zone })}
          />
        </div>
        <fieldset className="supplier-filters-toggles">
          <legend className="sr-only">Дополнительные условия</legend>
          <FilterCheckbox
            label="Быстрый ответ в WhatsApp"
            description="Поставщики, которым вы добавили отметку быстрого ответа."
            checked={draft.fast}
            onChange={(fast) => patch({ fast })}
          />
          <FilterCheckbox
            label="Без визита"
            description="Есть переписка, визит ещё не отмечен."
            checked={draft.unvisited}
            onChange={(unvisited) => patch({ unvisited })}
          />
        </fieldset>
      </form>
    </SupplierDialogFrame>
  );
}

const sortOptions: Array<{
  value: SupplierSort;
  label: string;
  icon: LucideIcon;
}> = [
  {
    value: 'smart',
    label: 'Сначала закреплённые',
    icon: Pin,
  },
  {
    value: 'name',
    label: 'По названию',
    icon: ArrowDownAZ,
  },
  {
    value: 'recent',
    label: 'Недавно обновлённые',
    icon: Clock3,
  },
  {
    value: 'fast',
    label: 'Быстрый ответ',
    icon: MessageCircle,
  },
];

export function SupplierSortDialog({ value, onChange, onClose }: SupplierSortDialogProps) {
  return (
    <SupplierDialogFrame
      title="Сортировка поставщиков"
      description=""
      icon={ArrowDownAZ}
      onClose={onClose}
      sort
      footer={
        <button type="button" className="supplier-filters-cancel" onClick={onClose}>
          Отмена
        </button>
      }
    >
      <div className="supplier-filters-scroll supplier-sort-options">
        {sortOptions.map(({ value: option, label, icon: Icon }) => (
          <button
            key={option}
            type="button"
            aria-label={label}
            aria-pressed={value === option}
            className={`supplier-sort-option ${value === option ? 'is-selected' : ''}`}
            onClick={() => onChange(option)}
          >
            <span className="supplier-sort-option-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <span className="supplier-sort-option-copy">
              <strong>{label}</strong>
            </span>
            {value === option && (
              <Check size={19} className="supplier-sort-option-check" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </SupplierDialogFrame>
  );
}

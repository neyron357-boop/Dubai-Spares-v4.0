import React, { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type VehicleOption = { id: string; value: string; meta: string; vin?: string; orderRef?: string };

export default function VehiclePicker({ value, options, onChange, onSelect }: {
  value: string;
  options: VehicleOption[];
  onChange: (value: string) => void;
  onSelect: (option: VehicleOption) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const select = (option: VehicleOption) => { onSelect(option); setOpen(false); setActive(-1); };
  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <input ref={input} value={value} role="combobox" aria-label="Данные автомобиля"
        aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && options[active] ? `${id}-${active}` : undefined}
        placeholder="Данные автомобиля" autoComplete="off"
        className="h-[52px] w-full rounded-2xl border border-[#E7EAF0] px-3 pr-12 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((current) => options.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1);
          }
          if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); select(options[active]); }
        }} />
      <button type="button" aria-label="Показать список автомобилей" aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { input.current?.focus(); setOpen(!open); }}
        className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-[#667085]">
        <ChevronDown size={17} className={open ? 'rotate-180' : ''} />
      </button>
      {open && <div id={`${id}-options`} role="listbox" aria-label="Активные заказы"
        className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-60 overflow-y-auto rounded-2xl border border-[#E7EAF0] bg-white p-1 shadow-xl">
        {options.map((option, index) => <button id={`${id}-${index}`} key={option.id} type="button"
          role="option" aria-selected={active === index} tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(option)}
          className={`w-full rounded-xl px-3 py-2.5 text-left hover:bg-blue-50 ${active === index ? 'bg-blue-50' : ''}`}>
          <span className="block truncate text-sm font-bold text-[#0F1728]">{option.value}</span>
          <span className="mt-0.5 block truncate text-[11px] text-[#667085]">{option.meta}</span>
        </button>)}
        {!options.length && <p className="px-3 py-3 text-sm text-[#667085]">Нет подходящих активных заказов</p>}
      </div>}
    </div>
  );
}

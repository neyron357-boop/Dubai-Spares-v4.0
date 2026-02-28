import React, { useCallback, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Gem,
  Loader2,
  LocateFixed,
  MapPin,
  Phone,
  Sparkles,
  Star,
  Store,
  Upload,
  Wrench,
  X
} from 'lucide-react';
import { Supplier, SupplierType } from '../types';
import { optimizeImageForUpload } from '../storage/photos';

// ─── types ───────────────────────────────────────────────────────────────────

export interface WizardFormData {
  name: string;
  phone: string;
  shopTypes: SupplierType[];
  location: string;
  zone: string;
  coords?: { lat: number; lng: number };
  gpsAccuracy?: number;
  hasDelivery: boolean;
  deliveryDescription: string;
  mainBrands: string[];
  primaryBrand: string;
  supplierModelsInput: string;
  supplierYearsInput: string;
  supplierPhotos: string[];
  mainPartCategories: string[];
  workingHours: string;
  website: string;
  trustLevel: number;
  whatsappFast: boolean;
  comment: string;
  isDraft: boolean;
}

interface AddSupplierWizardProps {
  existingSupplierId?: string | null;
  initialValues?: Partial<WizardFormData>;
  onSave: (data: WizardFormData) => Promise<void>;
  onClose: () => void;
  suppliers: Supplier[];
  brandOptions: string[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const normalizePhone = (raw: string) => {
  const trimmed = raw.replace(/[\s\-()]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('971')) return `+${digits}`;
  if (digits.startsWith('0')) return `+971${digits.slice(1)}`;
  return `+${digits}`;
};

const isValidE164 = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

const toTitle = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const ZONE_GEOFENCES = [
  { name: 'Sajaa', bounds: { minLat: 25.29, maxLat: 25.37, minLng: 55.48, maxLng: 55.58 } },
  { name: 'Ras Al Khor', bounds: { minLat: 25.16, maxLat: 25.21, minLng: 55.34, maxLng: 55.4 } },
  { name: 'Al Qusais', bounds: { minLat: 25.24, maxLat: 25.29, minLng: 55.37, maxLng: 55.44 } },
  { name: 'Sharjah Industrial', bounds: { minLat: 25.26, maxLat: 25.34, minLng: 55.39, maxLng: 55.47 } }
];

const inferZoneFromCoords = (coords?: { lat: number; lng: number }) => {
  if (!coords) return '';
  const matched = ZONE_GEOFENCES.find(
    (zone) =>
      coords.lat >= zone.bounds.minLat &&
      coords.lat <= zone.bounds.maxLat &&
      coords.lng >= zone.bounds.minLng &&
      coords.lng <= zone.bounds.maxLng
  );
  return matched?.name || '';
};

const FIELD_TYPES: Array<{ value: SupplierType; label: string; icon: React.ReactNode }> = [
  { value: 'new_parts', label: 'New Parts', icon: <Gem size={14} /> },
  { value: 'scrapyard', label: 'Scrapyard', icon: <Wrench size={14} /> },
  { value: 'engine_specialist', label: 'Engine Specialist', icon: <Wrench size={14} /> },
  { value: 'body_parts', label: 'Body Parts', icon: <Wrench size={14} /> },
  { value: 'electrical', label: 'Electrical', icon: <Sparkles size={14} /> },
  { value: 'mixed', label: 'Mixed', icon: <Store size={14} /> },
  { value: 'dealer', label: 'Dealer', icon: <Store size={14} /> },
  { value: 'warehouse', label: 'Warehouse', icon: <Store size={14} /> }
];

const PART_CATEGORIES = [
  'ДВС / Двигатели',
  'АКПП / МКПП',
  'Механические детали',
  'Кузовные детали',
  'Электрика / Электроника',
  'Подвеска / Ходовая',
  'Салон / Интерьер',
  'Оптика / Освещение'
];

const STEP_LABELS = ['Basic Info', 'Location', 'Brands & Models', 'Categories', 'Review'];

const DEFAULT_DATA: WizardFormData = {
  name: '',
  phone: '',
  shopTypes: [],
  location: '',
  zone: '',
  coords: undefined,
  gpsAccuracy: undefined,
  hasDelivery: false,
  deliveryDescription: '',
  mainBrands: [],
  primaryBrand: '',
  supplierModelsInput: '',
  supplierYearsInput: '',
  supplierPhotos: [],
  mainPartCategories: [],
  workingHours: '',
  website: '',
  trustLevel: 3,
  whatsappFast: false,
  comment: '',
  isDraft: false
};

// ─── component ───────────────────────────────────────────────────────────────

const AddSupplierWizard: React.FC<AddSupplierWizardProps> = ({
  existingSupplierId,
  initialValues,
  onSave,
  onClose,
  suppliers,
  brandOptions
}) => {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardFormData>({ ...DEFAULT_DATA, ...initialValues });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [phoneError, setPhoneError] = useState('');

  const set = useCallback(<K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── validation ────────────────────────────────────────────────────────────

  const normalizedPhone = normalizePhone(data.phone);
  const step1Valid =
    !!data.name.trim() && data.shopTypes.length > 0 && isValidE164(normalizedPhone);
  const step2Valid = !!data.location.trim();
  const step3Valid = data.mainBrands.length > 0;
  const step4Valid = data.mainPartCategories.length > 0;

  const stepValid = [step1Valid, step2Valid, step3Valid, step4Valid, true];

  // ── photo upload ─────────────────────────────────────────────────────────

  const handlePhotoFile = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const url = await optimizeImageForUpload(file, file.name);
      if (url) set('supplierPhotos', [...data.supplierPhotos, url]);
    } catch {
      // ignore
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── GPS ──────────────────────────────────────────────────────────────────

  const handleGps = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setData((prev) => ({
          ...prev,
          coords,
          gpsAccuracy: pos.coords.accuracy,
          zone: prev.zone || inferZoneFromCoords(coords)
        }));
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── import from similar ───────────────────────────────────────────────────

  const importFromSimilar = () => {
    const nameLower = data.name.trim().toLowerCase();
    if (!nameLower) return;
    const similar = suppliers.find(
      (s) => s.id !== existingSupplierId && s.name.trim().toLowerCase().includes(nameLower)
    );
    if (!similar) return;
    const brands = similar.mainBrands || similar.brands || [];
    const models = (similar.models || []).join(', ');
    const years = (similar.years || []).join(', ');
    setData((prev) => ({
      ...prev,
      mainBrands: Array.from(new Set([...prev.mainBrands, ...brands])),
      supplierModelsInput: prev.supplierModelsInput || models,
      supplierYearsInput: prev.supplierYearsInput || years
    }));
  };

  // ── save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(data);
      setSaved(true);
    } catch {
      // let parent handle errors
    } finally {
      setSaving(false);
    }
  };

  // ── navigation ────────────────────────────────────────────────────────────

  const goTo = (target: number) => setStep(Math.max(0, Math.min(4, target)));

  // ─── render helpers ───────────────────────────────────────────────────────

  const renderProgressBar = () => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Step {step + 1} / {STEP_LABELS.length}
        </span>
        <span className="text-[10px] font-bold text-blue-600">{STEP_LABELS[step]}</span>
      </div>
      <div className="flex gap-1">
        {STEP_LABELS.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            className={`h-1.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-blue-600' : 'bg-slate-200'}`}
          />
        ))}
      </div>
    </div>
  );

  const renderNav = (canNext = true) => (
    <div className="sticky bottom-0 -mx-4 sm:-mx-5 mt-4 px-4 sm:px-5 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] bg-white/95 backdrop-blur border-t border-gray-100 flex gap-3">
      {step > 0 ? (
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold text-xs inline-flex items-center justify-center gap-1"
        >
          <ChevronLeft size={14} /> Back
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold text-xs"
        >
          Cancel
        </button>
      )}
      {step < 4 ? (
        <button
          type="button"
          disabled={!canNext}
          onClick={() => goTo(step + 1)}
          className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold text-xs disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          Next <ChevronRight size={14} />
        </button>
      ) : (
        <button
          type="button"
          disabled={saving || saved}
          onClick={() => void handleSave()}
          className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-bold text-xs disabled:opacity-40 inline-flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : saved ? (
            <>
              <Check size={14} /> Saved!
            </>
          ) : (
            <>
              <Check size={14} /> {existingSupplierId ? 'Update' : 'Save Supplier'}
            </>
          )}
        </button>
      )}
    </div>
  );

  // ─── step 1: basic info ───────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Название *
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
            placeholder="Название поставщика"
            value={data.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <button
            type="button"
            onClick={() => set('name', toTitle(data.name))}
            className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold"
          >
            Aa
          </button>
        </div>
      </div>

      {/* Business types */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Тип бизнеса *
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {FIELD_TYPES.map(({ value, label, icon }) => {
            const active = data.shopTypes.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  set(
                    'shopTypes',
                    active
                      ? data.shopTypes.filter((t) => t !== value)
                      : [...data.shopTypes, value]
                  )
                }
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold border transition-all ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {icon}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Телефон *
        </label>
        <div className="relative">
          <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`w-full border rounded-xl pl-8 pr-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400 ${
              phoneError ? 'border-red-400' : 'border-slate-200'
            }`}
            placeholder="+971 50 000 0000"
            value={data.phone}
            onChange={(e) => {
              set('phone', e.target.value);
              const norm = normalizePhone(e.target.value);
              setPhoneError(
                e.target.value && !isValidE164(norm) ? 'Введите номер в формате +971...' : ''
              );
            }}
          />
        </div>
        {phoneError && <p className="text-red-500 text-[10px] font-semibold ml-1 mt-1">{phoneError}</p>}
      </div>

      {/* Photo */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Фото (опционально)
        </label>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handlePhotoFile(file);
          }}
        />
        {data.supplierPhotos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data.supplierPhotos.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => set('supplierPhotos', data.supplierPhotos.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400"
            >
              <Upload size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="w-full rounded-xl border-2 border-dashed border-slate-300 py-6 flex flex-col items-center gap-2 text-slate-400 font-semibold text-xs"
          >
            {uploadingPhoto ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <Upload size={20} />
                Загрузить фото
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );

  // ─── step 2: location ─────────────────────────────────────────────────────

  const renderStep2 = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Адрес / ссылка на карты *
        </label>
        <div className="relative">
          <MapPin size={14} className="absolute left-3 top-3 text-slate-400" />
          <textarea
            className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400 resize-none"
            rows={3}
            placeholder="Адрес или ссылка на Google Maps"
            value={data.location}
            onChange={(e) => set('location', e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleGps}
        disabled={gpsLoading}
        className="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700 inline-flex items-center justify-center gap-2"
      >
        {gpsLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <LocateFixed size={16} />
        )}
        Определить по GPS
      </button>

      {data.coords && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700">
          <Check size={12} className="inline mr-1" />
          GPS: {data.coords.lat.toFixed(5)}, {data.coords.lng.toFixed(5)}
          {data.gpsAccuracy && ` (±${Math.round(data.gpsAccuracy)}m)`}
        </div>
      )}

      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Зона (геофенс)
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="Sajaa, Ras Al Khor, Al Qusais…"
          value={data.zone}
          onChange={(e) => set('zone', e.target.value)}
          list="zone-list"
        />
        <datalist id="zone-list">
          {ZONE_GEOFENCES.map((z) => (
            <option key={z.name} value={z.name} />
          ))}
        </datalist>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={data.hasDelivery}
          onChange={(e) => set('hasDelivery', e.target.checked)}
          className="accent-blue-600 w-4 h-4"
        />
        <span className="text-sm font-bold text-slate-700">Есть доставка</span>
      </label>

      {data.hasDelivery && (
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
            Описание доставки
          </label>
          <input
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
            placeholder="Бесплатная доставка от 200 AED…"
            value={data.deliveryDescription}
            onChange={(e) => set('deliveryDescription', e.target.value)}
          />
        </div>
      )}
    </div>
  );

  // ─── step 3: brands & models ──────────────────────────────────────────────

  const filteredBrands = brandOptions
    .filter((b) => b.toLowerCase().includes(brandSearch.toLowerCase()))
    .slice(0, 12);

  const addBrand = (brand: string) => {
    const b = brand.trim();
    if (!b || data.mainBrands.includes(b)) return;
    set('mainBrands', [...data.mainBrands, b]);
  };

  const removeBrand = (brand: string) => {
    const next = data.mainBrands.filter((b) => b !== brand);
    set('mainBrands', next);
    if (data.primaryBrand === brand) set('primaryBrand', next[0] || '');
  };

  const modelTags = data.supplierModelsInput
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const yearTags = data.supplierYearsInput
    .split(',')
    .map((y) => y.trim())
    .filter(Boolean);

  const renderStep3 = () => (
    <div className="space-y-4">
      {/* Brand search */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Марки * (хотя бы одна)
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="Поиск марки…"
          value={brandSearch}
          onChange={(e) => setBrandSearch(e.target.value)}
        />
        {brandSearch && (
          <div className="mt-1 flex flex-wrap gap-1">
            {filteredBrands.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => { addBrand(b); setBrandSearch(''); }}
                className="rounded-full bg-blue-50 border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700"
              >
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom brand */}
      <div className="flex gap-2">
        <input
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="Своя марка…"
          value={customBrand}
          onChange={(e) => setCustomBrand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addBrand(customBrand); setCustomBrand(''); }
          }}
        />
        <button
          type="button"
          onClick={() => { addBrand(customBrand); setCustomBrand(''); }}
          className="px-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
        >
          + Add
        </button>
      </div>

      {/* Import from similar */}
      <button
        type="button"
        onClick={importFromSimilar}
        className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 inline-flex items-center justify-center gap-2"
      >
        <ArrowRight size={13} /> Импорт с похожего поставщика
      </button>

      {/* Selected brands */}
      {data.mainBrands.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Выбрано</p>
          <div className="flex flex-wrap gap-1">
            {data.mainBrands.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => removeBrand(b)}
                className={`rounded-full px-2.5 py-1 text-xs font-bold border inline-flex items-center gap-1 transition-all ${
                  data.primaryBrand === b
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
                onContextMenu={(e) => { e.preventDefault(); set('primaryBrand', b); }}
                title="Зажмите для основной марки"
              >
                {b}
                <X size={10} />
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-400 mt-1 ml-1">Долгое нажатие → основная марка</p>
        </div>
      )}

      {/* Primary brand select */}
      {data.mainBrands.length > 1 && (
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
            Основная марка
          </label>
          <select
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold"
            value={data.primaryBrand}
            onChange={(e) => set('primaryBrand', e.target.value)}
          >
            <option value="">— выберите —</option>
            {data.mainBrands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      )}

      {/* Models */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Модели (через запятую)
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="Camry, Corolla, RAV4"
          value={data.supplierModelsInput}
          onChange={(e) => set('supplierModelsInput', e.target.value)}
        />
        {modelTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {modelTags.map((m) => (
              <span key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{m}</span>
            ))}
          </div>
        )}
      </div>

      {/* Years */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Годы (через запятую)
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="2018, 2019, 2020"
          value={data.supplierYearsInput}
          onChange={(e) => set('supplierYearsInput', e.target.value)}
        />
        {yearTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {yearTags.map((y) => (
              <span key={y} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{y}</span>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {(data.mainBrands.length > 0 || modelTags.length > 0 || yearTags.length > 0) && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
          {[data.primaryBrand || data.mainBrands[0], modelTags[0], yearTags[0]].filter(Boolean).join(' → ')}
        </div>
      )}
    </div>
  );

  // ─── step 4: categories & settings ───────────────────────────────────────

  const renderStep4 = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Категории деталей * (хотя бы одна)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PART_CATEGORIES.map((cat) => {
            const active = data.mainPartCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  set(
                    'mainPartCategories',
                    active
                      ? data.mainPartCategories.filter((c) => c !== cat)
                      : [...data.mainPartCategories, cat]
                  )
                }
                className={`rounded-full px-2.5 py-1 text-xs font-bold border transition-all ${
                  active
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Часы работы
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="Пн–Сб 9:00–19:00"
          value={data.workingHours}
          onChange={(e) => set('workingHours', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Сайт
        </label>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400"
          placeholder="https://…"
          value={data.website}
          onChange={(e) => set('website', e.target.value)}
        />
      </div>

      {/* Trust level */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Уровень доверия (1 = новый, 5 = проверенный)
        </label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set('trustLevel', n)}
              className={`text-2xl leading-none transition-all ${n <= data.trustLevel ? 'text-amber-400' : 'text-slate-200'}`}
            >
              <Star size={24} fill={n <= data.trustLevel ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-2">
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data.whatsappFast}
            onChange={(e) => set('whatsappFast', e.target.checked)}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm font-bold text-slate-700">Быстро отвечает в WhatsApp</span>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data.hasDelivery}
            onChange={(e) => set('hasDelivery', e.target.checked)}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm font-bold text-slate-700">Есть доставка</span>
        </label>
      </div>

      {/* Comment */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">
          Комментарий
        </label>
        <textarea
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:border-blue-400 resize-none"
          rows={3}
          placeholder="Заметки о поставщике…"
          value={data.comment}
          onChange={(e) => set('comment', e.target.value)}
        />
      </div>
    </div>
  );

  // ─── step 5: review ───────────────────────────────────────────────────────

  const ReviewSection: React.FC<{ title: string; stepIndex: number; children: React.ReactNode }> = ({
    title,
    stepIndex,
    children
  }) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{title}</p>
        <button
          type="button"
          onClick={() => goTo(stepIndex)}
          className="text-[10px] font-bold text-blue-600 underline"
        >
          Edit
        </button>
      </div>
      {children}
    </div>
  );

  const Pill: React.FC<{ label: string; color?: string }> = ({ label, color = 'bg-slate-100 text-slate-700' }) => (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>{label}</span>
  );

  const renderStep5 = () => (
    <div className="space-y-3">
      {saved && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm font-bold text-emerald-700 flex items-center gap-2">
          <Check size={16} /> Поставщик успешно сохранён!
        </div>
      )}

      <ReviewSection title="Basic Info" stepIndex={0}>
        <p className="text-sm font-black">{data.name || '—'}</p>
        <p className="text-xs text-slate-500">{normalizedPhone || data.phone || '—'}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {data.shopTypes.map((t) => (
            <Pill key={t} label={FIELD_TYPES.find((f) => f.value === t)?.label || t} color="bg-blue-50 text-blue-700" />
          ))}
        </div>
        {data.supplierPhotos.length > 0 && (
          <div className="flex gap-1 mt-1">
            {data.supplierPhotos.map((url, i) => (
              <img key={i} src={url} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200" />
            ))}
          </div>
        )}
      </ReviewSection>

      <ReviewSection title="Location" stepIndex={1}>
        <p className="text-xs font-semibold text-slate-700 break-words">{data.location || '—'}</p>
        {data.zone && <p className="text-xs text-slate-500">Zone: {data.zone}</p>}
        {data.coords && (
          <p className="text-xs text-slate-400">GPS: {data.coords.lat.toFixed(5)}, {data.coords.lng.toFixed(5)}</p>
        )}
        {data.hasDelivery && (
          <Pill label={`Доставка${data.deliveryDescription ? ': ' + data.deliveryDescription : ''}`} color="bg-emerald-50 text-emerald-700" />
        )}
      </ReviewSection>

      <ReviewSection title="Brands & Models" stepIndex={2}>
        <div className="flex flex-wrap gap-1">
          {data.mainBrands.map((b) => (
            <Pill key={b} label={b} color={b === data.primaryBrand ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'} />
          ))}
        </div>
        {modelTags.length > 0 && <p className="text-xs text-slate-500 mt-1">Модели: {modelTags.join(', ')}</p>}
        {yearTags.length > 0 && <p className="text-xs text-slate-500">Годы: {yearTags.join(', ')}</p>}
      </ReviewSection>

      <ReviewSection title="Categories & Settings" stepIndex={3}>
        <div className="flex flex-wrap gap-1">
          {data.mainPartCategories.map((c) => (
            <Pill key={c} label={c} color="bg-indigo-50 text-indigo-700" />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-slate-500">
          <span>{'★'.repeat(data.trustLevel)}{'☆'.repeat(5 - data.trustLevel)}</span>
          {data.workingHours && <span>{data.workingHours}</span>}
          {data.whatsappFast && <Pill label="WA Fast" color="bg-emerald-50 text-emerald-700" />}
          {data.hasDelivery && <Pill label={data.deliveryDescription ? `Доставка: ${data.deliveryDescription}` : 'Доставка'} color="bg-emerald-50 text-emerald-700" />}
        </div>
        {data.comment && <p className="text-xs text-slate-500 mt-1 italic">"{data.comment}"</p>}
      </ReviewSection>

      {/* Draft toggle */}
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={data.isDraft}
          onChange={(e) => set('isDraft', e.target.checked)}
          className="accent-blue-600 w-4 h-4"
        />
        <span className="text-sm font-bold text-slate-700">Сохранить как черновик</span>
      </label>
    </div>
  );

  // ─── render ───────────────────────────────────────────────────────────────

  const STEPS = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-3xl p-4 sm:p-5 shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold">
              {existingSupplierId ? 'Редактировать поставщика' : 'Добавить поставщика'}
            </h2>
            <p className="text-xs text-gray-400 font-semibold">Wizard Mode</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {renderProgressBar()}

        {/* Step content */}
        <div className="overflow-hidden">
          {STEPS[step]()}
        </div>

        {renderNav(stepValid[step])}
      </div>
    </div>
  );
};

export default AddSupplierWizard;

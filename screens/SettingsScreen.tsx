import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronRight, Download, FileText, ImageIcon, RefreshCw, Search, Settings, Share2, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../store';
import { offlineDb } from '../storage/offlineDb';
import { backupUpload, clearServerBackups, deletePublicQuoteSnapshot, listPublicQuoteSnapshots } from '../serverApi';
import { cloudBuildGuardMessage, getCloudConfigDiagnostics, isCloudConfigured, SUPABASE_URL } from '../cloudConfig';
import { AppSettings, useAppSettings } from '../appSettings';
import { testSupabaseConnection } from '../utils/testSupabaseConnection';
import { deleteStorageDuplicateMappings, deleteStorageImageByPublicUrl, listAllStorageImages, recompressExistingStorageImage, runStorageImageMaintenance, uploadFileToStorage, uploadImageToStorage } from '../storage/photos';
import { Order } from '../types';
import { clearBrokenImageBlacklist, isBrokenImageUrl, markBrokenImageUrl, normalizeBrokenImageKey, shouldBlacklistByStatus } from '../storage/brokenImageBlacklist';
import { flushOfflineMutations } from '../orderStore';
import { calculateCargo, calculateCargoEstimates, CargoTariff, DEFAULT_CARGO_TARIFFS } from '../utils/cargo';
import { aiCore } from '../utils/aiCore';
import { normalizePublicQuoteSnapshotPayload, type NormalizedPublicQuoteSnapshot } from '../utils/publicQuoteSnapshot';
import { buildInvoicePayloadFromSnapshot, openInvoicePrintWindow } from '../utils/invoiceDocument';

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Не удалось загрузить изображение'));
  };
  image.src = url;
});

const cropSquareFromImage = async (file: File, zoom = 1): Promise<File> => {
  const image = await loadImageFromFile(file);
  const size = Math.max(1, Math.min(image.width, image.height));
  const cropSize = Math.max(1, Math.round(size / Math.max(zoom, 1)));
  const startX = Math.max(0, Math.round((image.width - cropSize) / 2));
  const startY = Math.max(0, Math.round((image.height - cropSize) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.drawImage(image, startX, startY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.9);
  });
  if (!blob) throw new Error('Не удалось подготовить логотип');
  return new File([blob], `logo-cropped-${Date.now()}.jpg`, { type: 'image/jpeg' });
};

const normalizePhotoKey = (url: string) => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.includes('/storage/v1/object/public/')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('quality');
      parsed.searchParams.delete('format');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
};

const dedupePhotos = (photos: string[]) => {
  const seen = new Set<string>();
  const next: string[] = [];
  photos.forEach((photo) => {
    const normalized = normalizePhotoKey(photo);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push(photo);
  });
  return next;
};

const remapOrderPhotoUrls = (order: Order, replacements: Map<string, string>): Order => {
  const mapUrl = (url: string | undefined) => replacements.get(normalizePhotoKey(url || '')) || (url || '');
  const carPhotos = dedupePhotos((order.carPhotos || []).map((url) => mapUrl(url)));
  const notes = (order.notes || []).map((note) => ({ ...note, photos: dedupePhotos((note.photos || []).map((url) => mapUrl(url))) }));
  const parts = (order.parts || []).map((part) => {
    const partPhotos = dedupePhotos((part.photos || []).map((url) => mapUrl(url)));
    const variants = (part.variants || []).map((variant) => {
      const photos = dedupePhotos((variant.photos || []).map((url) => mapUrl(url)));
      return { ...variant, photos, photoUrl: photos[0] || '' };
    });
    return { ...part, photos: partPhotos, photoUrl: partPhotos[0] || '', variants };
  });

  return {
    ...order,
    carPhotos,
    carPhotoUrl: carPhotos[0] || '',
    vinPhotoUrl: mapUrl(order.vinPhotoUrl || ''),
    notes,
    parts
  };
};



const collectOrderPhotoUrls = (order: Order): string[] => {
  const urls = new Set<string>();
  const add = (url?: string | null) => {
    const value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return;
    urls.add(value);
  };

  add(order.carPhotoUrl);
  add(order.vinPhotoUrl);
  (order.carPhotos || []).forEach(add);
  (order.notes || []).forEach((note) => (note.photos || []).forEach(add));
  (order.parts || []).forEach((part) => {
    add(part.photoUrl);
    (part.photos || []).forEach(add);
    (part.variants || []).forEach((variant) => {
      add(variant.photoUrl);
      (variant.photos || []).forEach(add);
    });
  });

  return Array.from(urls);
};

const removeBrokenPhotosFromOrder = (order: Order): { next: Order; removed: number } => {
  let removed = 0;
  const filterPhotos = (photos: string[] = []) => photos.filter((url) => {
    const broken = isBrokenImageUrl(url);
    if (broken) removed += 1;
    return !broken;
  });

  const carPhotos = dedupePhotos(filterPhotos(order.carPhotos || []));
  const notes = (order.notes || []).map((note) => ({ ...note, photos: dedupePhotos(filterPhotos(note.photos || [])) }));
  const parts = (order.parts || []).map((part) => {
    const partPhotos = dedupePhotos(filterPhotos(part.photos || []));
    const variants = (part.variants || []).map((variant) => {
      const photos = dedupePhotos(filterPhotos(variant.photos || []));
      return { ...variant, photos, photoUrl: photos[0] || '' };
    });
    return { ...part, photos: partPhotos, photoUrl: partPhotos[0] || '', variants };
  });

  const carPhotoUrl = isBrokenImageUrl(order.carPhotoUrl || '') ? '' : (order.carPhotoUrl || (carPhotos[0] || ''));
  const vinPhotoUrl = isBrokenImageUrl(order.vinPhotoUrl || '') ? '' : (order.vinPhotoUrl || '');
  if (!carPhotoUrl && order.carPhotoUrl) removed += 1;
  if (!vinPhotoUrl && order.vinPhotoUrl) removed += 1;

  return {
    next: { ...order, carPhotos, carPhotoUrl: carPhotoUrl || carPhotos[0] || '', vinPhotoUrl, notes, parts },
    removed
  };
};

const getSettingsSectionMeta = (title: string, tone: 'default' | 'danger') => {
  if (tone === 'danger') {
    return {
      icon: <TriangleAlert size={17} />,
      helper: 'Удаление, очистка и необратимые действия',
      iconClass: 'bg-rose-500 text-white'
    };
  }
  if (title.includes('Invoice')) {
    return {
      icon: <FileText size={17} />,
      helper: 'Публичная ссылка, invoice и клиентская форма',
      iconClass: 'bg-blue-500 text-white'
    };
  }
  if (title.includes('Компания')) {
    return {
      icon: <Building2 size={17} />,
      helper: 'Контакты, логотип, подпись и документы',
      iconClass: 'bg-emerald-500 text-white'
    };
  }
  if (title.includes('публичные сметы')) {
    return {
      icon: <Share2 size={17} />,
      helper: 'Ссылки, снапшоты и публичная выдача',
      iconClass: 'bg-indigo-500 text-white'
    };
  }
  if (title.includes('медиа')) {
    return {
      icon: <ImageIcon size={17} />,
      helper: 'Фото, Storage и обслуживание изображений',
      iconClass: 'bg-cyan-500 text-white'
    };
  }
  return {
    icon: <Settings size={17} />,
    helper: 'Cloud, диагностика, синхронизация и AI',
    iconClass: 'bg-slate-600 text-white'
  };
};

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: 'default' | 'danger'; defaultOpen?: boolean }> = ({ title, children, tone = 'default', defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sectionRef = useRef<HTMLElement | null>(null);
  const meta = getSettingsSectionMeta(title, tone);

  return (
    <section ref={sectionRef} className={tone === 'danger' ? 'bg-rose-50/70' : 'bg-white'}>
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (!prev && next) {
              window.setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }
            return next;
          });
        }}
        className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition active:scale-[0.995] ${tone === 'danger' ? 'active:bg-rose-100/70' : 'active:bg-slate-50'}`}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] shadow-sm ${meta.iconClass}`}>{meta.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-black ${tone === 'danger' ? 'text-rose-700' : 'text-slate-950'}`}>{title}</span>
        </span>
        <ChevronRight size={18} className={`shrink-0 transition-transform ${tone === 'danger' ? 'text-rose-300' : 'text-slate-300'} ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && <div className={`border-t px-3 pb-4 pt-3 ${tone === 'danger' ? 'border-rose-100 bg-white/80' : 'border-slate-100 bg-slate-50/45'}`}><div className="space-y-3">{children}</div></div>}
    </section>
  );
};

const CompactBlock: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
      <button type="button" onClick={() => setIsOpen((prev) => !prev)} className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          {subtitle ? <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p> : null}
        </div>
        <span className="text-xs font-bold text-gray-500">{isOpen ? 'Свернуть' : 'Открыть'}</span>
      </button>
      {isOpen ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1.5 min-w-0">
    <label className="text-xs font-bold text-gray-700">{label}</label>
    {children}
  </div>
);

const TariffNumberInput: React.FC<{
  value: number;
  placeholder?: string;
  onCommit: (nextValue: number) => void;
}> = ({ value, placeholder, onCommit }) => {
  const [raw, setRaw] = useState(String(value));

  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const commit = () => {
    onCommit(parseDecimalInput(raw));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={raw}
      onChange={(e) => {
        const next = e.target.value.replace(',', '.');
        if (!/^[0-9]*\.?[0-9]*$/.test(next)) return;
        setRaw(next);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
    />
  );
};

const toTariffNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDecimalInput = (value: string, fallback = 0) => {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const openExternalPage = (url: string) => {
  const normalized = String(url || '').trim();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const opened = window.open(parsed.toString(), '_blank');
    return !!opened;
  } catch {
    return false;
  }
};

const pdfEsc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const openPrintableDocument = (html: string) => {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const printWindow = window.open(objectUrl, '_blank');
  if (!printWindow) {
    URL.revokeObjectURL(objectUrl);
    return false;
  }
  let revoked = false;
  const revokeUrl = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  printWindow.opener = null;
  printWindow.addEventListener('load', revokeUrl, { once: true });
  window.setTimeout(revokeUrl, 60_000);
  return true;
};

const buildQuotePdfHtml = (snapshot: NormalizedPublicQuoteSnapshot, sourceUrl: string) => {
  const currency = snapshot.currency || 'USD';
  const rate = Number(snapshot.rates?.[currency] || 1) || 1;
  const money = (aed: number) => `${(Number(aed || 0) * rate).toFixed(2)} ${currency}`;
  const vehicle = [snapshot.order.brand, snapshot.order.model, snapshot.order.year].filter(Boolean).join(' ') || 'Vehicle quote';
  const created = new Date(String(snapshot.raw.created_at || Date.now()));
  const rows = snapshot.items.map((item, index) => {
    const photo = item.photos?.[0] ? `<img src="${pdfEsc(item.photos[0])}" alt="" />` : `<span>${index + 1}</span>`;
    return `
      <tr>
        <td class="photo">${photo}</td>
        <td>
          <strong>${pdfEsc(item.name || `Part ${index + 1}`)}</strong>
          ${item.status ? `<small>${pdfEsc(item.status)}</small>` : ''}
          ${item.note ? `<small>${pdfEsc(item.note)}</small>` : ''}
        </td>
        <td class="num">${pdfEsc(item.qty || 1)}</td>
        <td class="num">${pdfEsc(money(item.unitPriceAed))}</td>
        <td class="num total">${pdfEsc(money(item.totalAed))}</td>
      </tr>`;
  }).join('');
  const totals = [
    ['Детали', snapshot.subtotalAed],
    ['Доставка', snapshot.deliveryAed],
    ['Упаковка', snapshot.packingAed],
    ['Сервис', snapshot.commissionAed],
    snapshot.discountAed > 0 ? ['Скидка', -snapshot.discountAed] : null,
    ['Итого', snapshot.grandTotalAed],
    snapshot.depositAed > 0 ? ['Депозит', -snapshot.depositAed] : null,
    ['К оплате', snapshot.balanceDueAed],
  ].filter(Boolean) as Array<[string, number]>;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quote ${pdfEsc(vehicle)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #f4f7fb; color: #0f172a; font-family: Inter, Arial, sans-serif; }
  .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 14mm; }
  .top { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; border-bottom:1px solid #e2e8f0; padding-bottom:12px; }
  .brand { display:flex; gap:10px; align-items:center; }
  .brand img { width:42px; height:42px; object-fit:contain; border-radius:10px; }
  .brand-mark { width:42px; height:42px; border-radius:12px; background:#0f172a; color:#fff; display:grid; place-items:center; font-weight:900; }
  .eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:.16em; color:#64748b; font-weight:800; }
  h1 { margin:4px 0 0; font-size:25px; line-height:1.05; }
  .meta { text-align:right; font-size:11px; color:#475569; line-height:1.55; }
  .vehicle { margin-top:14px; border-radius:18px; background:#f8fafc; border:1px solid #e2e8f0; padding:12px 14px; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .vehicle b { display:block; font-size:17px; color:#0f172a; }
  .vehicle span { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.12em; font-weight:800; }
  table { width:100%; margin-top:14px; border-collapse:collapse; table-layout:fixed; }
  th { text-align:left; font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.1em; padding:8px; border-bottom:1px solid #cbd5e1; }
  td { padding:9px 8px; border-bottom:1px solid #e2e8f0; vertical-align:middle; font-size:11px; }
  td strong { display:block; font-size:12px; }
  td small { display:block; margin-top:2px; color:#64748b; font-size:9px; line-height:1.25; }
  .photo { width:44px; }
  .photo img, .photo span { width:38px; height:38px; border-radius:10px; background:#f1f5f9; object-fit:cover; display:grid; place-items:center; font-weight:900; color:#94a3b8; }
  .num { text-align:right; white-space:nowrap; }
  .total { font-weight:900; color:#0f172a; }
  .bottom { display:grid; grid-template-columns:1fr 72mm; gap:16px; margin-top:16px; align-items:start; }
  .terms { border-radius:16px; background:#f8fafc; border:1px solid #e2e8f0; padding:12px; font-size:10px; color:#475569; line-height:1.45; }
  .totals { border-radius:16px; border:1px solid #dbeafe; background:#eff6ff; padding:12px; }
  .line { display:flex; justify-content:space-between; gap:14px; font-size:11px; padding:5px 0; color:#334155; }
  .line.final { margin-top:5px; padding-top:9px; border-top:1px solid #bfdbfe; font-size:16px; font-weight:900; color:#0f172a; }
  .signature { margin-top:16px; display:flex; justify-content:space-between; align-items:flex-end; gap:18px; }
  .signature img { max-width:160px; max-height:70px; object-fit:contain; }
  .contacts { font-size:10px; color:#475569; line-height:1.45; }
  .source { margin-top:10px; font-size:8px; color:#94a3b8; word-break:break-all; }
  @media print { html, body { background:#fff; } .sheet { margin:0; } }
</style>
</head>
<body>
  <main class="sheet">
    <section class="top">
      <div class="brand">
        ${snapshot.contact.logoUrl ? `<img src="${pdfEsc(snapshot.contact.logoUrl)}" alt="" />` : '<div class="brand-mark">SM</div>'}
        <div><div class="eyebrow">Stark Motors</div><h1>PDF смета</h1></div>
      </div>
      <div class="meta">
        <b>${pdfEsc(created.toLocaleDateString('ru-RU'))}</b><br />
        ${pdfEsc(snapshot.contact.managerName || 'Stark Motors')}<br />
        ${pdfEsc(snapshot.contact.website || snapshot.contact.instagram || snapshot.contact.telegram || '')}
      </div>
    </section>
    <section class="vehicle">
      <div><span>Автомобиль</span><b>${pdfEsc(vehicle)}</b></div>
      <div><span>VIN</span><b>${pdfEsc(snapshot.order.vin || '—')}</b></div>
    </section>
    <table>
      <thead><tr><th style="width:48px"></th><th>Позиция</th><th style="width:50px" class="num">Кол-во</th><th style="width:92px" class="num">Цена</th><th style="width:96px" class="num">Итого</th></tr></thead>
      <tbody>${rows || '<tr><td></td><td><strong>Нет позиций</strong></td><td class="num">0</td><td class="num">—</td><td class="num total">—</td></tr>'}</tbody>
    </table>
    <section class="bottom">
      <div class="terms">
        <b>Условия</b><br />
        ${pdfEsc(snapshot.contact.workTerms || 'Перед оплатой подтвердите все позиции, сроки и логистику с менеджером.')}
        <div class="source">${pdfEsc(sourceUrl)}</div>
      </div>
      <div class="totals">
        ${totals.map(([label, value], index) => `<div class="line ${index === totals.length - 1 ? 'final' : ''}"><span>${pdfEsc(label)}</span><b>${pdfEsc(money(value))}</b></div>`).join('')}
      </div>
    </section>
    <section class="signature">
      <div class="contacts">
        ${snapshot.contact.whatsapp ? `WhatsApp: +${pdfEsc(snapshot.contact.whatsapp)}<br />` : ''}
        ${snapshot.contact.email ? `Email: ${pdfEsc(snapshot.contact.email)}<br />` : ''}
        ${snapshot.contact.telegram ? `Telegram: ${pdfEsc(snapshot.contact.telegram)}<br />` : ''}
      </div>
      <div>${snapshot.contact.signatureUrl ? `<img src="${pdfEsc(snapshot.contact.signatureUrl)}" alt="" />` : ''}</div>
    </section>
  </main>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });</script>
</body>
</html>`;
};

const openQuotePdfPrintWindow = (snapshot: NormalizedPublicQuoteSnapshot, sourceUrl: string) => openPrintableDocument(buildQuotePdfHtml(snapshot, sourceUrl));

const normalizeTariff = (tariff: Partial<CargoTariff>): CargoTariff => ({
  country: String(tariff.country || '').trim(),
  airRegularUsdPerKg: toTariffNumber((tariff as any).airRegularUsdPerKg, toTariffNumber((tariff as any).regularUsdPerKg, toTariffNumber((tariff as any).airUsdPerKg))),
  airOversizedUsdPerKg: toTariffNumber((tariff as any).airOversizedUsdPerKg, toTariffNumber((tariff as any).oversizedUsdPerKg, toTariffNumber((tariff as any).airUsdPerKg))),
  containerUsdPerKg: toTariffNumber(tariff.containerUsdPerKg),
  airSeatUsd: toTariffNumber(tariff.airSeatUsd),
  minAirKg: toTariffNumber(tariff.minAirKg),
  minContainerKg: toTariffNumber(tariff.minContainerKg),
  airEtaDays: String(tariff.airEtaDays || '').trim(),
  containerEtaDays: String(tariff.containerEtaDays || '').trim()
});



type GalleryRow = {
  bucket: string;
  path: string;
  size: number;
  mimetype: string;
  publicUrl: string;
  createdAt?: string;
  updatedAt?: string;
};

type GallerySort = 'size_desc' | 'size_asc' | 'date_desc' | 'date_asc' | 'folder';
type GalleryTaskType = 'compress' | 'delete';
type GalleryTask = { id: string; label: string; type: GalleryTaskType; urls: string[]; createdAt: number; progress: number; total: number; done?: boolean; failed?: number };
type AiTestTask = 'analyze_text' | 'transform_text' | 'extract_structured_data';
type SettingsSnapshotRow = { id: string; token: string; snapshot_id?: string | null; expires_at: string; created_at?: string | null; order_id?: string | null; payload_json?: unknown };

const GALLERY_TASKS_KEY = 'dubai_spares_gallery_tasks_v1';

const loadGalleryTasks = (): GalleryTask[] => {
  try {
    const raw = localStorage.getItem(GALLERY_TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const LOCKED_SNAPSHOTS_KEY = 'dubai_spares_locked_public_snapshots_v1';

const loadLockedSnapshotIds = (): string[] => {
  try {
    const raw = localStorage.getItem(LOCKED_SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
};

const AI_RESULT_PREVIEW_LIMIT = 4000;

type AiRenderState = {
  preview: string;
  full: string;
  truncated: boolean;
};

const stringifyAiResponse = (value: unknown): AiRenderState => {
  const seen = new WeakSet<object>();
  const safeJson = JSON.stringify(
    value,
    (_key, currentValue) => {
      if (!currentValue || typeof currentValue !== 'object') return currentValue;
      if (seen.has(currentValue as object)) return '[Circular]';
      seen.add(currentValue as object);
      return currentValue;
    },
    2
  ) || '';

  const truncated = safeJson.length > AI_RESULT_PREVIEW_LIMIT;
  return {
    preview: truncated ? `${safeJson.slice(0, AI_RESULT_PREVIEW_LIMIT)}
…[preview truncated]` : safeJson,
    full: safeJson,
    truncated,
  };
};

const SettingsScreen: React.FC = () => {
  const publicRequestFormUrl = `${window.location.origin}${window.location.pathname}#/request`;
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();
  const { orders, updateOrder, restoreData, exportData, fetchOrders } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<'available' | 'unavailable'>(() => (isCloudConfigured ? 'available' : 'unavailable'));
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupController, setBackupController] = useState<AbortController | null>(null);
  const [lastBackupId, setLastBackupId] = useState('');
  const [snapshotRows, setSnapshotRows] = useState<SettingsSnapshotRow[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [dangerActionProgress, setDangerActionProgress] = useState<{ label: string; processed: number; total: number; details?: string } | null>(null);
  const [isHardResetting, setIsHardResetting] = useState(false);
  const [logoCrop, setLogoCrop] = useState<{ file: File; previewUrl: string } | null>(null);
  const [logoCropZoom, setLogoCropZoom] = useState(1);
  const [newDefaultChecklistTask, setNewDefaultChecklistTask] = useState('');
  const [newZoneName, setNewZoneName] = useState('');
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [editingZoneValue, setEditingZoneValue] = useState('');
  const [lockedSnapshotIds, setLockedSnapshotIds] = useState<string[]>(() => loadLockedSnapshotIds());
  const [serverGalleryRows, setServerGalleryRows] = useState<GalleryRow[]>([]);
  const [serverGalleryLoading, setServerGalleryLoading] = useState(false);
  const [selectedGalleryKeys, setSelectedGalleryKeys] = useState<string[]>([]);
  const [isGallerySelectionMode, setIsGallerySelectionMode] = useState(false);
  const [isGalleryFullscreen, setIsGalleryFullscreen] = useState(false);
  const [gallerySearch, setGallerySearch] = useState('');
  const [gallerySort, setGallerySort] = useState<GallerySort>('size_desc');
  const [heavyOnly, setHeavyOnly] = useState(false);
  const [folderFilter, setFolderFilter] = useState('all');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [galleryTasks, setGalleryTasks] = useState<GalleryTask[]>(() => loadGalleryTasks());
  const cloudConfigDiagnostics = useMemo(() => getCloudConfigDiagnostics(), []);
  const cloudStatusSummary = useMemo(() => {
    if (cloudConfigDiagnostics.isCloudConfigured) return 'Cloud config OK';
    if (cloudConfigDiagnostics.rawSupabaseUrlState === 'empty' || cloudConfigDiagnostics.rawSupabaseAnonKeyState === 'empty') {
      return 'Frontend build did not receive one or both VITE_ env values. Rebuild/redeploy is required after fixing env.';
    }
    if (!cloudConfigDiagnostics.isSupabaseUrlValid) return 'Cloud config failed URL validation.';
    if (!cloudConfigDiagnostics.isSupabaseAnonKeyJwt && !cloudConfigDiagnostics.isSupabaseAnonKeyPublishable) {
      return 'Cloud config failed anon key format validation.';
    }
    return 'Cloud config failed validation.';
  }, [cloudConfigDiagnostics]);
  const [aiTestTask, setAiTestTask] = useState<AiTestTask>('analyze_text');
  const [aiTestText, setAiTestText] = useState('Toyota Camry 2020 нужна передняя левая фара, состояние б/у, доставка в Дубай.');
  const [aiTestInstructions, setAiTestInstructions] = useState('Определи ключевые параметры запроса клиента и верни краткий структурированный вывод.');
  const [aiTestOperation, setAiTestOperation] = useState('Сделай короткую деловую версию текста для менеджера.');
  const [aiTestTargetLang, setAiTestTargetLang] = useState('ru');
  const [aiTestTone, setAiTestTone] = useState('professional');
  const [aiTestFormat, setAiTestFormat] = useState('plain_text');
  const [aiTestSchema, setAiTestSchema] = useState('{\n  "brand": "string",\n  "model": "string",\n  "year": "string",\n  "part_name": "string",\n  "condition": "string",\n  "delivery_city": "string"\n}');
  const [aiTestResult, setAiTestResult] = useState<AiRenderState | null>(null);
  const [aiTestError, setAiTestError] = useState<string | null>(null);
  const [aiTestPending, setAiTestPending] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<string | null>(null);
  const [aiTestShowFullResponse, setAiTestShowFullResponse] = useState(false);
  const aiTestAbortRef = useRef<AbortController | null>(null);
  const aiTestRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const timezoneList = useMemo(() => ['Asia/Dubai', 'UTC', 'Europe/Moscow'], []);

  const formatDateTime = (value?: string | null) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '—';
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return normalized;
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  useEffect(() => {
    document.documentElement.lang = settings.appLanguage;
  }, [settings.appLanguage]);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);



  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      aiTestAbortRef.current?.abort('AI request was cancelled. Please retry.');
      aiCore.cancelActiveRequest('AI request was cancelled. Please retry.');
    };
  }, []);

  const updateDraft = (patch: Partial<AppSettings>) => {
    setDraftSettings((prev) => ({ ...prev, ...patch }));
    setSaveNotice(null);
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(draftSettings) !== JSON.stringify(settings), [draftSettings, settings]);

  const saveChanges = () => {
    const nextSettings = updateSettings(draftSettings);
    const tariffsChanged = JSON.stringify(settings.cargoTariffs || []) !== JSON.stringify(nextSettings.cargoTariffs || []);
    if (tariffsChanged) {
      orders.forEach((currentOrder) => {
        const nextCargo = calculateCargo(currentOrder, nextSettings);
        const nextEstimates = calculateCargoEstimates(currentOrder, nextSettings);
        updateOrder({
          ...currentOrder,
          logistics: {
            ...currentOrder.logistics,
            cargoEtaDays: nextCargo.eta,
            cargoTotalWeightKg: nextCargo.realWeight,
            cargoChargeableWeightKg: nextCargo.chargeableWeight,
            cargoTotalPlaces: nextCargo.totalPlaces,
            cargoBaseCostUsd: nextCargo.baseCostUsd,
            cargoTotalCostUsd: nextCargo.totalCostUsd,
            cargoAirEtaDays: nextEstimates.air.eta,
            cargoAirCostUsd: nextEstimates.air.totalCostUsd,
            cargoContainerEtaDays: nextEstimates.container.eta,
            cargoContainerCostUsd: nextEstimates.container.totalCostUsd
          }
        });
      });
    }
    setSaveNotice('Изменения сохранены и применены во всех разделах.');
  };

  const addDefaultChecklistTask = () => {
    const text = newDefaultChecklistTask.trim();
    if (!text) return;
    const exists = (draftSettings.defaultVendorChecklist || []).some((item) => item.trim().toLowerCase() === text.toLowerCase());
    if (exists) {
      setNewDefaultChecklistTask('');
      return;
    }
    updateDraft({ defaultVendorChecklist: [...(draftSettings.defaultVendorChecklist || []), text] });
    setNewDefaultChecklistTask('');
  };

  const removeDefaultChecklistTask = (index: number) => {
    updateDraft({ defaultVendorChecklist: (draftSettings.defaultVendorChecklist || []).filter((_, idx) => idx !== index) });
  };

  const addZone = () => {
    const name = newZoneName.trim();
    if (!name) return;
    const zones = draftSettings.orderZones || [];
    if (zones.some((z) => z.toLowerCase() === name.toLowerCase())) {
      window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Такая зона уже существует', tone: 'info' } }));
      setNewZoneName('');
      return;
    }
    updateDraft({ orderZones: [...zones, name] });
    setNewZoneName('');
  };

  const removeZone = (index: number) => {
    updateDraft({ orderZones: (draftSettings.orderZones || []).filter((_, idx) => idx !== index) });
  };

  const startEditZone = (index: number) => {
    setEditingZoneIndex(index);
    setEditingZoneValue((draftSettings.orderZones || [])[index] || '');
  };

  const saveEditZone = () => {
    if (editingZoneIndex === null) return;
    const name = editingZoneValue.trim();
    if (!name) { setEditingZoneIndex(null); return; }
    const zones = [...(draftSettings.orderZones || [])];
    zones[editingZoneIndex] = name;
    updateDraft({ orderZones: zones });
    setEditingZoneIndex(null);
    setEditingZoneValue('');
  };

  const cargoTariffs = useMemo(
    () => (draftSettings.cargoTariffs?.length ? draftSettings.cargoTariffs : DEFAULT_CARGO_TARIFFS).map((item) => normalizeTariff(item)),
    [draftSettings.cargoTariffs]
  );

  const updateCargoTariff = (index: number, patch: Partial<CargoTariff>) => {
    const next = cargoTariffs.map((item, idx) => (idx === index ? normalizeTariff({ ...item, ...patch }) : item));
    updateDraft({ cargoTariffs: next });
  };

  const addCargoTariff = () => {
    const template = DEFAULT_CARGO_TARIFFS[0];
    updateDraft({
      cargoTariffs: [...cargoTariffs, normalizeTariff({ ...template, country: '' })]
    });
  };

  const removeCargoTariff = (index: number) => {
    updateDraft({ cargoTariffs: cargoTariffs.filter((_, idx) => idx !== index) });
  };


  const buildCompactBackupPayload = () => {
    const raw = exportData();
    return {
      ...raw,
      orders: (raw.orders || []).map((order: any) => ({
        ...order,
        carPhotoUrl: '',
        carPhotos: [],
        vinPhotoUrl: '',
        parts: (order.parts || []).map((part: any) => ({
          ...part,
          photoUrl: '',
          photos: [],
          variants: (part.variants || []).map((variant: any) => ({
            ...variant,
            photoUrl: '',
            photos: []
          }))
        }))
      }))
    };
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setDangerActionProgress(null);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud action failed';
      alert(`${message}. Use "Copy diagnostics" and retry.`);
    } finally {
      setBusy(null);
    }
  };

  const cancelAiCoreTest = (message = 'AI request was cancelled. Please retry.') => {
    aiTestAbortRef.current?.abort(message);
    aiCore.cancelActiveRequest(message);
    aiTestAbortRef.current = null;
    if (!isMountedRef.current) return;
    setAiTestPending(false);
    setAiTestStatus(message);
  };

  const runAiCoreTest = async () => {
    setAiTestError(null);
    setAiTestResult(null);
    setAiTestShowFullResponse(false);

    if (!aiTestText.trim()) {
      setAiTestError('Добавьте текст для теста AI ядра.');
      setAiTestStatus(null);
      return;
    }

    let parsedSchema: Record<string, unknown> | null = null;
    if (aiTestTask === 'extract_structured_data') {
      try {
        parsedSchema = JSON.parse(aiTestSchema);
      } catch {
        setAiTestError('Схема JSON заполнена некорректно.');
        setAiTestStatus(null);
        return;
      }
    }

    aiTestAbortRef.current?.abort('AI request was cancelled. Please retry.');
    const controller = new AbortController();
    aiTestAbortRef.current = controller;
    const requestId = aiTestRequestIdRef.current + 1;
    aiTestRequestIdRef.current = requestId;

    setAiTestPending(true);
    setAiTestStatus('AI is thinking...');

    let response;

    if (aiTestTask === 'analyze_text') {
      response = await aiCore.analyzeText({
        text: aiTestText.trim(),
        instructions: aiTestInstructions.trim() || 'Проанализируй текст и верни полезный результат.'
      }, { signal: controller.signal });
    } else if (aiTestTask === 'transform_text') {
      response = await aiCore.transformText({
        text: aiTestText.trim(),
        operation: aiTestOperation.trim() || 'Переформулируй текст',
        target_lang: aiTestTargetLang.trim() || undefined,
        tone: aiTestTone.trim() || undefined,
        format: aiTestFormat.trim() || undefined,
        instructions: aiTestInstructions.trim() || undefined
      }, { signal: controller.signal });
    } else {
      response = await aiCore.extractStructuredData({
        text: aiTestText.trim(),
        schema: parsedSchema || {},
        instructions: aiTestInstructions.trim() || 'Извлеки структуру по схеме.'
      }, { signal: controller.signal });
    }

    if (!isMountedRef.current || aiTestRequestIdRef.current !== requestId) {
      return;
    }

    aiTestAbortRef.current = null;
    setAiTestPending(false);
    setAiTestResult(stringifyAiResponse(response));

    if (!response.ok) {
      setAiTestError(response.error || 'AI ядро вернуло ошибку.');
      setAiTestStatus(response.error || 'AI request failed.');
      return;
    }

    setAiTestStatus('Готово. Ответ получен.');
  };

  const clearApplicationCache = async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      await Promise.all((databases || [])
        .map((database) => database?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .map((name) => new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })));
    }

    window.sessionStorage.clear();
    const localKeys = Object.keys(window.localStorage);
    localKeys.forEach((key) => window.localStorage.removeItem(key));
  };

  const clearAllLocalDataAndRestart = async () => {
    const first = window.confirm('⚠️ Это полностью очистит кэш, историю и все локальные данные. Продолжить?');
    if (!first) return;

    const pendingBeforeSync = await offlineDb.getMutationCount();
    if (pendingBeforeSync > 0) {
      if (!navigator.onLine) {
        alert(`Найдено ${pendingBeforeSync} несинхронизированных изменений. Подключите интернет и повторите, чтобы сначала отправить их на сервер.`);
        return;
      }

      setDangerActionProgress({
        label: 'Подготовка к очистке',
        processed: 0,
        total: 4,
        details: `Отправляем ${pendingBeforeSync} локальных изменений на сервер`
      });

      await flushOfflineMutations({ force: true });

      const pendingAfterSync = await offlineDb.getMutationCount();
      if (pendingAfterSync > 0) {
        alert(`Не удалось синхронизировать все локальные изменения (${pendingAfterSync} осталось в очереди). Очистка отменена.`);
        return;
      }
    }

    setIsHardResetting(true);
    setDangerActionProgress({ label: 'Очистка приложения', processed: 1, total: 4, details: 'Удаление кэша' });
    await clearApplicationCache();
    setDangerActionProgress({ label: 'Очистка приложения', processed: 2, total: 4, details: 'Удаление оффлайн-данных' });
    await offlineDb.clearAllOfflineData();
    setDangerActionProgress({ label: 'Очистка приложения', processed: 3, total: 4, details: 'Перезапуск приложения' });
    window.location.reload();
  };



  const handleExportLocalBackup = () => {
    try {
      const data = exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dubai_spares_backup_${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      alert(`Не удалось экспортировать бэкап: ${message}`);
    }
  };

  const handleCompressAllServerPhotos = () => void withBusy('storage-compress-all', async () => {
    const first = window.confirm('Сжать ВСЕ фотографии на сервере: заменить оригиналы сжатыми версиями в том же пути (без потери ссылок)? Это может занять много времени.');
    if (!first) return;

    const result = await runStorageImageMaintenance({
      recompressAll: true,
      onProgress: (progress) => {
        setDangerActionProgress({
          label: 'Сжатие фото на сервере',
          processed: progress.processed,
          total: progress.total,
          details: progress.currentPath
        });
      }
    });
    const mbSaved = (result.bytesSaved / (1024 * 1024)).toFixed(2);
    const tone = result.failures > 0 ? 'warning' : 'success';
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone,
        message: `Обновлено (заменено сжатыми): ${result.compressed}, проверено фото: ${result.imageFiles}, экономия: ${mbSaved} MB${result.failures > 0 ? `, ошибок: ${result.failures}` : ''}`
      }
    }));
  });

  const handleRemovePhotoDuplicates = () => void withBusy('storage-delete-duplicates', async () => {
    const first = window.confirm('Удалить только более тяжёлые дубликаты фото (оставить самые лёгкие версии) и автоматически переназначить ссылки во всех заказах?');
    if (!first) return;

    const result = await runStorageImageMaintenance({
      deduplicateByExactSize: true,
      applyDedupDeletes: false,
      onProgress: (progress) => {
        setDangerActionProgress({
          label: 'Поиск дубликатов фото',
          processed: progress.processed,
          total: progress.total,
          details: progress.currentPath
        });
      }
    });

    const replacements = new Map<string, string>();
    result.dedupMappings.forEach((mapping) => {
      const duplicatePublic = `${SUPABASE_URL}/storage/v1/object/public/${mapping.bucket}/${mapping.duplicatePath}`;
      const canonicalPublic = `${SUPABASE_URL}/storage/v1/object/public/${mapping.bucket}/${mapping.canonicalPath}`;
      replacements.set(normalizePhotoKey(duplicatePublic), canonicalPublic);
    });

    let updatedOrders = 0;
    for (let index = 0; index < orders.length; index++) {
      const order = orders[index];
      const remapped = remapOrderPhotoUrls(order, replacements);
      if (JSON.stringify(remapped) === JSON.stringify(order)) continue;
      setDangerActionProgress({ label: 'Обновление ссылок в заказах', processed: index + 1, total: orders.length, details: order.id });
      await updateOrder(remapped);
      updatedOrders += 1;
    }

    const deleteResult = await deleteStorageDuplicateMappings(
      result.dedupMappings.map((mapping) => ({ bucket: mapping.bucket, duplicatePath: mapping.duplicatePath })),
      (progress) => setDangerActionProgress({
        label: 'Удаление дубликатов на сервере',
        processed: progress.processed,
        total: progress.total,
        details: progress.path
      })
    );

    const deletedBytes = result.dedupMappings.reduce((sum, mapping) => sum + mapping.size, 0);
    const mbSaved = (deletedBytes / (1024 * 1024)).toFixed(2);
    const tone = (result.failures + deleteResult.failures) > 0 ? 'warning' : 'success';
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone,
        message: `Удалено дубликатов: ${deleteResult.deleted}, проверено фото: ${result.imageFiles}, обновлено заказов: ${updatedOrders}, освобождено: ${mbSaved} MB${(result.failures + deleteResult.failures) > 0 ? `, ошибок: ${result.failures + deleteResult.failures}` : ''}`
      }
    }));
  });

  const handleClearBrokenLinks = () => void withBusy('clear-broken-links', async () => {
    let updatedOrders = 0;
    let removedLinks = 0;

    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      const { next, removed } = removeBrokenPhotosFromOrder(order);
      if (!removed) continue;
      setDangerActionProgress({ label: 'Очистка битых ссылок', processed: index + 1, total: orders.length, details: order.id });
      await updateOrder(next);
      updatedOrders += 1;
      removedLinks += removed;
    }

    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: `Очистка завершена: обновлено заказов ${updatedOrders}, удалено ссылок ${removedLinks}`
      }
    }));
  });


  const handleRestoreBrokenPhotos = () => void withBusy('restore-broken-photos', async () => {
    clearBrokenImageBlacklist();
    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: 'Кэш битых фото очищен. Приложение повторно попробует загрузить фотографии.'
      }
    }));
  });

  const handleCheckAndCleanBrokenPhotos = () => void withBusy('check-clean-broken-photos', async () => {
    const input = window.prompt('Сколько последних заказов проверить?', '50');
    const limit = Math.max(1, Math.min(300, Number(input) || 50));
    const sorted = [...orders].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    const targetOrders = sorted.slice(0, limit);

    const queue = new Set<string>();
    targetOrders.forEach((order) => collectOrderPhotoUrls(order).forEach((url) => queue.add(url)));
    const urls = Array.from(queue).filter((url) => !isBrokenImageUrl(url));

    let checked = 0;
    const concurrency = 4;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (cursor < urls.length) {
        const current = cursor;
        cursor += 1;
        const url = urls[current];
        setDangerActionProgress({ label: 'Проверка битых фото', processed: checked, total: urls.length, details: normalizeBrokenImageKey(url).slice(0, 90) });
        try {
          const response = await fetch(url, { method: 'GET' });
          if (!response.ok && shouldBlacklistByStatus(response.status)) {
            markBrokenImageUrl(url);
          }
        } catch {
          markBrokenImageUrl(url);
        } finally {
          checked += 1;
        }
      }
    }));

    let updatedOrders = 0;
    let removedLinks = 0;
    for (let index = 0; index < targetOrders.length; index += 1) {
      const order = targetOrders[index];
      const { next, removed } = removeBrokenPhotosFromOrder(order);
      if (!removed) continue;
      setDangerActionProgress({ label: 'Сохранение очищенных заказов', processed: index + 1, total: targetOrders.length, details: order.id });
      await updateOrder(next);
      updatedOrders += 1;
      removedLinks += removed;
    }

    window.dispatchEvent(new CustomEvent('app-toast', {
      detail: {
        tone: 'success',
        message: `Проверено фото: ${urls.length}, обновлено заказов: ${updatedOrders}, удалено ссылок: ${removedLinks}`
      }
    }));
  });





  const uploadBrandingImage = async (file: File, type: 'logo' | 'signature') => {
    const folder = type === 'logo' ? 'branding/logos' : 'branding/signatures';
    const fileName = `${type}-${Date.now()}`;
    const uploadedUrl = await uploadImageToStorage(file, folder, fileName);
    if (!uploadedUrl) throw new Error('Не удалось загрузить изображение');
    if (type === 'logo') {
      updateDraft({ publicCompanyLogoUrl: uploadedUrl });
    } else {
      updateDraft({ publicInvoiceSignatureUrl: uploadedUrl });
    }
  };

  const handlePublicTermsFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void withBusy('public-terms-file', async () => {
      const safeName = (file.name || `terms-${Date.now()}`)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const uploadName = `${Date.now()}-${safeName || 'terms-file'}`;
      const uploadedUrl = await uploadFileToStorage(file, 'public/terms', uploadName, file.type || 'application/octet-stream');
      updateDraft({
        publicTermsFileUrl: uploadedUrl,
        publicTermsFileName: file.name || uploadName
      });
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: 'Файл условий загружен'
        }
      }));
    });
  };

  const handleBrandingFileChange = (event: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'signature') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (type === 'logo') {
      const previewUrl = URL.createObjectURL(file);
      setLogoCrop((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl };
      });
      setLogoCropZoom(1);
      return;
    }
    void withBusy(`branding-${type}`, async () => {
      await uploadBrandingImage(file, type);
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: 'Подпись загружена'
        }
      }));
    });
  };

  const busyLabel = (label: string, idle: string, running: string) => (busy === label ? running : idle);

  const closeLogoCrop = () => {
    setLogoCrop((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setLogoCropZoom(1);
  };

  const saveLogoCrop = () => {
    if (!logoCrop) return;
    void withBusy('branding-logo', async () => {
      const cropped = await cropSquareFromImage(logoCrop.file, logoCropZoom);
      await uploadBrandingImage(cropped, 'logo');
      closeLogoCrop();
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: {
          tone: 'success',
          message: 'Логотип обрезан и загружен'
        }
      }));
    });
  };

  const loadSnapshots = async () => {
    setSnapshotsLoading(true);
    setSnapshotNotice(null);
    try {
      const result = await listPublicQuoteSnapshots();
      if (!result.ok) {
        setSnapshotRows([]);
        setSnapshotNotice(`Ошибка загрузки снапшотов: ${result.error}`);
        return;
      }
      setSnapshotRows(result.data || []);
      if ((result.data || []).length === 0) {
        setSnapshotNotice('Снапшоты на сервере не найдены.');
      }
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const buildSnapshotPublicKey = (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const token = String(row.token || '').trim();
    const snapshotId = String(row.snapshot_id || row.id || '').trim();
    if (!token) return '';
    return snapshotId ? `${token}.${snapshotId}` : token;
  };

  const toggleSnapshotLock = (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const key = String(row.snapshot_id || row.id || '').trim();
    if (!key) return;
    setLockedSnapshotIds((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      localStorage.setItem(LOCKED_SNAPSHOTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const buildSnapshotSlug = (row: { payload_json?: unknown; order_id?: string | null }) => {
    const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
      ? row.payload_json as Record<string, unknown>
      : {};
    const order = payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order)
      ? payload.order as Record<string, unknown>
      : {};
    const brand = typeof order.brand === 'string' ? order.brand.trim() : '';
    const model = typeof order.model === 'string' ? order.model.trim() : '';
    const year = typeof order.year === 'string' || typeof order.year === 'number' ? String(order.year).trim() : '';
    const slug = [brand, model, year].filter(Boolean).join('-').replace(/\s+/g, '-').toLowerCase();
    return slug || String(row.order_id || 'quote').trim() || 'quote';
  };

  const buildSnapshotUrl = (row: { id: string; token: string; snapshot_id?: string | null; payload_json?: unknown; order_id?: string | null }) => {
    const key = buildSnapshotPublicKey(row);
    const slug = buildSnapshotSlug(row);
    const url = new URL(`${window.location.origin}/#/q/${encodeURIComponent(slug)}`);
    if (key) {
      url.searchParams.set('k', key);
    }
    return url.toString();
  };

  const copySnapshotUrl = async (row: { id: string; token: string; snapshot_id?: string | null; payload_json?: unknown; order_id?: string | null }) => {
    const token = buildSnapshotPublicKey(row);
    const url = buildSnapshotUrl(row);
    await navigator.clipboard.writeText(url);
    setSnapshotNotice(`Ссылка скопирована: ${token}`);
  };

  const resolveNormalizedSnapshot = (row: SettingsSnapshotRow) => {
    const normalized = normalizePublicQuoteSnapshotPayload(row.payload_json, draftSettings);
    if (!normalized?.hasRenderableContent) {
      setSnapshotNotice('Не удалось собрать документ: payload снапшота пустой или повреждён.');
      return null;
    }
    return normalized;
  };

  const handleSnapshotQuotePdf = (row: SettingsSnapshotRow) => {
    const normalized = resolveNormalizedSnapshot(row);
    if (!normalized) return;
    const opened = openQuotePdfPrintWindow(normalized, buildSnapshotUrl(row));
    setSnapshotNotice(opened ? 'PDF-смета открыта. Выберите “Сохранить как PDF”.' : 'Не удалось открыть PDF-смету. Проверьте блокировку всплывающих окон.');
  };

  const handleSnapshotInvoicePdf = (row: SettingsSnapshotRow) => {
    const normalized = resolveNormalizedSnapshot(row);
    if (!normalized) return;
    const currency = normalized.currency || 'AED';
    const opened = openInvoicePrintWindow(buildInvoicePayloadFromSnapshot(normalized, {
      currency,
      rate: Number(normalized.rates?.[currency] || 1) || 1,
      language: 'en'
    }));
    setSnapshotNotice(opened ? 'Invoice открыт. Выберите “Сохранить как PDF”.' : 'Не удалось открыть invoice. Проверьте блокировку всплывающих окон.');
  };


const resolveSnapshotCarTitle = (row: { order_id?: string | null; payload_json?: unknown }) => {
  const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
    ? row.payload_json as Record<string, unknown>
    : {};
  const order = payload.order && typeof payload.order === 'object' && !Array.isArray(payload.order)
    ? payload.order as Record<string, unknown>
    : {};
  const brand = typeof order.brand === 'string' ? order.brand.trim() : '';
  const model = typeof order.model === 'string' ? order.model.trim() : '';
  const year = typeof order.year === 'string' || typeof order.year === 'number' ? String(order.year).trim() : '';
  const label = [brand, model, year].filter(Boolean).join(' ');
  if (label) return label;
  if (typeof row.order_id === 'string' && row.order_id.trim()) return `Order ${row.order_id.trim()}`;
  return 'Без названия авто';
};

  const handleSnapshotDelete = async (row: { id: string; token: string; snapshot_id?: string | null }) => {
    const key = String(row.snapshot_id || row.id || row.token || '').trim();
    if (!key) return;
    if (lockedSnapshotIds.includes(key)) {
      setSnapshotNotice('Снапшот в замке. Снимите замок перед удалением.');
      return;
    }
    const result = await deletePublicQuoteSnapshot(key);
    if (!result.ok) {
      setSnapshotNotice(`Не удалось удалить снапшот: ${result.error}`);
      return;
    }
    setSnapshotNotice(result.data?.removed ? 'Снапшот удалён.' : 'Снапшот не найден на сервере.');
    await loadSnapshots();
  };

  const handleClearSnapshotsExceptLocked = async () => {
    const unlocked = snapshotRows.filter((row) => {
      const key = String(row.snapshot_id || row.id || '').trim();
      return key && !lockedSnapshotIds.includes(key);
    });
    let removed = 0;
    for (const row of unlocked) {
      const key = String(row.snapshot_id || row.id || row.token || '').trim();
      if (!key) continue;
      const result = await deletePublicQuoteSnapshot(key);
      if (result.ok && result.data?.removed) removed += 1;
    }
    setSnapshotNotice(`Удалено снапшотов: ${removed}. Защищено замком: ${lockedSnapshotIds.length}.`);
    await loadSnapshots();
  };

  const loadServerGallery = async () => {
    setServerGalleryLoading(true);
    try {
      const rows = await listAllStorageImages();
      const sorted = rows.sort((a, b) => b.size - a.size);
      setServerGalleryRows(sorted);
      setSelectedGalleryKeys((prev) => {
        if (!prev.length) return prev;
        const allowed = new Set(sorted.map((row) => `${row.bucket}:${row.path}`));
        return prev.filter((key) => allowed.has(key));
      });
    } finally {
      setServerGalleryLoading(false);
    }
  };

  const handleDeleteServerPhoto = async (url: string) => {
    await deleteStorageImageByPublicUrl(url);
    await loadServerGallery();
  };

  const handleCompressServerPhoto = async (url: string) => {
    await recompressExistingStorageImage(url);
    await loadServerGallery();
  };

  useEffect(() => {
    void (async () => {
      try {
        await loadSnapshots();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось загрузить снапшоты';
        setSnapshotRows([]);
        setSnapshotNotice(message);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadServerGallery();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось загрузить галерею';
        window.dispatchEvent(new CustomEvent('app-toast', { detail: { tone: 'error', message } }));
        setServerGalleryRows([]);
      }
    })();
  }, []);

  const galleryKey = (row: { bucket: string; path: string }) => `${row.bucket}:${row.path}`;

  const activeGalleryRows = useMemo(() => serverGalleryRows, [serverGalleryRows]);

  const folderOptions = useMemo(() => {
    const folders = new Set<string>();
    activeGalleryRows.forEach((row) => {
      const folder = row.path.includes('/') ? row.path.split('/').slice(0, -1).join('/') : 'root';
      folders.add(folder || 'root');
    });
    return ['all', ...Array.from(folders).sort((a, b) => a.localeCompare(b))];
  }, [activeGalleryRows]);

  const selectedGalleryRows = useMemo(() => {
    if (!selectedGalleryKeys.length) return [];
    const selected = new Set(selectedGalleryKeys);
    return activeGalleryRows.filter((row) => selected.has(galleryKey(row)));
  }, [activeGalleryRows, selectedGalleryKeys]);

  const filteredGalleryRows = useMemo(() => {
    const query = gallerySearch.trim().toLowerCase();
    let rows = activeGalleryRows.filter((row) => !query || row.path.toLowerCase().includes(query));
    if (folderFilter !== 'all') {
      rows = rows.filter((row) => (row.path.includes('/') ? row.path.split('/').slice(0, -1).join('/') : 'root') === folderFilter);
    }
    if (heavyOnly) {
      const sorted = [...rows].sort((a, b) => b.size - a.size);
      rows = sorted.slice(0, Math.max(20, Math.ceil(sorted.length * 0.15)));
    }
    const withDate = (row: GalleryRow) => new Date(row.updatedAt || row.createdAt || 0).getTime() || 0;
    return [...rows].sort((a, b) => {
      if (gallerySort === 'size_desc') return b.size - a.size;
      if (gallerySort === 'size_asc') return a.size - b.size;
      if (gallerySort === 'date_desc') return withDate(b) - withDate(a);
      if (gallerySort === 'date_asc') return withDate(a) - withDate(b);
      const fa = a.path.split('/').slice(0, -1).join('/');
      const fb = b.path.split('/').slice(0, -1).join('/');
      return fa.localeCompare(fb) || b.size - a.size;
    });
  }, [gallerySearch, activeGalleryRows, folderFilter, heavyOnly, gallerySort]);

  const duplicateGroups = useMemo(() => {
    const by = new Map<string, GalleryRow[]>();
    activeGalleryRows.forEach((row) => {
      const name = row.path.split('/').pop() || row.path;
      const key = `${row.size}:${name.toLowerCase()}`;
      by.set(key, [...(by.get(key) || []), row]);
    });
    return Array.from(by.values()).filter((group) => group.length > 1).sort((a, b) => b[0].size - a[0].size);
  }, [activeGalleryRows]);

  const selectedGallerySet = useMemo(() => new Set(selectedGalleryKeys), [selectedGalleryKeys]);

  const toggleGalleryRow = (row: { bucket: string; path: string }) => {
    const key = galleryKey(row);
    setSelectedGalleryKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  };

  const clearGallerySelection = () => setSelectedGalleryKeys([]);

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_TASKS_KEY, JSON.stringify(galleryTasks));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить очередь галереи';
      window.dispatchEvent(new CustomEvent('app-toast', { detail: { tone: 'error', message } }));
    }
  }, [galleryTasks]);

  const enqueueGalleryTask = (type: GalleryTaskType, rows: GalleryRow[], label: string) => {
    if (!rows.length) return;
    const task: GalleryTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      type,
      urls: rows.map((row) => row.publicUrl),
      createdAt: Date.now(),
      progress: 0,
      total: rows.length,
      done: false,
      failed: 0
    };
    setGalleryTasks((prev) => [...prev, task]);
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { tone: 'success', message: `Фоновая задача добавлена: ${label}` } }));
  };

  useEffect(() => {
    const task = galleryTasks.find((item) => !item.done);
    if (!task) return;
    let cancelled = false;

    const run = async () => {
      let progress = task.progress;
      let failed = task.failed || 0;
      for (let index = task.progress; index < task.urls.length; index += 1) {
        if (cancelled) return;
        const url = task.urls[index];
        let ok = false;
        try {
          if (task.type === 'compress') ok = await recompressExistingStorageImage(url);
          else if (task.type === 'delete') ok = await deleteStorageImageByPublicUrl(url);
        } catch {
          ok = false;
        }
        progress += 1;
        if (!ok) failed += 1;
        setGalleryTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, progress, failed } : entry));
      }
      setGalleryTasks((prev) => prev.map((entry) => entry.id === task.id ? { ...entry, done: true, progress: entry.total, failed } : entry));
      await loadServerGallery();
    };

    void run();
    return () => { cancelled = true; };
  }, [galleryTasks]);

  const processGalleryRows = async (
    rows: Array<{ path: string; publicUrl: string }>,
    actionLabel: string,
    worker: (publicUrl: string) => Promise<boolean>
  ) => {
    const concurrency = 6;
    let cursor = 0;
    let completed = 0;
    let success = 0;
    let failures = 0;

    const runSingle = async (row: { path: string; publicUrl: string }) => {
      let ok = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          ok = await worker(row.publicUrl);
          if (ok) break;
        } catch {
          if (attempt >= 2) ok = false;
        }
      }
      completed += 1;
      if (ok) success += 1;
      else failures += 1;
      setDangerActionProgress({
        label: actionLabel,
        processed: completed,
        total: rows.length,
        details: row.path
      });
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) {
        const current = rows[cursor];
        cursor += 1;
        await runSingle(current);
      }
    }));

    return { success, failures };
  };

  const handleBulkCompressGallery = () => {
    if (!selectedGalleryRows.length) return;
    const confirmed = window.confirm(`Сжать выбранные фото (${selectedGalleryRows.length}) в фоне?`);
    if (!confirmed) return;
    enqueueGalleryTask('compress', selectedGalleryRows, `Сжать выбранные (${selectedGalleryRows.length})`);
    clearGallerySelection();
  };

  const handleBulkDeleteGallery = () => {
    if (!selectedGalleryRows.length) return;
    const confirmed = window.confirm(`Удалить выбранные фото (${selectedGalleryRows.length}) с сервера без корзины? Действие необратимо.`);
    if (!confirmed) return;
    enqueueGalleryTask('delete', selectedGalleryRows, `Удалить выбранные (${selectedGalleryRows.length})`);
    clearGallerySelection();
  };

  const openServerGalleryFullscreen = () => {
    if (!serverGalleryRows.length) {
      void loadServerGallery();
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }), 0);
    setIsGalleryFullscreen(true);
  };

  useEffect(() => () => {
    if (logoCrop?.previewUrl) URL.revokeObjectURL(logoCrop.previewUrl);
  }, [logoCrop?.previewUrl]);

  return (
    <div className="min-h-full max-w-full overflow-x-hidden bg-gray-50 px-4 pb-24 pt-2 space-y-3">
      <div>
        <div className="flex gap-2 overflow-x-auto pb-1 text-[11px] font-black text-slate-600 no-scrollbar">
          {['Public Quote', 'Компания: контакты', 'Система'].map((label) => (
            <span key={label} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5">{label}</span>
          ))}
        </div>
      </div>

      {logoCrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 space-y-3 shadow-xl">
            <p className="text-sm font-black text-gray-900">Обрезка логотипа (квадрат)</p>
            <div className="mx-auto h-52 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <img src={logoCrop.previewUrl} alt="Logo crop preview" className="h-full w-full object-cover" style={{ transform: `scale(${logoCropZoom})` }} />
            </div>
            <label className="text-xs font-semibold text-gray-600">Масштаб: {logoCropZoom.toFixed(2)}x</label>
            <input type="range" min={1} max={2.5} step={0.05} value={logoCropZoom} onChange={(event) => setLogoCropZoom(Number(event.target.value) || 1)} className="w-full" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={closeLogoCrop} className="rounded-xl border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">Отмена</button>
              <button type="button" onClick={saveLogoCrop} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white">Обрезать и загрузить</button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.045)]">
        <div className="divide-y divide-slate-100">
      <Section title="Public Quote / Invoice">
        <p className="text-xs text-gray-600">Отправьте эту ссылку клиенту — он заполняет форму, и новый лид появится в разделе «Заказы»:</p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicRequestFormUrl}
            className="flex-1 min-w-0 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-mono truncate"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(publicRequestFormUrl);
              window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Ссылка скопирована', tone: 'success' } }));
            }}
            className="shrink-0 rounded-xl bg-blue-600 text-white px-3 py-2 text-sm font-bold"
          >
            Копировать
          </button>
          <button
            type="button"
            onClick={() => {
              const opened = openExternalPage(publicRequestFormUrl);
              if (!opened) {
                window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Не удалось открыть форму. Проверьте блокировку всплывающих окон.', tone: 'error' } }));
              }
            }}
            className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-sm font-bold"
          >
            Открыть
          </button>
        </div>
      </Section>

      <Section title="Компания: контакты и документы">
        <div className="space-y-3">
          <CompactBlock title="Контакты для клиента" subtitle="WhatsApp / Telegram / Instagram">
            <Field label="WhatsApp номер для ссылки в заявке и смете">
              <input
                value={draftSettings.publicWhatsappNumber}
                onChange={(e) => updateDraft({ publicWhatsappNumber: e.target.value.replace(/[^\d]/g, '') })}
                placeholder="971521574546"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Telegram ссылка">
              <input
                value={draftSettings.publicTelegramUrl}
                onChange={(e) => updateDraft({ publicTelegramUrl: e.target.value.trim() })}
                placeholder="https://t.me/your_account"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Instagram ссылка">
              <input
                value={draftSettings.publicInstagramUrl}
                onChange={(e) => updateDraft({ publicInstagramUrl: e.target.value.trim() })}
                placeholder="https://instagram.com/your_account"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Сайт компании (для invoice)">
              <input
                value={draftSettings.publicWebsiteUrl}
                onChange={(e) => updateDraft({ publicWebsiteUrl: e.target.value.trim() })}
                placeholder="https://www.starkmotors.ae"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Публичная почта (для invoice)">
              <input
                type="email"
                value={draftSettings.publicEmail}
                onChange={(e) => updateDraft({ publicEmail: e.target.value.trim() })}
                placeholder="sales@starkmotors.ae"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>
          </CompactBlock>

          <CompactBlock title="Брендинг документов" subtitle="Логотип и подпись в публичной смете">
            <Field label="Логотип компании (для публичной сметы и формы заявки)">
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleBrandingFileChange(event, 'logo')}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                />
                {draftSettings.publicCompanyLogoUrl && (
                  <div className="space-y-2">
                    <img src={draftSettings.publicCompanyLogoUrl} alt="Company logo" className="h-16 w-auto rounded-lg border border-gray-200 bg-gray-50 p-1" />
                    <button type="button" onClick={() => updateDraft({ publicCompanyLogoUrl: '' })} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">Удалить логотип</button>
                  </div>
                )}
              </div>
            </Field>


            <Field label="Имя и фамилия менеджера / владельца (для публичной сметы и invoice)">
              <input
                value={draftSettings.publicManagerName}
                onChange={(e) => updateDraft({ publicManagerName: e.target.value })}
                placeholder="Например: Ahmed Al Mansoori"
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Подпись владельца (для invoice)">
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleBrandingFileChange(event, 'signature')}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                />
                {draftSettings.publicInvoiceSignatureUrl && (
                  <div className="space-y-2">
                    <img src={draftSettings.publicInvoiceSignatureUrl} alt="Owner signature" className="h-16 w-auto rounded-lg border border-gray-200 bg-gray-50 p-1" />
                    <button type="button" onClick={() => updateDraft({ publicInvoiceSignatureUrl: '' })} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">Удалить подпись</button>
                  </div>
                )}
              </div>
            </Field>
          </CompactBlock>

          <CompactBlock title="Условия работы" subtitle="Показываются клиенту в публичной смете">
            <Field label="Условия работы (для сметы клиенту)">
              <textarea
                value={draftSettings.publicWorkTerms}
                onChange={(e) => updateDraft({ publicWorkTerms: e.target.value })}
                placeholder="Например: Проверка наличия/цены перед оплатой, фото-отчёт перед отправкой."
                className="min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                rows={4}
              />
            </Field>
          </CompactBlock>
        </div>
      </Section>

      <Section title="Система">

        <div className="text-sm text-gray-700 space-y-1">
          <p>Режим: <b>LOCAL</b></p>
          <p>Server: {serverStatus === 'available' ? 'available' : 'unavailable'}</p>
          {!isCloudConfigured && <p className="text-rose-600">{cloudBuildGuardMessage}</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-2">
          <p className="font-black text-gray-900">Cloud env diagnostics</p>
          <p className={isCloudConfigured ? 'text-emerald-700' : 'text-amber-700'}>{cloudStatusSummary}</p>
          <ul className="space-y-1 break-all">
            <li><span className="font-bold text-gray-900">rawSupabaseUrl:</span> {cloudConfigDiagnostics.rawSupabaseUrl}</li>
            <li><span className="font-bold text-gray-900">isSupabaseUrlValid:</span> {String(cloudConfigDiagnostics.isSupabaseUrlValid)}</li>
            <li><span className="font-bold text-gray-900">rawSupabaseAnonKey:</span> {cloudConfigDiagnostics.rawSupabaseAnonKey}</li>
            <li><span className="font-bold text-gray-900">isSupabaseAnonKeyJwt:</span> {String(cloudConfigDiagnostics.isSupabaseAnonKeyJwt)}</li>
            <li><span className="font-bold text-gray-900">isSupabaseAnonKeyPublishable:</span> {String(cloudConfigDiagnostics.isSupabaseAnonKeyPublishable)}</li>
            <li><span className="font-bold text-gray-900">acceptedSupabaseAnonKeyFormat:</span> {cloudConfigDiagnostics.acceptedSupabaseAnonKeyFormat}</li>
            <li><span className="font-bold text-gray-900">isCloudConfigured:</span> {String(cloudConfigDiagnostics.isCloudConfigured)}</li>
            <li><span className="font-bold text-gray-900">buildTimeEnvSummary:</span> {cloudConfigDiagnostics.buildTimeEnvSummary}</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="w-full rounded-xl bg-blue-600 text-white px-3 py-2 font-black text-sm disabled:opacity-50"
            type="button"
            disabled={!!backupController || !isCloudConfigured}
            onClick={() => void withBusy('backup-upload', async () => {
              const controller = new AbortController();
              setBackupController(controller);
              setBackupProgress(15);
              try {
                const payload = buildCompactBackupPayload();
                const uploaded = await backupUpload(payload, { signal: controller.signal });
                if (!uploaded.ok) {
                  setServerStatus('unavailable');
                  throw new Error(uploaded.error);
                }
                setLastBackupId(uploaded.data.backupId);
                setServerStatus('available');
                setBackupProgress(100);
              } catch (error) {
                throw new Error(error instanceof Error ? error.message : 'Backup upload failed');
              } finally {
                window.setTimeout(() => setBackupProgress(0), 600);
                setBackupController(null);
              }
            })}
          >
            Создать резервную копию
          </button>

          {backupController && (
            <button className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold" type="button" onClick={() => backupController.abort('user-cancelled')}>
              Отменить бэкап
            </button>
          )}

          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${backupProgress}%` }} />
          </div>

          <div className="flex gap-2">
            <input
              value={lastBackupId}
              onChange={(e) => setLastBackupId(e.target.value.trim())}
              placeholder="Backup ID"
              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <button
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
              type="button"
              disabled={!lastBackupId || !!backupController}
              onClick={() => void withBusy('backup-restore', async () => {
                const controller = new AbortController();
                setBackupController(controller);
                try {
                  const backup = await backupUpload({}, { mode: 'restore', backupId: lastBackupId, signal: controller.signal, timeoutMs: 45000 });
                  if (!backup.ok || !backup.data.payload) throw new Error(backup.ok ? 'Backup payload missing' : backup.error);
                  await offlineDb.importAllData(backup.data.payload as Record<string, unknown[]>);
                  if ((backup.data.payload as any)?.orders) restoreData({ orders: (backup.data.payload as any).orders, suppliers: [] });
                  setServerStatus('available');
                } finally {
                  setBackupController(null);
                }
              })}
            >
              Восстановить по ID
            </button>
          </div>

          <button type="button" className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold" onClick={handleExportLocalBackup}>Экспорт локального бэкапа</button>

          <label className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-center text-sm font-bold cursor-pointer">Восстановить из файла
            <input type="file" accept="application/json" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void withBusy('import', async () => {
                const raw = await file.text();
                const parsed = JSON.parse(raw);
                await offlineDb.importAllData(parsed);
                if (parsed.orders) restoreData({ orders: parsed.orders, suppliers: [] });
              });
            }} />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void withBusy('cloud-test', async () => {
            const result = await testSupabaseConnection();
            if (!result.success) throw new Error('Supabase test connection failed');
          })}
          disabled={!isCloudConfigured || busy === 'cloud-test'}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
        >
          Проверить подключение
        </button>

        <button
          type="button"
          onClick={() => navigate('/debug')}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold"
        >
          Логи
        </button>
      </Section>

      <Section title="Публичные сметы">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50"
            onClick={() => void loadSnapshots()}
            disabled={snapshotsLoading}
          >
            {snapshotsLoading ? 'Обновляем…' : 'Обновить список'}
          </button>
          <span className="text-xs text-gray-500 self-center">Всего: {snapshotRows.length}</span>
        </div>
        {snapshotNotice && <p className="text-xs text-gray-600">{snapshotNotice}</p>}
        <div className="max-h-72 overflow-auto rounded-xl border border-gray-200 bg-gray-50">
          {snapshotRows.length === 0 ? (
            <p className="p-3 text-xs text-gray-500">Список пуст.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {snapshotRows.map((row) => {
                const identity = row.snapshot_id || row.id;
                return (
                  <li key={`${row.id}:${row.token}`} className="p-3 space-y-2">
                    <div className="text-[11px] text-gray-700 break-all">
                      <p><span className="font-bold text-gray-900">ID:</span> {identity}</p>
                      <p><span className="font-bold text-gray-900">Авто:</span> {resolveSnapshotCarTitle(row)}</p>
                      <p><span className="font-bold text-gray-900">Token:</span> {row.token}</p>
                      <p><span className="font-bold text-gray-900">Создан:</span> {formatDateTime(row.created_at)}</p>
                      <p><span className="font-bold text-gray-900">Истекает:</span> {formatDateTime(row.expires_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={buildSnapshotUrl(row)} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Открыть</a>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs font-bold text-blue-700"
                        onClick={() => handleSnapshotQuotePdf(row)}
                      >
                        <Download size={12} /> PDF смета
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                        onClick={() => handleSnapshotInvoicePdf(row)}
                      >
                        <FileText size={12} /> Скачать invoice
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 disabled:opacity-50"
                        onClick={() => row.order_id && navigate(`/order/${row.order_id}`)}
                        disabled={!row.order_id}
                      >
                        Открыть заказ этого снапшота
                      </button>
                      <button type="button" className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-bold" onClick={() => void copySnapshotUrl(row)}>Копировать ссылку</button>
                      <button
                        type="button"
                        className={`rounded-lg border px-2 py-1 text-xs font-bold ${lockedSnapshotIds.includes(String(row.snapshot_id || row.id || '').trim()) ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 bg-white text-gray-700'}`}
                        onClick={() => toggleSnapshotLock(row)}
                      >
                        {lockedSnapshotIds.includes(String(row.snapshot_id || row.id || '').trim()) ? '🔒 В замке' : '🔓 Без замка'}
                      </button>
                      <button type="button" className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-bold text-rose-700" onClick={() => void handleSnapshotDelete(row)}>Удалить</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Медиа и галерея сервера">
        <div className="rounded-3xl border border-gray-200 bg-gradient-to-b from-slate-50 to-white p-3 shadow-inner">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-700 disabled:opacity-50" onClick={openServerGalleryFullscreen} disabled={serverGalleryLoading}>{serverGalleryLoading ? 'Открываем…' : 'Открыть галерею сервера'}</button>
            <button type="button" className="rounded-2xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50" onClick={() => void loadServerGallery()} disabled={serverGalleryLoading}>{serverGalleryLoading ? 'Обновляем…' : 'Обновить список фото'}</button>
            <span className="text-xs text-gray-500">Всего: {activeGalleryRows.length}</span>
          </div>
        </div>
      </Section>
        </div>
      </div>

      {isGalleryFullscreen && (
        <div className="fixed inset-x-0 -top-24 bottom-0 z-[9999] bg-slate-100 pt-24 text-slate-950">
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-3 pb-3 pt-[calc(10px+env(safe-area-inset-top))] shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Медиа</p>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-lg font-black text-slate-950">Галерея сервера</h2>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{filteredGalleryRows.length}/{activeGalleryRows.length}</span>
                    {isGallerySelectionMode && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">выбрано {selectedGalleryRows.length}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-50" onClick={() => void loadServerGallery()} disabled={serverGalleryLoading || !!busy} aria-label="Обновить галерею">
                    <RefreshCw size={16} className={serverGalleryLoading ? 'animate-spin' : ''} />
                  </button>
                  <button type="button" className={`h-10 rounded-full border px-3 text-xs font-black shadow-sm ${isGallerySelectionMode ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`} onClick={() => {
                    const nextMode = !isGallerySelectionMode;
                    setIsGallerySelectionMode(nextMode);
                    if (!nextMode) clearGallerySelection();
                  }}>
                    {isGallerySelectionMode ? 'Готово' : 'Выбрать'}
                  </button>
                  <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-white shadow-sm" onClick={() => setIsGalleryFullscreen(false)} aria-label="Закрыть галерею">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-slate-700">
                  <Search size={16} className="shrink-0 text-slate-400" />
                  <input value={gallerySearch} onChange={(event) => setGallerySearch(event.target.value)} placeholder="Поиск по имени или папке" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-400" />
                </label>
                <button type="button" onClick={() => setHeavyOnly((current) => !current)} className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-xs font-black ${heavyOnly ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <SlidersHorizontal size={15} /> Тяжёлые
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <select value={gallerySort} onChange={(event) => setGallerySort(event.target.value as GallerySort)} className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none">
                  <option value="size_desc">Размер ↓</option><option value="size_asc">Размер ↑</option><option value="date_desc">Дата ↓</option><option value="date_asc">Дата ↑</option><option value="folder">Папка</option>
                </select>
                <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none">
                  {folderOptions.map((folder) => <option key={folder} value={folder}>{folder === 'all' ? 'Все папки' : folder}</option>)}
                </select>
              </div>

              <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                {isGallerySelectionMode ? (
                  <>
                    <button type="button" className="h-9 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50" disabled={filteredGalleryRows.length === 0 || !!busy} onClick={() => setSelectedGalleryKeys(filteredGalleryRows.map((row) => galleryKey(row)))}>Выбрать видимые</button>
                    <button type="button" className="h-9 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50" disabled={selectedGalleryKeys.length === 0 || !!busy} onClick={clearGallerySelection}>Снять</button>
                    <button type="button" className="h-9 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-700 disabled:opacity-50" disabled={selectedGalleryRows.length === 0 || !!busy} onClick={handleBulkCompressGallery}>Сжать {selectedGalleryRows.length}</button>
                    <button type="button" className="h-9 shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 disabled:opacity-50" disabled={selectedGalleryRows.length === 0 || !!busy} onClick={handleBulkDeleteGallery}>Удалить {selectedGalleryRows.length}</button>
                  </>
                ) : (
                  <>
                    <button className="h-9 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-700 disabled:opacity-50" type="button" disabled={!!busy} onClick={handleCompressAllServerPhotos}>{busy === 'storage-compress-all' ? 'Сжимаем...' : 'Сжать все фото'}</button>
                    <button className="h-9 shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 disabled:opacity-50" type="button" disabled={!!busy} onClick={handleRemovePhotoDuplicates}>{busy === 'storage-delete-duplicates' ? 'Проверяем...' : 'Удалить дубликаты'}</button>
                    {!!duplicateGroups.length && <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-orange-50 px-3 text-xs font-black text-orange-700">Дубликаты: {duplicateGroups.length}</span>}
                  </>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
              {!!galleryTasks.length && (
                <div className="mb-3 space-y-1 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm">
                  {galleryTasks.slice(-2).map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3">
                      <span className="truncate font-bold">{task.label}</span>
                      <span className="shrink-0 font-black text-slate-900">{task.progress}/{task.total}{task.failed ? ` · ошибок ${task.failed}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {!!duplicateGroups.length && (
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Найдено групп дубликатов: {duplicateGroups.length}. Можно очистить их одной кнопкой сверху.
                </div>
              )}
              {filteredGalleryRows.length === 0 ? (
                <div className="mt-10 rounded-3xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center shadow-sm">
                  <ImageIcon size={28} className="mx-auto text-slate-300" />
                  <p className="mt-3 text-sm font-black text-slate-900">Фото не найдены</p>
                  <p className="mt-1 text-xs text-slate-500">Попробуйте изменить поиск, папку или фильтр тяжёлых файлов.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {filteredGalleryRows.map((row, idx) => {
                    const key = galleryKey(row);
                    const isSelected = selectedGallerySet.has(key);
                    return (
                      <button key={key} type="button" className={`group overflow-hidden rounded-[18px] border bg-white text-left shadow-sm transition active:scale-[0.99] ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`} onClick={() => {
                        if (isGallerySelectionMode) {
                          toggleGalleryRow(row);
                          return;
                        }
                        setLightboxIndex(idx);
                      }}>
                        <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
                          <img src={row.publicUrl} alt={row.path} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
                          {(isGallerySelectionMode || isSelected) && (
                            <span className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border text-xs font-black shadow-sm ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-white bg-white/90 text-slate-400'}`}>
                              {isSelected ? <Check size={15} /> : ''}
                            </span>
                          )}
                          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[10px] font-black text-white backdrop-blur">{(row.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                        <div className="px-2.5 py-2">
                          <p className="truncate text-xs font-black text-slate-900">{row.path.split('/').pop() || row.path}</p>
                          <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">{formatDateTime(row.updatedAt || row.createdAt)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightboxIndex !== null && filteredGalleryRows[lightboxIndex] && (
        <div className="fixed inset-0 z-[140] bg-black/95" onClick={() => setLightboxIndex(null)}>
          <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 px-3 py-2 text-white" onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => prev === null ? null : Math.max(0, prev - 1)); }}>‹</button>
          <img src={filteredGalleryRows[lightboxIndex].publicUrl} alt={filteredGalleryRows[lightboxIndex].path} className="h-full w-full object-contain" />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 px-3 py-2 text-white" onClick={(e) => { e.stopPropagation(); setLightboxIndex((prev) => prev === null ? null : Math.min(filteredGalleryRows.length - 1, prev + 1)); }}>›</button>
        </div>
      )}


      <div className="overflow-hidden rounded-[28px] border border-rose-100 bg-white shadow-[0_10px_28px_rgba(190,18,60,0.055)]">
      <Section title="Опасная зона" tone="danger">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-800">
          Здесь только необратимые действия: очистка локальных данных, снапшотов и серверных бэкапов. Перед нажатием приложение попросит подтверждение.
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <button className="w-full rounded-xl border border-rose-300 bg-rose-600 text-white px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy || isHardResetting} onClick={() => void withBusy('hard-reset', clearAllLocalDataAndRestart)}>{busyLabel('hard-reset', 'Очистить кэш и все локальные данные', 'Очищаем и перезапускаем…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('public-snapshots', async () => {
            await handleClearSnapshotsExceptLocked();
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: 'Очистка снапшотов завершена (с учетом замков)', tone: 'success' } }));
          })}>{busyLabel('public-snapshots', 'Очистить снапшоты публичных смет на сервере', 'Очистка снапшотов…')}</button>
          <button className="w-full rounded-xl border border-rose-300 bg-white text-rose-700 px-3 py-2 font-black disabled:opacity-50" type="button" disabled={!!busy} onClick={() => void withBusy('server-backups', async () => {
            const first = window.confirm('⚠️ Это удалит ВСЕ backup записи на сервере. Продолжить?');
            if (!first) return;
            const second = window.prompt('Введите DELETE BACKUPS для подтверждения');
            if (second !== 'DELETE BACKUPS') return;
            const result = await clearServerBackups();
            const message = result.ok ? 'Все серверные backup записи удалены' : `Ошибка: ${result.error}`;
            const tone = result.ok ? 'success' : 'error';
            window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, tone } }));
          })}>{busyLabel('server-backups', 'Очистить все backup записи на сервере', 'Удаление backup…')}</button>
        </div>
        {dangerActionProgress && (
          <div className="rounded-xl border border-rose-200 bg-white p-2">
            <p className="text-[11px] font-bold text-rose-700">{dangerActionProgress.label}</p>
            <p className="text-[11px] text-rose-600">{dangerActionProgress.processed} / {dangerActionProgress.total}{dangerActionProgress.details ? ` · ${dangerActionProgress.details}` : ''}</p>
            <div className="mt-1 h-1.5 w-full rounded bg-rose-100 overflow-hidden">
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${dangerActionProgress.total > 0 ? Math.min(100, Math.round((dangerActionProgress.processed / dangerActionProgress.total) * 100)) : 0}%` }} />
            </div>
          </div>
        )}
      </Section>
      </div>

      <div className="sticky bottom-2 z-30 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={saveChanges}
          disabled={!hasUnsavedChanges}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Сохранить изменения
        </button>
        {saveNotice && <p className="mt-1 text-center text-[11px] font-semibold text-emerald-600">{saveNotice}</p>}
      </div>

      {busy && <div className="text-xs text-gray-500">Выполняется: {busy}…</div>}
      {isHardResetting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="rounded-2xl border border-white/20 bg-slate-900/95 px-5 py-4 text-center text-white shadow-2xl">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="mt-3 text-sm font-semibold">Очистка и перезапуск приложения…</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsScreen;

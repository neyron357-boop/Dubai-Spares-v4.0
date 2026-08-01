import type { Order } from '../types';
import type { AppSettings } from '../appSettings';
import type { NormalizedPublicQuoteSnapshot } from './publicQuoteSnapshot';
import type { NormalizedGroupItem } from './groupItems';
import { getPartDisplayName, normalizeGroupItems } from './groupItems';
import { getPricedPartLines } from './quotePricing';

const BLUE = '#1f3f5f';
const YELLOW = '#b88a1d';

export type InvoiceItem = {
  id: string;
  title: string;
  subtitle?: string;
  groupItems?: NormalizedGroupItem[];
  qty: number;
  unitPriceAed: number;
  totalAed: number;
};

export type InvoicePayload = {
  invoiceNumber: string;
  createdAt: Date;
  clientName: string;
  carTitle: string;
  vin: string;
  items: InvoiceItem[];
  subtotalAed: number;
  deliveryAed: number;
  packingAed: number;
  commissionAed: number;
  discountAed: number;
  taxAed: number;
  totalAed: number;
  depositAed: number;
  balanceDueAed: number;
  paymentTerms: string[];
  invoiceTo: string;
  company: {
    logoUrl: string;
    companyName: string;
    subtitle: string;
    phone: string;
    website: string;
    email: string;
    managerName: string;
    signatureUrl: string;
  };
  currencyCode?: string;
  language?: 'en' | 'ru';
};

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const money = (value: number, currencyCode = 'AED') => `${value.toFixed(2)} ${currencyCode}`;

const formatDate = (value: Date) => value.toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const formatPhone = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '+971 00 000 0000';
  if (digits.startsWith('971') && digits.length >= 11) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}${digits.slice(11) ? ` ${digits.slice(11)}` : ''}`.trim();
  }
  return `+${digits}`;
};

const formatWebsite = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'www.starkmotors.ae';
  return trimmed.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

const resolveTerms = (text: string) => {
  const fallback = [
    'Prices and availability are valid only after final manager confirmation.',
    'Delivery timeline, export documents, and handover details are confirmed separately.',
    'Returns are possible only upon prior agreement and inspection result.',
    'This invoice was generated electronically and is valid without a stamp unless otherwise requested.',
  ];
  const normalized = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
};

const createInvoiceNumber = (seed: string, date: Date) => {
  const compactSeed = seed.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() || 'SMUAE';
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return `SM-${ymd}-${compactSeed}`;
};

export const buildInvoicePayloadFromOrder = (order: Order, settings: AppSettings, options?: { currency?: string; rate?: number; language?: 'en' | 'ru' }): InvoicePayload => {
  const items = getPricedPartLines(order)
    .map((line, index) => {
      const { part } = line;
      const comment = String(part.comment || '').trim();
      return {
        id: String(part.id || index),
        title: getPartDisplayName(part, `Part ${index + 1}`),
        subtitle: comment || undefined,
        groupItems: line.part.partKind === 'group' ? normalizeGroupItems(line.part.groupItems) : [],
        qty: line.quantity,
        unitPriceAed: line.clientUnitAed,
        totalAed: line.clientLineTotalAed,
      };
    });

  const subtotalAed = items.reduce((sum, item) => sum + item.totalAed, 0);
  const discountAed = getPricedPartLines(order).reduce((sum, line) => sum + line.discountShareAed, 0);
  const deliveryAed = Number(order.logistics?.deliveryAed || 0);
  const packingAed = Number(order.logistics?.packingAed || 0);
  const commissionAed = Number(order.logistics?.serviceFeeAed || 0);
  const totalAed = subtotalAed + deliveryAed + packingAed + commissionAed;
  const depositAed = Math.max(0, Number((order as any).searchDepositAmountAed || 0));
  const balanceDueAed = Math.max(0, totalAed - depositAed);
  const createdAt = new Date();
  const carTitle = [order.brand, order.model, order.year].filter(Boolean).join(' ');

  const currencyCode = options?.currency || 'AED';
  const rate = Number(options?.rate || 1) > 0 ? Number(options?.rate) : 1;
  return {
    invoiceNumber: createInvoiceNumber(order.id || order.vin || carTitle, createdAt),
    createdAt,
    clientName: String(order.clientName || order.customerContact || order.socialNickname || 'Client / Company'),
    carTitle: carTitle || 'Vehicle request',
    vin: String(order.vin || '—'),
    items: items.map((item) => ({ ...item, unitPriceAed: item.unitPriceAed * rate, totalAed: item.totalAed * rate })),
    subtotalAed: subtotalAed * rate,
    deliveryAed: deliveryAed * rate,
    packingAed: packingAed * rate,
    commissionAed: commissionAed * rate,
    discountAed: discountAed * rate,
    taxAed: 0,
    totalAed: totalAed * rate,
    depositAed: depositAed * rate,
    balanceDueAed: balanceDueAed * rate,
    paymentTerms: resolveTerms(settings.publicWorkTerms),
    invoiceTo: String(order.clientName || order.customerContact || order.socialNickname || 'Client details to be confirmed'),
    currencyCode,
    language: options?.language || 'en',
    company: {
      logoUrl: settings.publicCompanyLogoUrl || '',
      companyName: 'STARK MOTORS',
      subtitle: 'UAE',
      phone: formatPhone(settings.publicWhatsappNumber),
      website: formatWebsite(settings.publicWebsiteUrl || settings.publicInstagramUrl || settings.publicTelegramUrl || ''),
      email: settings.publicEmail || 'sales@starkmotors.ae',
      managerName: settings.publicManagerName || 'Stark Motors',
      signatureUrl: settings.publicInvoiceSignatureUrl || '',
    },
  };
};

export const buildInvoicePayloadFromSnapshot = (snapshot: NormalizedPublicQuoteSnapshot, options?: { currency?: string; rate?: number; language?: 'en' | 'ru' }): InvoicePayload => {
  const createdAt = new Date(String(snapshot.raw.created_at || Date.now()));
  const items = snapshot.items.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: item.note || item.status || undefined,
    groupItems: item.groupItems || [],
    qty: item.qty,
    unitPriceAed: item.unitPriceAed,
    totalAed: item.totalAed,
  }));
  const currencyCode = options?.currency || snapshot.currency || 'AED';
  const rate = Number(options?.rate || 1) > 0 ? Number(options?.rate) : 1;
  return {
    invoiceNumber: createInvoiceNumber(String(snapshot.raw.order?.id || snapshot.order.vin || snapshot.order.brand), createdAt),
    createdAt,
    clientName: String(snapshot.raw.order?.clientName || snapshot.raw.order?.client_name || snapshot.raw.order?.customerContact || 'Client / Company'),
    carTitle: [snapshot.order.brand, snapshot.order.model, snapshot.order.year].filter(Boolean).join(' '),
    vin: snapshot.order.vin,
    items: items.map((item) => ({ ...item, unitPriceAed: item.unitPriceAed * rate, totalAed: item.totalAed * rate })),
    subtotalAed: snapshot.subtotalAed * rate,
    deliveryAed: snapshot.deliveryAed * rate,
    packingAed: snapshot.packingAed * rate,
    commissionAed: snapshot.commissionAed * rate,
    discountAed: snapshot.discountAed * rate,
    taxAed: 0,
    totalAed: snapshot.grandTotalAed * rate,
    depositAed: snapshot.depositAed * rate,
    balanceDueAed: snapshot.balanceDueAed * rate,
    paymentTerms: resolveTerms(snapshot.contact.workTerms),
    invoiceTo: String(snapshot.raw.order?.clientName || snapshot.raw.order?.client_name || snapshot.raw.order?.customerContact || 'Client details to be confirmed'),
    currencyCode,
    language: options?.language || 'en',
    company: {
      logoUrl: snapshot.contact.logoUrl,
      companyName: 'STARK MOTORS',
      subtitle: 'UAE',
      phone: formatPhone(snapshot.contact.whatsapp),
      website: formatWebsite(snapshot.contact.website || snapshot.contact.instagram || snapshot.contact.telegram || ''),
      email: snapshot.contact.email || 'sales@starkmotors.ae',
      managerName: snapshot.contact.managerName || 'Stark Motors',
      signatureUrl: snapshot.contact.signatureUrl,
    },
  };
};

export const buildInvoiceHtml = (payload: InvoicePayload) => {
  const rows = payload.items.slice(0, 10).map((item) => `
    <tr>
      <td>
        <div class="desc-main">${esc(item.title)}</div>
        ${item.groupItems?.length ? `<div class="group-list">${item.groupItems.map((groupItem) => `<div><span>${esc(groupItem.name)}</span><strong>×${esc(groupItem.quantity)}</strong></div>`).join('')}</div>` : ''}
        ${item.subtitle ? `<div class="desc-sub">${esc(item.subtitle)}</div>` : ''}
      </td>
      <td class="num">${esc(item.qty)}</td>
      <td class="num">${esc(money(item.unitPriceAed, payload.currencyCode))}</td>
      <td class="num total-cell">${esc(money(item.totalAed, payload.currencyCode))}</td>
    </tr>
  `).join('');

  const logoMarkup = payload.company.logoUrl
    ? `<img src="${esc(payload.company.logoUrl)}" alt="Stark Motors logo" class="logo-image" />`
    : `<div class="logo-mark"><span></span><span></span></div>`;

  const signatureMarkup = payload.company.signatureUrl
    ? `<img src="${esc(payload.company.signatureUrl)}" alt="Authorised sign" class="signature-image" />`
    : `<div class="signature-placeholder"></div>`;
  const totalsMarkup = [
    `<div class="total-line"><span>SUB TOTAL</span><strong>${esc(money(payload.subtotalAed, payload.currencyCode))}</strong></div>`,
    payload.deliveryAed > 0 ? `<div class="total-line"><span>DELIVERY</span><strong>${esc(money(payload.deliveryAed, payload.currencyCode))}</strong></div>` : '',
    payload.packingAed > 0 ? `<div class="total-line"><span>PACKING</span><strong>${esc(money(payload.packingAed, payload.currencyCode))}</strong></div>` : '',
    payload.commissionAed > 0 ? `<div class="total-line"><span>COMMISSION</span><strong>${esc(money(payload.commissionAed, payload.currencyCode))}</strong></div>` : '',
    payload.discountAed > 0 ? `<div class="total-line"><span>DISCOUNT INCLUDED</span><strong>-${esc(money(payload.discountAed, payload.currencyCode))}</strong></div>` : '',
    payload.taxAed > 0 ? `<div class="total-line"><span>TAX</span><strong>${esc(money(payload.taxAed, payload.currencyCode))}</strong></div>` : '',
    `<div class="total-line grand"><span>TOTAL</span><strong>${esc(money(payload.totalAed, payload.currencyCode))}</strong></div>`,
    payload.depositAed > 0 ? `<div class="total-line"><span>DEPOSIT</span><strong>-${esc(money(payload.depositAed, payload.currencyCode))}</strong></div><div class="total-line grand"><span>BALANCE DUE</span><strong>${esc(money(payload.balanceDueAed, payload.currencyCode))}</strong></div>` : ''
  ].filter(Boolean).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${esc(payload.invoiceNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; font-family: Inter, Arial, sans-serif; color: ${BLUE}; }
  body { background: #ffffff; }
  .sheet-wrap { display: flex; justify-content: center; }
  .sheet {
    width: 210mm;
    min-height: 297mm;
    background: #ffffff;
  }
  .content {
    padding: 11mm 12mm 10mm;
    display: flex;
    flex-direction: column;
    gap: 6mm;
  }
  .brand-row, .hero, .bottom-grid, .footer { display: flex; justify-content: space-between; gap: 7mm; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo-image { width: 34px; height: 34px; object-fit: contain; }
  .logo-mark { display:flex; gap:5px; align-items:flex-end; width:34px; height:34px; }
  .logo-mark span:first-child{ width:10px; height:30px; background:${YELLOW}; clip-path: polygon(35% 0,100% 0,65% 100%,0 100%); }
  .logo-mark span:last-child{ width:14px; height:35px; background:${BLUE}; clip-path: polygon(35% 0,100% 0,65% 100%,0 100%); }
  .brand-text { line-height: 0.94; }
  .brand-text .name { font-size: 15px; font-weight: 800; letter-spacing: 0.12em; color: ${YELLOW}; }
  .brand-text .sub { font-size: 14px; font-weight: 800; letter-spacing: 0.12em; }
  .hero { align-items: flex-start; }
  .invoice-title { font-size: 27px; line-height: 1; letter-spacing: 0.08em; font-weight: 800; margin: 0; color: #0f172a; }
  .doc-label { margin-top: 4px; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .meta { min-width: 76mm; }
  .meta-line { display:grid; grid-template-columns: 20mm 1fr; gap: 3mm; font-size: 10px; margin-bottom: 2px; }
  .meta-line strong { font-weight: 700; }
  .meta-line span, .meta-line strong { word-break: break-word; }
  table { width: 100%; border-collapse: collapse; font-size: 9.4px; table-layout: fixed; }
  thead th {
    background: #f1f5f9; color: #334155; text-align: left; font-size: 9.5px; padding: 7px 8px; font-weight: 800;
    border-bottom: 1px solid #cbd5e1;
  }
  tbody td {
    padding: 7px 8px;
    vertical-align: top;
    border-bottom: 1px solid #e2e8f0;
  }
  tbody tr:last-child td { border-bottom: 1px solid rgba(43, 100, 141, 0.25); }
  tbody td.num { text-align: right; white-space: nowrap; }
  tbody td.total-cell { font-weight: 700; }
  .desc-main { font-weight: 600; line-height: 1.2; }
  .desc-sub { font-size: 8px; margin-top: 1px; color: rgba(43, 100, 141, 0.76); line-height: 1.15; }
  .group-list { margin-top: 3px; display: grid; gap: 1px; font-size: 8px; color: rgba(43, 100, 141, 0.82); }
  .group-list div { display: flex; justify-content: space-between; gap: 6px; max-width: 100%; }
  .group-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-list strong { white-space: nowrap; color: #0f172a; }
  .bottom-grid { align-items: flex-start; }
  .section-title { color: #0f172a; font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 5px; }
  .info-block { width: 54%; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: #f8fafc; }
  .totals { width: 40%; margin-left: auto; }
  .info-line, .total-line { display:flex; justify-content:space-between; gap:8px; font-size: 10px; margin-bottom: 4px; }
  .info-line span:first-child, .total-line span:first-child { min-width: 24mm; }
  .total-line strong { font-size: 11px; }
  .total-line.grand { font-weight: 800; font-size: 12px; margin-top: 5px; padding: 7px 0 0; border-top: 1px solid #94a3b8; color: #0f172a; }
  .terms-signature { display: flex; justify-content: space-between; align-items: flex-end; gap: 7mm; }
  .terms { flex: 1; font-size: 9.4px; }
  .terms ul { margin: 0; padding-left: 14px; }
  .terms li { margin-bottom: 2px; line-height: 1.2; }
  .invoice-to { margin-top: 5px; font-size: 9.4px; }
  .invoice-to strong { display:block; margin-bottom: 2px; color: ${YELLOW}; font-size: 11px; }
  .sheet-note { font-size: 9px; opacity: 0.85; margin-top: 4px; }
  .signature-zone { width: 72mm; margin-left: auto; }
  .signature-image { max-width: 360px; max-height: 102px; object-fit: contain; display:block; margin: 0 0 4px auto; }
  .signature-placeholder { width: 360px; max-width: 100%; height: 66px; margin-left: auto; }
  .signature-line { border-bottom: 1.2px solid ${BLUE}; width: 100%; margin-bottom: 4px; }
  .signature-label { text-align: right; font-size: 9px; font-weight: 700; }
  .footer { align-items: flex-end; padding-top: 1.5mm; border-top: 1px solid rgba(43, 100, 141, 0.18); }
  .contacts { font-size: 9.4px; display:grid; gap: 2px; }
  .contact-line { display:flex; align-items:center; gap:6px; }
  .icon { width: 13px; text-align:center; }
  @media screen and (max-width: 900px) {
    .sheet { width: 100%; min-height: auto; }
    .content { padding: 8mm; gap: 6mm; }
    .brand-row, .hero, .bottom-grid, .terms-signature, .footer { flex-direction: column; gap: 5mm; }
    .meta, .info-block, .totals, .signature-zone { width: 100%; min-width: 0; }
    .signature-image, .signature-placeholder { margin-left: 0; }
    .signature-label { text-align: left; }
  }
  @media print {
    html, body { background: white; }
    body { padding: 0; }
    .sheet { width: 210mm; min-height: 297mm; }
  }
</style>
</head>
<body>
  <div class="sheet-wrap">
    <div class="sheet">
      <div class="content">
        <div class="brand-row">
          <div class="brand">
            ${logoMarkup}
            <div class="brand-text">
              <div class="name">${esc(payload.company.companyName)}</div>
              <div class="sub">${esc(payload.company.subtitle)}</div>
            </div>
          </div>
        </div>

        <div class="hero">
          <div>
            <h1 class="invoice-title">COMMERCIAL INVOICE</h1>
            <div class="doc-label">Official estimate for auto parts supply</div>
          </div>
          <div class="meta">
            <div class="meta-line"><span>Invoice:</span><strong>${esc(payload.invoiceNumber)}</strong></div>
            <div class="meta-line"><span>Date:</span><strong>${esc(formatDate(payload.createdAt))}</strong></div>
            <div class="meta-line"><span>Car:</span><strong>${esc(payload.carTitle || 'Vehicle request')}</strong></div>
            <div class="meta-line"><span>VIN:</span><strong>${esc(payload.vin || '—')}</strong></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:48%">DESCRIPTION</th>
              <th style="width:12%">QTY.</th>
              <th style="width:20%">PRICE</th>
              <th style="width:20%">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td><div class="desc-main">Quote positions will appear here</div></td><td class="num">0</td><td class="num">0.00 AED</td><td class="num total-cell">0.00 AED</td></tr>`}
          </tbody>
        </table>

        <div class="bottom-grid">
          <div class="info-block">
            <h3 class="section-title">Bill to</h3>
            <div class="info-line"><span>Client</span><strong>${esc(payload.invoiceTo || payload.clientName || 'Client details to be confirmed')}</strong></div>
            <div class="info-line"><span>Vehicle</span><strong>${esc(payload.carTitle || 'Vehicle request')}</strong></div>
            <div class="info-line"><span>VIN</span><strong>${esc(payload.vin || '—')}</strong></div>
            <div class="info-line"><span>Prepared by</span><strong>${esc(payload.company.managerName)}</strong></div>
          </div>
          <div class="totals">
            ${totalsMarkup}
          </div>
        </div>

        <div class="terms-signature">
          <div class="terms">
            <h3 class="section-title">Terms and conditions</h3>
            <ul>${payload.paymentTerms.map((term) => `<li>${esc(term)}</li>`).join('')}</ul>
            <div class="sheet-note">Prepared by ${esc(payload.company.managerName)}.</div>
          </div>

          <div class="signature-zone">
            ${signatureMarkup}
            <div class="signature-line"></div>
            <div class="signature-label">AUTHORISED SIGN</div>
          </div>
        </div>

        <div class="footer">
          <div class="contacts">
            <div class="contact-line"><span class="icon">🌐</span><span>${esc(payload.company.website)}</span></div>
            <div class="contact-line"><span class="icon">☎</span><span>${esc(payload.company.phone)}</span></div>
            <div class="contact-line"><span class="icon">✉</span><span>${esc(payload.company.email)}</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });
  </script>
</body>
</html>`;
};

export const openInvoicePrintWindow = (payload: InvoicePayload) => {
  const html = buildInvoiceHtml(payload);
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

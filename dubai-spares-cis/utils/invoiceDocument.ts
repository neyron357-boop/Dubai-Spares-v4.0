import type { Order } from '../types';
import type { AppSettings } from '../appSettings';
import type { NormalizedPublicQuoteSnapshot } from './publicQuoteSnapshot';
import { normalizePartQuantity } from './groupItems';

const BLUE = '#2b648d';
const YELLOW = '#e6b400';

export type InvoiceItem = {
  id: string;
  title: string;
  subtitle?: string;
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
  taxAed: number;
  totalAed: number;
  paymentInfo: {
    accountNo: string;
    name: string;
    bankAccount: string;
  };
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

const resolvePaymentInfo = (settings: AppSettings) => ({
  accountNo: settings.invoicePaymentAccountNo || settings.publicWhatsappNumber || '971521574546',
  name: settings.invoicePaymentBeneficiary || settings.publicManagerName || 'Stark Motors',
  bankAccount: settings.invoicePaymentBankAccount || (settings.publicManagerName ? `${settings.publicManagerName} Trading Account` : 'Stark Motors Trading Account'),
});

const resolveTerms = (text: string) => {
  const fallback = [
    '100% advance payment before dispatch.',
    'Part availability and lead time must be reconfirmed before payment.',
    'Returns are only possible upon prior agreement and inspection result.',
    'Logistics, export documents, and delivery timing are finalized with your manager.',
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
  const foundParts = order.parts.filter((part) => part.isFound && part.variants.length > 0);
  const isFixedMarkup = (order.markupType || 'percent') === 'fixed';
  const fixedMarkupPerPart = isFixedMarkup && foundParts.length > 0
    ? Number(order.markupFixedAed || 0) / foundParts.length
    : 0;

  const items = foundParts
    .map((part, index) => {
      const qty = normalizePartQuantity((part as any).quantity);
      const variant = part.variants[0];
      const basePriceAed = Number(variant?.salePriceAed ?? variant?.priceAed ?? 0);
      const unitPriceAed = isFixedMarkup
        ? basePriceAed + fixedMarkupPerPart
        : basePriceAed * (1 + Number(order.markupPercent || 0) / 100);
      const comment = String(part.comment || '').trim();
      return {
        id: String(part.id || index),
        title: String(part.name || `Part ${index + 1}`),
        subtitle: comment || undefined,
        qty,
        unitPriceAed,
        totalAed: unitPriceAed * qty,
      };
    });

  const subtotalAed = items.reduce((sum, item) => sum + item.totalAed, 0);
  const deliveryAed = Number(order.logistics?.deliveryAed || 0);
  const packingAed = Number(order.logistics?.packingAed || 0);
  const commissionAed = Number(order.logistics?.serviceFeeAed || 0);
  const totalAed = subtotalAed + deliveryAed + packingAed + commissionAed;
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
    taxAed: 0,
    totalAed: totalAed * rate,
    paymentInfo: resolvePaymentInfo(settings),
    paymentTerms: resolveTerms(settings.publicWorkTerms),
    invoiceTo: String(order.clientName || order.customerContact || order.socialNickname || 'Client details to be confirmed'),
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
    currencyCode,
    language: options?.language || 'en',
  };
};

export const buildInvoicePayloadFromSnapshot = (snapshot: NormalizedPublicQuoteSnapshot): InvoicePayload => {
  const createdAt = new Date(String(snapshot.raw.created_at || Date.now()));
  const items = snapshot.items.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: item.note || item.status || undefined,
    qty: item.qty,
    unitPriceAed: item.unitPriceAed,
    totalAed: item.totalAed,
  }));
  return {
    invoiceNumber: createInvoiceNumber(String(snapshot.raw.order?.id || snapshot.order.vin || snapshot.order.brand), createdAt),
    createdAt,
    clientName: String(snapshot.raw.order?.clientName || snapshot.raw.order?.client_name || snapshot.raw.order?.customerContact || 'Client / Company'),
    carTitle: [snapshot.order.brand, snapshot.order.model, snapshot.order.year].filter(Boolean).join(' '),
    vin: snapshot.order.vin,
    items,
    subtotalAed: snapshot.subtotalAed,
    deliveryAed: snapshot.deliveryAed,
    packingAed: snapshot.packingAed,
    commissionAed: snapshot.commissionAed,
    taxAed: 0,
    totalAed: snapshot.grandTotalAed,
    paymentInfo: {
      accountNo: String(snapshot.raw.public_settings?.invoicePaymentAccountNo || snapshot.contact.whatsapp || '971521574546'),
      name: String(snapshot.raw.public_settings?.invoicePaymentBeneficiary || snapshot.contact.managerName || 'Stark Motors'),
      bankAccount: String(snapshot.raw.public_settings?.invoicePaymentBankAccount || `${snapshot.contact.managerName || 'Stark Motors'} Trading Account`),
    },
    paymentTerms: resolveTerms(snapshot.contact.workTerms),
    invoiceTo: String(snapshot.raw.order?.clientName || snapshot.raw.order?.client_name || snapshot.raw.order?.customerContact || 'Client details to be confirmed'),
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

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${esc(payload.invoiceNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; font-family: Montserrat, Poppins, Arial, sans-serif; color: ${BLUE}; }
  body { background: #ffffff; }
  .sheet-wrap { display: flex; justify-content: center; }
  .sheet {
    width: 210mm;
    min-height: 297mm;
    background: #ffffff;
  }
  .content {
    padding: 9mm 10mm 8mm;
    display: flex;
    flex-direction: column;
    gap: 5mm;
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
  .invoice-title { font-size: 25px; line-height: 1; letter-spacing: 0.05em; font-weight: 800; margin: 0; }
  .meta { min-width: 76mm; }
  .meta-line { display:grid; grid-template-columns: 20mm 1fr; gap: 3mm; font-size: 10px; margin-bottom: 2px; }
  .meta-line strong { font-weight: 700; }
  .meta-line span, .meta-line strong { word-break: break-word; }
  table { width: 100%; border-collapse: collapse; font-size: 9.4px; table-layout: fixed; }
  thead th {
    background: ${YELLOW}; color: ${BLUE}; text-align: left; font-size: 10px; padding: 5px 6px; font-weight: 800;
    border-bottom: 1px solid rgba(43, 100, 141, 0.25);
  }
  tbody td {
    padding: 4px 6px;
    vertical-align: top;
    border-bottom: 1px solid rgba(43, 100, 141, 0.16);
  }
  tbody tr:last-child td { border-bottom: 1px solid rgba(43, 100, 141, 0.25); }
  tbody td.num { text-align: right; white-space: nowrap; }
  tbody td.total-cell { font-weight: 700; }
  .desc-main { font-weight: 600; line-height: 1.2; }
  .desc-sub { font-size: 8px; margin-top: 1px; color: rgba(43, 100, 141, 0.76); line-height: 1.15; }
  .bottom-grid { align-items: flex-start; }
  .section-title { color: ${YELLOW}; font-size: 12px; font-weight: 800; margin: 0 0 4px; }
  .info-block { width: 54%; }
  .totals { width: 40%; margin-left: auto; }
  .info-line, .total-line { display:flex; justify-content:space-between; gap:8px; font-size: 10px; margin-bottom: 3px; }
  .info-line span:first-child, .total-line span:first-child { min-width: 24mm; }
  .total-line strong { font-size: 11px; }
  .total-line.grand { font-weight: 800; font-size: 12px; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(43, 100, 141, 0.22); }
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
            <h1 class="invoice-title">INVOICE</h1>
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
            <h3 class="section-title">Payment Info:</h3>
            <div class="info-line"><span>Account No</span><strong>${esc(payload.paymentInfo.accountNo)}</strong></div>
            <div class="info-line"><span>Name</span><strong>${esc(payload.paymentInfo.name)}</strong></div>
            <div class="info-line"><span>Bank Account</span><strong>${esc(payload.paymentInfo.bankAccount)}</strong></div>
          </div>
          <div class="totals">
            <div class="total-line"><span>SUB TOTAL</span><strong>${esc(money(payload.subtotalAed, payload.currencyCode))}</strong></div>
            <div class="total-line"><span>DELIVERY</span><strong>${esc(money(payload.deliveryAed, payload.currencyCode))}</strong></div>
            <div class="total-line"><span>PACKING</span><strong>${esc(money(payload.packingAed, payload.currencyCode))}</strong></div>
            <div class="total-line"><span>COMMISSION</span><strong>${esc(money(payload.commissionAed, payload.currencyCode))}</strong></div>
            <div class="total-line"><span>TAX</span><strong>${esc(money(payload.taxAed, payload.currencyCode))}</strong></div>
            <div class="total-line grand"><span>TOTAL</span><strong>${esc(money(payload.totalAed, payload.currencyCode))}</strong></div>
          </div>
        </div>

        <div class="terms-signature">
          <div class="terms">
            <h3 class="section-title">Payment terms</h3>
            <ul>${payload.paymentTerms.map((term) => `<li>${esc(term)}</li>`).join('')}</ul>
            <div class="invoice-to">
              <strong>Invoice to</strong>
              <div>${esc(payload.invoiceTo || payload.clientName || 'Client details to be confirmed')}</div>
            </div>
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

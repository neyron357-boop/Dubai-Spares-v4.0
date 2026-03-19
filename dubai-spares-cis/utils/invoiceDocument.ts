import type { Order } from '../types';
import type { AppSettings } from '../appSettings';
import type { NormalizedPublicQuoteSnapshot } from './publicQuoteSnapshot';
import { normalizePartQuantity } from './groupItems';

const BLUE = '#2b648d';
const YELLOW = '#e6b400';
const LIGHT_GRID = '#edf1f5';
const LIGHT_RING = 'rgba(43, 100, 141, 0.14)';
const SHEET_RATIO = 613 / 860;

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
};

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const money = (value: number) => `${value.toFixed(2)} AED`;

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
  if (!trimmed) return 'www.dubaispares.ae';
  return trimmed.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

const resolvePaymentInfo = (settings: AppSettings) => ({
  accountNo: settings.publicWhatsappNumber || '971521574546',
  name: settings.publicManagerName || 'Dubai Spares UAE',
  bankAccount: settings.publicManagerName ? `${settings.publicManagerName} Trading Account` : 'Dubai Spares UAE Trading Account',
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
  const compactSeed = seed.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() || 'DSUAE';
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return `DS-${ymd}-${compactSeed}`;
};

export const buildInvoicePayloadFromOrder = (order: Order, settings: AppSettings): InvoicePayload => {
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
  const totalAed = subtotalAed + Number(order.logistics?.deliveryAed || 0) + Number(order.logistics?.packingAed || 0) + Number(order.logistics?.serviceFeeAed || 0);
  const createdAt = new Date();
  const carTitle = [order.brand, order.model, order.year].filter(Boolean).join(' ');

  return {
    invoiceNumber: createInvoiceNumber(order.id || order.vin || carTitle, createdAt),
    createdAt,
    clientName: String(order.clientName || order.customerContact || order.socialNickname || 'Client / Company'),
    carTitle: carTitle || 'Vehicle request',
    vin: String(order.vin || '—'),
    items,
    subtotalAed,
    taxAed: 0,
    totalAed,
    paymentInfo: resolvePaymentInfo(settings),
    paymentTerms: resolveTerms(settings.publicWorkTerms),
    invoiceTo: String(order.clientName || order.customerContact || order.socialNickname || 'Client details to be confirmed'),
    company: {
      logoUrl: settings.publicCompanyLogoUrl || '',
      companyName: 'DUBAI SPARES',
      subtitle: 'UAE',
      phone: formatPhone(settings.publicWhatsappNumber),
      website: formatWebsite(settings.publicInstagramUrl || settings.publicTelegramUrl || ''),
      email: 'sales@dubaispares.ae',
      managerName: settings.publicManagerName || 'Dubai Spares UAE',
      signatureUrl: settings.publicInvoiceSignatureUrl || '',
    },
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
    taxAed: 0,
    totalAed: snapshot.grandTotalAed,
    paymentInfo: {
      accountNo: snapshot.contact.whatsapp || '971521574546',
      name: snapshot.contact.managerName || 'Dubai Spares UAE',
      bankAccount: `${snapshot.contact.managerName || 'Dubai Spares UAE'} Trading Account`,
    },
    paymentTerms: resolveTerms(snapshot.contact.workTerms),
    invoiceTo: String(snapshot.raw.order?.clientName || snapshot.raw.order?.client_name || snapshot.raw.order?.customerContact || 'Client details to be confirmed'),
    company: {
      logoUrl: snapshot.contact.logoUrl,
      companyName: 'DUBAI SPARES',
      subtitle: 'UAE',
      phone: formatPhone(snapshot.contact.whatsapp),
      website: formatWebsite(snapshot.contact.instagram || snapshot.contact.telegram || ''),
      email: 'sales@dubaispares.ae',
      managerName: snapshot.contact.managerName || 'Dubai Spares UAE',
      signatureUrl: snapshot.contact.signatureUrl,
    },
  };
};

export const buildInvoiceHtml = (payload: InvoicePayload) => {
  const rows = payload.items.slice(0, 8).map((item) => `
    <tr>
      <td>
        <div class="desc-main">${esc(item.title)}</div>
        ${item.subtitle ? `<div class="desc-sub">${esc(item.subtitle)}</div>` : ''}
      </td>
      <td class="num">${esc(item.qty)}</td>
      <td class="num">${esc(money(item.unitPriceAed))}</td>
      <td class="num total-cell">${esc(money(item.totalAed))}</td>
    </tr>
  `).join('');

  const logoMarkup = payload.company.logoUrl
    ? `<img src="${esc(payload.company.logoUrl)}" alt="Dubai Spares logo" class="logo-image" />`
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
  html, body { margin: 0; padding: 0; background: #c9c9c9; font-family: Montserrat, Poppins, Arial, sans-serif; color: ${BLUE}; }
  body { padding: 24px; }
  .sheet-wrap { display: flex; justify-content: center; }
  .sheet {
    position: relative; width: min(210mm, calc((100vh - 48px) * ${SHEET_RATIO})); min-height: 297mm; background: #fcfcfb;
    border: 16px solid ${BLUE}; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18); overflow: hidden;
  }
  .sheet::before {
    content: ''; position: absolute; inset: 12px; border: 1.5px solid ${BLUE}; pointer-events: none;
  }
  .sheet::after {
    content: ''; position: absolute; inset: 0;
    background-image:
      linear-gradient(${LIGHT_GRID} 1px, transparent 1px),
      linear-gradient(90deg, ${LIGHT_GRID} 1px, transparent 1px),
      linear-gradient(rgba(43,100,141,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(43,100,141,0.04) 1px, transparent 1px);
    background-size: 48px 48px, 48px 48px, 12px 12px, 12px 12px;
    pointer-events: none;
  }
  .content { position: relative; z-index: 1; padding: 44px 54px 38px; }
  .brand-row, .meta-row, .bottom-grid, .footer { display: flex; justify-content: space-between; gap: 24px; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .logo-image { width: 64px; height: 64px; object-fit: contain; }
  .logo-mark { display:flex; gap:8px; align-items:flex-end; width:64px; height:64px; }
  .logo-mark span:first-child{ width:16px; height:48px; background:${YELLOW}; clip-path: polygon(35% 0,100% 0,65% 100%,0 100%); }
  .logo-mark span:last-child{ width:20px; height:56px; background:${BLUE}; clip-path: polygon(35% 0,100% 0,65% 100%,0 100%); }
  .brand-text { line-height: 0.92; }
  .brand-text .name { font-size: 26px; font-weight: 800; letter-spacing: 0.16em; color: ${YELLOW}; }
  .brand-text .sub { font-size: 24px; font-weight: 800; letter-spacing: 0.16em; }
  .dots, .dots-bottom { display:grid; grid-template-columns: repeat(9, 8px); gap: 8px; }
  .dots span, .dots-bottom span { width: 4px; height: 4px; border-radius: 999px; background: ${BLUE}; display:block; }
  .hero { margin-top: 34px; display:flex; justify-content: space-between; align-items:flex-start; gap: 24px; }
  .invoice-title { font-size: 62px; line-height: 0.95; letter-spacing: 0.05em; font-weight: 800; margin: 0; }
  .meta { min-width: 255px; padding-top: 22px; }
  .meta-line { display:grid; grid-template-columns: 92px 1fr; gap: 14px; font-size: 16px; margin-bottom: 10px; }
  .meta-line strong { font-weight: 700; }
  .arrow-left, .arrow-right { color: ${BLUE}; font-size: 54px; line-height: 1; font-weight: 300; letter-spacing: -10px; }
  .arrow-left { margin: 28px 0 18px; }
  table { width: 100%; border-collapse: separate; border-spacing: 0 12px; font-size: 15px; }
  thead th { background: ${YELLOW}; color: ${BLUE}; text-align: left; font-size: 18px; padding: 12px 18px; font-weight: 800; }
  tbody td { border: 1.5px solid ${BLUE}; padding: 13px 18px; vertical-align: top; background: rgba(255,255,255,0.92); }
  tbody td + td { border-left: none; }
  tbody td.num { text-align: right; white-space: nowrap; width: 16%; }
  tbody td.total-cell { font-weight: 700; }
  .desc-main { font-weight: 600; }
  .desc-sub { font-size: 11px; margin-top: 4px; color: rgba(43, 100, 141, 0.76); }
  .bottom-grid { margin-top: 18px; align-items: flex-start; }
  .section-title { color: ${YELLOW}; font-size: 19px; font-weight: 800; margin: 0 0 12px; }
  .info-block { width: 52%; }
  .totals { width: 34%; margin-left: auto; }
  .info-line, .total-line { display:flex; justify-content:space-between; gap:16px; font-size: 16px; margin-bottom: 8px; }
  .info-line span:first-child, .total-line span:first-child { min-width: 120px; }
  .total-line strong { font-size: 17px; }
  .total-line.grand { font-weight: 800; font-size: 18px; margin-top: 8px; }
  .terms { margin-top: 18px; max-width: 56%; }
  .terms ul { margin: 0; padding-left: 18px; }
  .terms li { margin-bottom: 6px; font-size: 14px; }
  .invoice-to { margin-top: 18px; font-size: 14px; }
  .invoice-to strong { display:block; margin-bottom: 6px; color: ${YELLOW}; font-size: 18px; }
  .signature-zone { margin-top: 26px; max-width: 260px; }
  .signature-image { max-width: 180px; max-height: 56px; object-fit: contain; display:block; margin-bottom: 8px; }
  .signature-placeholder { width: 180px; height: 38px; }
  .signature-line { border-bottom: 2px solid ${BLUE}; width: 180px; margin-bottom: 8px; }
  .footer { align-items: flex-end; margin-top: 28px; }
  .contacts { font-size: 15px; display:grid; gap: 10px; }
  .contact-line { display:flex; align-items:center; gap:10px; }
  .icon { width: 24px; text-align:center; }
  .ring-top, .ring-bottom {
    position:absolute; border:1.4px solid ${LIGHT_RING}; border-radius:999px; pointer-events:none;
  }
  .ring-top { width: 208px; height: 208px; top: 18px; right: 48px; }
  .ring-top::before, .ring-bottom::before { content:''; position:absolute; inset: 18px; border:1.2px solid ${LIGHT_RING}; border-radius:999px; }
  .ring-bottom { width: 260px; height: 260px; right: 40px; bottom: 22px; }
  .ring-bottom::after { content:''; position:absolute; left:50%; top:50%; width:1px; height:100%; background:${LIGHT_RING}; transform:translate(-50%,-50%) rotate(42deg); transform-origin:center; box-shadow: 0 0 0 0 ${LIGHT_RING}, 0 0 0 0 ${LIGHT_RING}; }
  .dots-top { position:absolute; top: 118px; left: 52%; }
  .dots-bottom-wrap { position:absolute; right: 122px; bottom: 188px; }
  .arrow-right { position:absolute; right: 54px; bottom: 92px; }
  .sheet-note { font-size: 12px; opacity: 0.85; margin-top: 6px; }
  @media print {
    body { padding: 0; background: white; }
    .sheet { width: 210mm; min-height: 297mm; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="sheet-wrap">
    <div class="sheet">
      <div class="ring-top"></div>
      <div class="ring-bottom"></div>
      <div class="dots-top dots">${'<span></span>'.repeat(18)}</div>
      <div class="dots-bottom-wrap dots-bottom">${'<span></span>'.repeat(18)}</div>
      <div class="arrow-right">≫≫≫</div>
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

        <div class="arrow-left">≫≫≫</div>

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
            <div class="total-line"><span>SUB TOTAL</span><strong>${esc(money(payload.subtotalAed))}</strong></div>
            <div class="total-line"><span>TAX</span><strong>${esc(money(payload.taxAed))}</strong></div>
            <div class="total-line grand"><span>TOTAL</span><strong>${esc(money(payload.totalAed))}</strong></div>
          </div>
        </div>

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
          <div>AUTHORISED SIGN</div>
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

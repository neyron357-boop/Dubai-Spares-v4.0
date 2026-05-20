import type { Order, Part, PriceVariant } from '../types';

export type SafetyStageId =
  | 'inquiry'
  | 'data_collection'
  | 'preliminary_estimate'
  | 'deposit_gate'
  | 'active_search'
  | 'final_quote'
  | 'full_prepayment'
  | 'purchase'
  | 'inspection'
  | 'packing'
  | 'cargo_handover'
  | 'completed';

export type SafetyStageState = 'completed' | 'current' | 'locked' | 'upcoming';
export type LeadQualityLevel = 'cold' | 'warm' | 'hot' | 'paid' | 'risky';
export type DealRiskLevel = 'safe' | 'caution' | 'high' | 'refuse';
export type ProfitProtectionLevel = 'unknown' | 'healthy' | 'thin' | 'loss';
export type FollowUpStatus = 'none' | 'no_reply_3h' | 'no_reply_24h' | 'no_reply_3d' | 'inactive';

export type SafetyStage = {
  id: SafetyStageId;
  label: string;
  helper: string;
  state: SafetyStageState;
};

export type ScoreFactor = {
  label: string;
  points: number;
  tone: 'positive' | 'negative' | 'neutral';
};

export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  critical?: boolean;
  helper?: string;
};

export type LeadQualitySummary = {
  level: LeadQualityLevel;
  label: string;
  score: number;
  factors: ScoreFactor[];
};

export type DealRiskSummary = {
  level: DealRiskLevel;
  label: string;
  score: number;
  factors: ScoreFactor[];
  blockers: string[];
  recommendation: string;
};

export type CargoRiskSummary = {
  active: boolean;
  label: string;
  fragileParts: string[];
  expensiveParts: string[];
  warnings: string[];
  clientWarning: string;
};

export type ProofPackSummary = {
  total: number;
  completed: number;
  items: ChecklistItem[];
};

export type ReadinessSummary = {
  total: number;
  completed: number;
  percent: number;
  blockers: string[];
  items: ChecklistItem[];
};

export type ProfitProtectionSummary = {
  level: ProfitProtectionLevel;
  label: string;
  purchaseTotalAed: number;
  saleSubtotalAed: number;
  markupAed: number;
  logisticsAed: number;
  cargoAed: number;
  expectedRevenueAed: number;
  netProfitAed: number | null;
  minProfitAed: number;
  message: string;
};

export type NoReplyFollowUpSummary = {
  status: FollowUpStatus;
  label: string;
  hoursSinceUpdate: number;
  message: string;
};

export type SafetySalesSummary = {
  currentStage: SafetyStageId;
  stages: SafetyStage[];
  leadQuality: LeadQualitySummary;
  dealRisk: DealRiskSummary;
  cargoRisk: CargoRiskSummary;
  proofPack: ProofPackSummary;
  readiness: ReadinessSummary;
  profit: ProfitProtectionSummary;
  followUp: NoReplyFollowUpSummary;
  supplierBroadcast: string;
  paymentExplanation: string;
  refusalMessage: string;
};

const SAFETY_STAGES: Array<Omit<SafetyStage, 'state'>> = [
  { id: 'inquiry', label: 'Заявка', helper: 'Клиент оставил запрос.' },
  { id: 'data_collection', label: 'Данные', helper: 'VIN, фото авто, деталь, город доставки.' },
  { id: 'preliminary_estimate', label: 'Оценка', helper: 'Только примерная вилка, без глубокого поиска.' },
  { id: 'deposit_gate', label: 'Депозит', helper: 'Активный поиск начинается после оплаты депозита.' },
  { id: 'active_search', label: 'Поиск', helper: 'Поставщики, рынок, варианты.' },
  { id: 'final_quote', label: 'Смета', helper: 'Финальное предложение с условиями.' },
  { id: 'full_prepayment', label: 'Предоплата', helper: 'Полная оплата до закупки.' },
  { id: 'purchase', label: 'Закупка', helper: 'Покупка под конкретного клиента.' },
  { id: 'inspection', label: 'Проверка', helper: 'Фото, видео, дефекты, маркировки.' },
  { id: 'packing', label: 'Упаковка', helper: 'Усиленная упаковка для риска cargo.' },
  { id: 'cargo_handover', label: 'Cargo', helper: 'Передача перевозчику и receipt.' },
  { id: 'completed', label: 'Завершено', helper: 'Сделка закрыта.' }
];

const STAGE_INDEX = SAFETY_STAGES.reduce<Record<SafetyStageId, number>>((acc, stage, index) => {
  acc[stage.id] = index;
  return acc;
}, {} as Record<SafetyStageId, number>);

const FRAGILE_PART_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(headlight|tail.?light|lamp|fog|фара|фонар|стоп|оптика|противотуман)/i, label: 'оптика' },
  { pattern: /(glass|windshield|window|стекл|лобов)/i, label: 'стекло' },
  { pattern: /(mirror|зеркал)/i, label: 'зеркало' },
  { pattern: /(bumper|бампер)/i, label: 'бампер' },
  { pattern: /(door|hood|bonnet|fender|quarter|trunk|lid|крыло|двер|капот|багаж|кузов)/i, label: 'кузовная деталь' },
  { pattern: /(ecu|module|computer|unit|sensor|camera|display|screen|блок|модул|датчик|камера|экран|дисплей)/i, label: 'электроника' }
];

const AFTER_RECEIVING_PATTERNS = [
  /оплат[ауы]?\s+после\s+получ/i,
  /после\s+получ/i,
  /cash\s+on\s+delivery/i,
  /pay\s+after/i,
  /payment\s+after/i,
  /post.?payment/i
];

const HALF_PAYMENT_PATTERNS = [
  /50\s*\/\s*50/i,
  /пятьдесят\s*на\s*пятьдесят/i,
  /половин/i,
  /half\s+now/i,
  /half\s+payment/i
];

const AGGRESSIVE_PATTERNS = [
  /обман/i,
  /скам/i,
  /scam/i,
  /fraud/i,
  /не\s+довер/i,
  /жалоб/i,
  /полици/i
];

const PACKING_PATTERNS = [/упаков/i, /packing/i, /packed/i, /box/i, /короб/i, /пленк/i];
const CARGO_HANDOVER_PATTERNS = [/cargo/i, /карго/i, /receipt/i, /накладн/i, /передан/i, /handover/i];
const DEFECT_PATTERNS = [/defect/i, /дефект/i, /царап/i, /трещ/i, /скол/i, /повреж/i];

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: number) => `${Math.round(value).toLocaleString('en-US')} AED`;

const normalizeText = (value: unknown) => String(value || '').trim();

const orderText = (order: Order) => [
  order.clientName,
  order.customerContact,
  order.socialNickname,
  order.brand,
  order.model,
  order.vin,
  ...(order.notes || []).map((note) => note.text),
  ...(order.parts || []).flatMap((part) => [part.name, part.comment, ...(part.variants || []).map((variant) => variant.note)])
].filter(Boolean).join('\n');

const hasAnyPattern = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const hasCarPhoto = (order: Pick<Order, 'carPhotoUrl' | 'carPhotos'>) =>
  Boolean(order.carPhotoUrl || (order.carPhotos || []).some((photo) => normalizeText(photo)));

const hasVin = (order: Pick<Order, 'vin'>) => normalizeText(order.vin).length >= 6;

const hasStrictVin = (order: Pick<Order, 'vin'>) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(normalizeText(order.vin));

const hasPartRequest = (order: Pick<Order, 'parts'>) =>
  (order.parts || []).some((part) => normalizeText(part.name).length >= 2);

const getBestVariant = (part: Part): PriceVariant | undefined => {
  const variants = part.variants || [];
  return variants.find((variant) => variant.isBest)
    || variants.find((variant) => asNumber(variant.salePriceAed ?? variant.priceAed) > 0)
    || variants[0];
};

export const isFragilePartName = (name: string) => FRAGILE_PART_PATTERNS.some((entry) => entry.pattern.test(name));

const getPartPriceAed = (part: Part) => {
  const variant = getBestVariant(part);
  return asNumber(variant?.salePriceAed ?? variant?.priceAed);
};

export const calculateOrderSafetyMoney = (order: Order) => {
  let saleSubtotalAed = 0;
  let purchaseTotalAed = 0;

  (order.parts || []).forEach((part) => {
    const variant = getBestVariant(part);
    if (!variant) return;
    const quantity = Math.max(1, asNumber(part.quantity || 1));
    const sale = asNumber(variant.salePriceAed ?? variant.priceAed);
    const purchase = asNumber(variant.purchasePriceAed ?? variant.priceAed);
    saleSubtotalAed += sale * quantity;
    purchaseTotalAed += purchase * quantity;
  });

  const deliveryAed = asNumber(order.logistics?.deliveryAed);
  const packingAed = asNumber(order.logistics?.packingAed);
  const serviceFeeAed = asNumber(order.logistics?.serviceFeeAed);
  const cargoAed = asNumber(order.logistics?.cargoTotalCostUsd) * (asNumber(order.exchangeRate) || 3.67);
  const markupAed = (order.markupType || 'percent') === 'fixed'
    ? asNumber(order.markupFixedAed)
    : saleSubtotalAed * (asNumber(order.markupPercent) / 100);
  const logisticsAed = deliveryAed + packingAed + serviceFeeAed;
  const expectedRevenueAed = saleSubtotalAed + markupAed + logisticsAed + cargoAed;
  const netProfitAed = saleSubtotalAed > 0 ? (saleSubtotalAed - purchaseTotalAed) + markupAed : null;

  return {
    purchaseTotalAed,
    saleSubtotalAed,
    markupAed,
    logisticsAed,
    cargoAed,
    expectedRevenueAed,
    netProfitAed
  };
};

const deriveCurrentStage = (order: Order, proofPack: ProofPackSummary): SafetyStageId => {
  const text = orderText(order);
  const depositPaid = order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid' || order.paymentStatus === 'full_prepayment_paid';
  const fullPrepaid = order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid' || order.salesStatus === 'Completed';
  const quoteSent = order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval' || Boolean(order.publicQuoteToken);
  const hasData = hasVin(order) || hasCarPhoto(order) || hasPartRequest(order);
  const hasCoreData = hasVin(order) && hasPartRequest(order);
  const purchased = (order.parts || []).some((part) => part.status === 'ordered');
  const inspected = (order.preSaleCheck?.defectPhotos || []).length > 0 || (order.preSaleCheck?.inspectionMedia || []).length > 0;
  const packed = hasAnyPattern(text, PACKING_PATTERNS);
  const handedCargo = hasAnyPattern(text, CARGO_HANDOVER_PATTERNS);

  if (order.isSold || order.salesStatus === 'Completed') return 'completed';
  if (handedCargo) return 'cargo_handover';
  if (packed) return 'packing';
  if (inspected || proofPack.completed >= 3) return 'inspection';
  if (purchased) return 'purchase';
  if (fullPrepaid) return 'full_prepayment';
  if (quoteSent) return 'final_quote';
  if (depositPaid) return 'active_search';
  if (hasCoreData) return 'deposit_gate';
  if (hasData) return 'data_collection';
  return 'inquiry';
};

const deriveTimeline = (order: Order, currentStage: SafetyStageId): SafetyStage[] => {
  const currentIndex = STAGE_INDEX[currentStage];
  const depositPaid = order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid' || order.paymentStatus === 'full_prepayment_paid';
  const fullPrepaid = order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid' || order.salesStatus === 'Completed';

  return SAFETY_STAGES.map((stage, index) => {
    let state: SafetyStageState = index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'upcoming';

    if (index >= STAGE_INDEX.active_search && index < STAGE_INDEX.final_quote && !depositPaid) {
      state = 'locked';
    }
    if (index >= STAGE_INDEX.purchase && index < STAGE_INDEX.completed && !fullPrepaid) {
      state = 'locked';
    }

    return { ...stage, state };
  });
};

const deriveLeadQuality = (order: Order): LeadQualitySummary => {
  const text = orderText(order);
  const factors: ScoreFactor[] = [];
  let score = 20;

  const add = (label: string, points: number, tone: ScoreFactor['tone']) => {
    factors.push({ label, points, tone });
    score += points;
  };

  if (hasStrictVin(order)) add('Дал корректный VIN', 18, 'positive');
  else if (hasVin(order)) add('VIN есть, но лучше проверить формат', 10, 'positive');
  else add('VIN не указан', -14, 'negative');

  if (hasCarPhoto(order)) add('Есть фото автомобиля', 10, 'positive');
  else add('Нет фото автомобиля', -8, 'negative');

  if (hasPartRequest(order)) add('Деталь указана конкретно', 12, 'positive');
  else add('Нет конкретной детали', -12, 'negative');

  if (normalizeText(order.logistics?.cargoCountry) || order.logistics?.deliveryType === 'uae') add('Понятна страна/город доставки', 8, 'positive');
  else add('Доставка не уточнена', -6, 'negative');

  if (order.searchDepositStatus === 'paid' || order.paymentStatus === 'search_deposit_paid') add('Согласился на депозит', 18, 'positive');
  if (order.paymentStatus === 'full_prepayment_paid' || order.salesStatus === 'Paid') add('Клиент оплатил', 28, 'positive');
  if (normalizeText(order.customerContact).length >= 6) add('Есть прямой контакт', 7, 'positive');

  if (hasAnyPattern(text, HALF_PAYMENT_PATTERNS)) add('Просит 50/50', -18, 'negative');
  if (hasAnyPattern(text, AFTER_RECEIVING_PATTERNS)) add('Просит оплату после получения', -35, 'negative');
  if (hasAnyPattern(text, AGGRESSIVE_PATTERNS)) add('Есть конфликтный тон до оплаты', -20, 'negative');

  const hoursSinceUpdate = Math.floor((Date.now() - (order.updatedAt || order.createdAt || Date.now())) / 36e5);
  if ((order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval') && hoursSinceUpdate >= 24) {
    add(`Не отвечает ${hoursSinceUpdate}ч после цены`, hoursSinceUpdate >= 72 ? -22 : -12, 'negative');
  }

  score = Math.max(0, Math.min(100, score));

  const risky = hasAnyPattern(text, [...AFTER_RECEIVING_PATTERNS, ...AGGRESSIVE_PATTERNS]) || score < 25;
  const paid = order.paymentStatus === 'full_prepayment_paid' || order.paymentStatus === 'search_deposit_paid' || order.salesStatus === 'Paid';
  const level: LeadQualityLevel = paid ? 'paid' : risky ? 'risky' : score >= 72 ? 'hot' : score >= 48 ? 'warm' : 'cold';
  const labels: Record<LeadQualityLevel, string> = {
    cold: 'Холодный лид',
    warm: 'Тёплый лид',
    hot: 'Горячий лид',
    paid: 'Оплаченный клиент',
    risky: 'Рискованный клиент'
  };

  return { level, label: labels[level], score, factors };
};

const deriveCargoRisk = (order: Order): CargoRiskSummary => {
  const moneyTotals = calculateOrderSafetyMoney(order);
  const fragileParts = (order.parts || [])
    .filter((part) => isFragilePartName(`${part.name} ${part.partType || ''}`) || Boolean(part.isOversized))
    .map((part) => part.name);
  const expensiveParts = (order.parts || [])
    .filter((part) => getPartPriceAed(part) >= 2500)
    .map((part) => `${part.name} (${money(getPartPriceAed(part))})`);
  const international = order.logistics?.deliveryType === 'export' || Boolean(order.logistics?.cargoCountry);
  const active = fragileParts.length > 0 || expensiveParts.length > 0 || moneyTotals.saleSubtotalAed >= 5000 || international;
  const warnings: string[] = [];

  if (fragileParts.length > 0) warnings.push('Нужна усиленная упаковка и фото/видео упаковки.');
  if (expensiveParts.length > 0) warnings.push('Дорогая позиция: фиксируйте серийные номера, дефекты и receipt.');
  if (international) warnings.push('Международная доставка: ответственность после передачи cargo должна быть принята клиентом.');
  if (active && asNumber(order.logistics?.packingAed) <= 0) warnings.push('Добавьте отдельную стоимость упаковки до оплаты.');

  return {
    active,
    label: active ? 'Cargo Risk Mode' : 'Обычный cargo risk',
    fragileParts,
    expensiveParts,
    warnings,
    clientWarning: active
      ? 'Деталь относится к хрупким/дорогим. Нужна усиленная упаковка. После передачи в cargo риск повреждения переходит к перевозчику; при получении проверьте товар сразу.'
      : 'Стандартная доставка. Проверяйте товар при получении и сохраняйте cargo receipt.'
  };
};

const deriveProofPack = (order: Order): ProofPackSummary => {
  const text = orderText(order);
  const supplierPhotos = (order.parts || []).flatMap((part) => (part.variants || []).flatMap((variant) => [variant.photoUrl || '', ...(variant.photos || [])])).filter(Boolean);
  const partPhotos = (order.parts || []).flatMap((part) => [part.photoUrl || '', ...(part.photos || [])]).filter(Boolean);
  const notePhotos = (order.notes || []).flatMap((note) => note.photos || []).filter(Boolean);
  const inspectionMedia = order.preSaleCheck?.inspectionMedia || [];
  const defectPhotos = order.preSaleCheck?.defectPhotos || [];
  const hasVideo = inspectionMedia.length > 0 || (order.parts || []).some((part) => normalizeText(part.googleDriveVideoUrl));

  const items: ChecklistItem[] = [
    { id: 'supplier_photos', label: 'Фото детали у поставщика', done: supplierPhotos.length > 0, critical: true },
    { id: 'serial_marking', label: 'Серийные номера / маркировки', done: /serial|marking|номер|маркиров/i.test(text), critical: false },
    { id: 'defects', label: 'Фото дефектов и состояния', done: defectPhotos.length > 0 || hasAnyPattern(text, DEFECT_PATTERNS), critical: true },
    { id: 'inspection_video', label: 'Видео проверки', done: hasVideo, critical: true },
    { id: 'before_purchase', label: 'Фото до покупки', done: partPhotos.length > 0 || supplierPhotos.length > 0, critical: false },
    { id: 'after_purchase', label: 'Фото после покупки', done: notePhotos.length > 0 || inspectionMedia.length > 0, critical: false },
    { id: 'packing', label: 'Фото/видео упаковки', done: hasAnyPattern(text, PACKING_PATTERNS), critical: true },
    { id: 'cargo_handover', label: 'Передача в cargo + receipt', done: hasAnyPattern(text, CARGO_HANDOVER_PATTERNS), critical: true },
    { id: 'condition_comment', label: 'Комментарий по состоянию', done: (order.parts || []).some((part) => normalizeText(part.comment).length > 8) || (order.notes || []).some((note) => normalizeText(note.text).length > 12), critical: false }
  ];

  return {
    total: items.length,
    completed: items.filter((item) => item.done).length,
    items
  };
};

const deriveReadiness = (order: Order, cargoRisk: CargoRiskSummary, proofPack: ProofPackSummary): ReadinessSummary => {
  const hasPricedPart = (order.parts || []).some((part) => part.isFound || (part.variants || []).length > 0);
  const prepaymentAccepted = order.paymentStatus === 'full_prepayment_paid'
    || order.paymentStatus === 'search_deposit_paid'
    || order.searchDepositStatus === 'paid'
    || order.salesStatus === 'Paid';
  const countryReady = order.logistics?.deliveryType === 'uae' || Boolean(order.logistics?.cargoCountry);
  const cargoRiskShown = !cargoRisk.active || asNumber(order.logistics?.packingAed) > 0 || /cargo|карго|упаков/i.test(orderText(order));

  const items: ChecklistItem[] = [
    { id: 'vin', label: 'VIN есть', done: hasVin(order), critical: true },
    { id: 'car_photo', label: 'Фото авто есть', done: hasCarPhoto(order), critical: true },
    { id: 'part', label: 'Деталь уточнена', done: hasPartRequest(order), critical: true },
    { id: 'delivery', label: 'Страна/город доставки понятны', done: countryReady, critical: true },
    { id: 'price', label: 'Цена подтверждена', done: hasPricedPart, critical: true },
    { id: 'terms', label: 'Условия отправлены клиенту', done: order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval' || order.salesStatus === 'Paid' || Boolean(order.publicQuoteToken), critical: true },
    { id: 'prepayment', label: 'Клиент согласен на депозит/предоплату', done: prepaymentAccepted, critical: true },
    { id: 'cargo_risk', label: 'Cargo risk показан', done: cargoRiskShown, critical: cargoRisk.active },
    { id: 'proof_pack', label: 'Proof Pack начат', done: proofPack.completed > 0, critical: true }
  ];
  const completed = items.filter((item) => item.done).length;
  const blockers = items.filter((item) => item.critical && !item.done).map((item) => item.label);

  return {
    total: items.length,
    completed,
    percent: Math.round((completed / items.length) * 100),
    blockers,
    items
  };
};

const deriveProfitProtection = (order: Order, cargoRisk: CargoRiskSummary): ProfitProtectionSummary => {
  const totals = calculateOrderSafetyMoney(order);
  const minProfitAed = Math.max(250, Math.round(totals.expectedRevenueAed * 0.08), cargoRisk.active ? 500 : 0);

  if (totals.saleSubtotalAed <= 0 || totals.netProfitAed === null) {
    return {
      ...totals,
      level: 'unknown',
      label: 'Маржа ещё не посчитана',
      minProfitAed,
      message: 'Добавьте закупочную и продажную цену, чтобы система защищала прибыль.'
    };
  }

  if (totals.netProfitAed <= 0) {
    return {
      ...totals,
      level: 'loss',
      label: 'Убыток',
      minProfitAed,
      message: 'Сделка не стоит времени/риска: прибыль отрицательная.'
    };
  }

  if (totals.netProfitAed < minProfitAed) {
    return {
      ...totals,
      level: 'thin',
      label: 'Слабая прибыль',
      minProfitAed,
      message: `Минимальная прибыль для такого риска: ${money(minProfitAed)}. Сейчас: ${money(totals.netProfitAed)}.`
    };
  }

  return {
    ...totals,
    level: 'healthy',
    label: 'Прибыль защищена',
    minProfitAed,
    message: `Чистая прибыль выглядит здоровой: ${money(totals.netProfitAed)}.`
  };
};

const deriveDealRisk = (order: Order, cargoRisk: CargoRiskSummary, profit: ProfitProtectionSummary): DealRiskSummary => {
  const text = orderText(order);
  const factors: ScoreFactor[] = [];
  const blockers: string[] = [];
  let score = 0;

  const add = (label: string, points: number) => {
    factors.push({ label, points, tone: points > 0 ? 'negative' : 'positive' });
    score += points;
    if (points >= 20) blockers.push(label);
  };

  if (hasAnyPattern(text, AFTER_RECEIVING_PATTERNS)) add('Клиент хочет оплату после получения', 35);
  if (hasAnyPattern(text, HALF_PAYMENT_PATTERNS)) add('Клиент просит 50/50', 22);
  if (hasAnyPattern(text, AGGRESSIVE_PATTERNS)) add('Конфликтный тон до оплаты', 25);
  if (order.paymentStatus !== 'full_prepayment_paid' && (order.salesStatus === 'Paid' || (order.parts || []).some((part) => part.status === 'ordered'))) add('Есть движение к закупке без полной предоплаты', 28);
  if (!hasVin(order)) add('Нет VIN', 15);
  if (!hasCarPhoto(order)) add('Нет фото авто', 8);
  if (cargoRisk.active) add('Включен cargo risk mode', 18);
  if (cargoRisk.active && asNumber(order.logistics?.packingAed) <= 0) add('Нет отдельной строки упаковки', 10);
  if (profit.level === 'thin') add('Маржа ниже минимальной', 20);
  if (profit.level === 'loss') add('Сделка убыточная', 35);
  if ((order.parts || []).some((part) => (part.variants || []).some((variant) => !variant.shopId && normalizeText(variant.shopName)))) add('Есть непроверенный поставщик/магазин', 8);
  if (order.logistics?.deliveryType === 'export' || order.logistics?.cargoCountry) add('Международная доставка', 10);

  score = Math.max(0, Math.min(100, score));
  const level: DealRiskLevel = score >= 75 ? 'refuse' : score >= 50 ? 'high' : score >= 25 ? 'caution' : 'safe';
  const labels: Record<DealRiskLevel, string> = {
    safe: 'Безопасная',
    caution: 'Осторожно',
    high: 'Высокий риск',
    refuse: 'Лучше отказаться'
  };
  const recommendation: Record<DealRiskLevel, string> = {
    safe: 'Можно продолжать по процессу: депозит, смета, полная предоплата, закупка.',
    caution: 'Не углубляйтесь без депозита и письменного подтверждения условий.',
    high: 'Остановите закупку до полной предоплаты, proof pack и принятия cargo risk.',
    refuse: 'Лучше отказаться или вести только при полной предоплате и принятии всех рисков.'
  };

  return { level, label: labels[level], score, factors, blockers, recommendation: recommendation[level] };
};

const deriveFollowUp = (order: Order): NoReplyFollowUpSummary => {
  const priceWasSent = order.salesStatus === 'Price Sent' || order.salesStatus === 'Pending Approval';
  const hoursSinceUpdate = Math.floor((Date.now() - (order.updatedAt || order.createdAt || Date.now())) / 36e5);

  if (!priceWasSent) {
    return { status: 'none', label: 'Follow-up не нужен', hoursSinceUpdate, message: '' };
  }

  if (hoursSinceUpdate >= 72) {
    return {
      status: 'inactive',
      label: 'Закрыть как неактивную',
      hoursSinceUpdate,
      message: 'Здравствуйте! Так как ответа по смете пока нет, я поставлю заявку на паузу. Если актуально, напишите, и мы продолжим с текущими ценами или обновим варианты.'
    };
  }
  if (hoursSinceUpdate >= 24) {
    return {
      status: 'no_reply_24h',
      label: 'Нет ответа 24 часа',
      hoursSinceUpdate,
      message: 'Здравствуйте! Вчера отправлял смету. Подскажите, пожалуйста, рассматриваем этот вариант или лучше поискать другой бюджет/состояние?'
    };
  }
  if (hoursSinceUpdate >= 3) {
    return {
      status: 'no_reply_3h',
      label: 'Нет ответа 3 часа',
      hoursSinceUpdate,
      message: 'Здравствуйте! Отправил цену и условия по детали. Если всё подходит, можем зафиксировать вариант, пока он доступен у поставщика.'
    };
  }

  return {
    status: 'none',
    label: 'Цена отправлена недавно',
    hoursSinceUpdate,
    message: 'Пока можно подождать ответ клиента.'
  };
};

export const buildSupplierBroadcastMessage = (order: Order) => {
  const parts = (order.parts || []).map((part) => {
    const side = /(left|lh|лев)/i.test(part.name) ? 'left/LH' : /(right|rh|прав)/i.test(part.name) ? 'right/RH' : '';
    return `- ${part.name}${side ? ` (${side})` : ''}${part.comment ? `: ${part.comment}` : ''}`;
  }).join('\n');
  const market = order.vehicleDetails?.marketRegion ? `Market: ${order.vehicleDetails.marketRegion.toUpperCase()}` : '';
  const body = order.bodyType ? `Body: ${order.bodyType}` : '';
  const photos = [
    ...(order.carPhotos || []),
    ...(order.parts || []).flatMap((part) => part.photos || [])
  ].filter(Boolean).slice(0, 4);

  return [
    `Need price/photos/location for: ${order.brand} ${order.model} ${order.year}`.trim(),
    order.vin ? `VIN: ${order.vin}` : 'VIN: not provided',
    body,
    market,
    'Parts:',
    parts || '- please check requested part',
    photos.length > 0 ? `Photos: ${photos.join(' ')}` : 'Photos: will send separately',
    'Please send price, real photos, condition and shop location.'
  ].filter(Boolean).join('\n');
};

const buildPaymentExplanation = (order: Order) => {
  const car = [order.brand, order.model, order.year].filter(Boolean).join(' ').trim() || 'вашему автомобилю';
  return [
    `По ${car} работаем через безопасный процесс.`,
    'Депозит нужен, чтобы начать реальный поиск: звонки поставщикам, проверка наличия и поездка на рынок.',
    'Полная оплата нужна до закупки, потому что деталь покупается под конкретного клиента и поставщики не держат товар без оплаты.',
    'Так мы фиксируем цену, делаем фото/видео проверки и не перекладываем риск отказа после покупки на продавца.'
  ].join('\n\n');
};

const buildRefusalMessage = (order: Order, risk: DealRiskSummary, profit: ProfitProtectionSummary) => {
  const reason = risk.level === 'refuse'
    ? risk.blockers[0] || 'условия несут высокий риск'
    : profit.level === 'thin' || profit.level === 'loss'
      ? 'маржа не покрывает время и риск'
      : 'условия сделки пока не подтверждены';

  return [
    `По заказу ${[order.brand, order.model, order.year].filter(Boolean).join(' ').trim()} пока не можем продолжить закупку.`,
    `Причина: ${reason}.`,
    'Можем вернуться к сделке, если будет VIN/фото, подтверждение условий, депозит на поиск и полная предоплата до закупки.'
  ].join('\n\n');
};

export const deriveSafetySalesSummary = (order: Order): SafetySalesSummary => {
  const cargoRisk = deriveCargoRisk(order);
  const proofPack = deriveProofPack(order);
  const currentStage = deriveCurrentStage(order, proofPack);
  const stages = deriveTimeline(order, currentStage);
  const readiness = deriveReadiness(order, cargoRisk, proofPack);
  const profit = deriveProfitProtection(order, cargoRisk);
  const dealRisk = deriveDealRisk(order, cargoRisk, profit);
  const leadQuality = deriveLeadQuality(order);
  const followUp = deriveFollowUp(order);

  return {
    currentStage,
    stages,
    leadQuality,
    dealRisk,
    cargoRisk,
    proofPack,
    readiness,
    profit,
    followUp,
    supplierBroadcast: buildSupplierBroadcastMessage(order),
    paymentExplanation: buildPaymentExplanation(order),
    refusalMessage: buildRefusalMessage(order, dealRisk, profit)
  };
};

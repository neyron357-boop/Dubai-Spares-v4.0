import { aiCore } from './aiCore';
import { Order, VehicleDetails } from '../types';

export const VEHICLE_AUTOFILL_SCHEMA = {
  engineType: 'string',
  fuelType: 'string',
  drivetrain: 'string',
  transmission: 'string',
  transmissionCode: 'string',
  engineDisplacement: 'string',
  engineCode: 'string',
  trimLevel: 'string',
  marketRegion: 'string',
  steeringSide: 'string',
  doors: 'string',
  color: 'string',
  additionalNotes: 'string',
  warnings: ['string'],
  confidence: 'string',
} as const;

type VehicleAutofillResult = VehicleDetails & {
  warnings: string[];
  confidence: string;
};

type VehicleDetailKey = keyof VehicleDetails;
type EnumAliasMap<T extends string> = Record<string, T | readonly T[]>;

const VEHICLE_DETAIL_KEYS: VehicleDetailKey[] = [
  'engineType',
  'fuelType',
  'drivetrain',
  'transmission',
  'transmissionCode',
  'engineDisplacement',
  'engineCode',
  'trimLevel',
  'marketRegion',
  'steeringSide',
  'doors',
  'color',
  'additionalNotes',
];

const DRIVETRAIN_MAP: EnumAliasMap<NonNullable<VehicleDetails['drivetrain']>> = {
  fwd: ['fwd', 'front wheel drive', 'front-wheel drive', 'front wheel', 'front-drive'],
  rwd: ['rwd', 'rear wheel drive', 'rear-wheel drive', 'rear wheel', 'rear-drive'],
  awd: ['awd', 'all wheel drive', 'all-wheel drive', 'full time awd', 'full-time awd', 'all wheel'],
  '4wd': ['4wd', '4x4', 'four wheel drive', 'four-wheel drive', '4 wheel drive'],
};

const TRANSMISSION_MAP: EnumAliasMap<NonNullable<VehicleDetails['transmission']>> = {
  automatic: ['automatic', 'auto', 'automatic transmission', 'automatic gearbox', '6 speed automatic', '6-speed automatic', 'geartronic automatic'],
  manual: ['manual', 'mt', 'manual transmission', 'manual gearbox', '5 speed manual', '6 speed manual'],
  cvt: ['cvt', 'variator', 'continuously variable transmission'],
  dct: ['dct', 'dsg', 'dual clutch', 'dual-clutch', 'dual clutch transmission', 'double clutch'],
  other: ['other', 'semi automatic', 'semi-automatic'],
};

const MARKET_REGION_MAP: EnumAliasMap<NonNullable<VehicleDetails['marketRegion']>> = {
  china: ['china', 'chinese', 'cn spec'],
  japan: ['japan', 'japanese', 'jdm', 'japan spec'],
  usa: ['usa', 'us', 'u s', 'american', 'america', 'us market', 'usa spec', 'u.s. market', 'north america'],
  europe: ['europe', 'european', 'eu', 'euro', 'europe spec', 'eu spec', 'euro spec'],
  gcc: ['gcc', 'gulf', 'gulf spec', 'gcc spec', 'middle east', 'middle east spec'],
  other: ['other', 'global', 'international'],
};

const STEERING_SIDE_MAP: EnumAliasMap<NonNullable<VehicleDetails['steeringSide']>> = {
  left: ['left', 'lhd', 'left hand drive', 'left-hand drive', 'driver left'],
  right: ['right', 'rhd', 'right hand drive', 'right-hand drive', 'driver right'],
};

const WEAK_VALUE_TOKENS = new Set([
  'unknown',
  'n/a',
  'na',
  'none',
  'not sure',
  'unsure',
  'maybe',
  'possibly',
  '?',
  '-',
  '—',
  '--',
  'null',
  'nil',
  'not available',
  'not provided',
  'tbd',
]);

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const stripBracketedSegments = (value: string) => value
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\[[^\]]*\]/g, ' ')
  .replace(/\{[^}]*\}/g, ' ');

const normalizeText = (value: unknown) => stripBracketedSegments(readString(value))
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[\/|]+/g, ' ')
  .replace(/[^a-z0-9+]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isWeakValue = (value: unknown) => {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return WEAK_VALUE_TOKENS.has(normalized);
};

const looksLikeSignal = (value: string) => /[a-z0-9]/i.test(value) && !isWeakValue(value);

const readWarnings = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => readString(item))
    .filter((item) => looksLikeSignal(item));
};

const normalizePlainValue = (value: unknown) => {
  const raw = readString(value);
  return looksLikeSignal(raw) ? raw : '';
};

const matchesAlias = (normalizedValue: string, normalizedAlias: string) => {
  if (!normalizedValue || !normalizedAlias) return false;
  return normalizedValue === normalizedAlias
    || normalizedValue.includes(normalizedAlias)
    || normalizedAlias.includes(normalizedValue);
};

const normalizeMappedValue = <T extends string>(value: unknown, map: EnumAliasMap<T>): T | undefined => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return undefined;

  for (const [target, aliases] of Object.entries(map) as Array<[T, T | readonly T[]]>) {
    const variants = Array.isArray(aliases) ? aliases : [aliases];
    const normalizedVariants = [target, ...variants].map((variant) => normalizeText(variant));

    if (normalizedVariants.some((variant) => matchesAlias(normalizedValue, variant))) {
      return target;
    }
  }

  return undefined;
};

const normalizeBodyTypeInput = (value: string) => {
  const compact = readString(value);
  if (!compact) return '';

  return compact
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter((part) => part && !/(\b\d(?:\.\d)?\s?(?:l|gdi|tdi|tsi|fsi|v6|v8|i4)\b|engine|turbo|diesel|petrol)/i.test(part))
    .join(' | ');
};

const buildVehicleAutofillPrompt = (order: Order) => {
  const vehicleDetails = order.vehicleDetails || {};
  const payload = {
    brand: order.brand || '',
    model: order.model || '',
    year: order.year || '',
    vin: order.vin || '',
    bodyType: normalizeBodyTypeInput(order.bodyType || ''),
    rawBodyTypeInput: order.bodyType || '',
    existingVehicleDetails: {
      engineType: vehicleDetails.engineType || '',
      fuelType: vehicleDetails.fuelType || '',
      drivetrain: vehicleDetails.drivetrain || '',
      transmission: vehicleDetails.transmission || '',
      transmissionCode: vehicleDetails.transmissionCode || '',
      engineDisplacement: vehicleDetails.engineDisplacement || '',
      engineCode: vehicleDetails.engineCode || '',
      trimLevel: vehicleDetails.trimLevel || '',
      marketRegion: vehicleDetails.marketRegion || '',
      steeringSide: vehicleDetails.steeringSide || '',
      doors: vehicleDetails.doors || '',
      color: vehicleDetails.color || '',
      additionalNotes: vehicleDetails.additionalNotes || '',
    },
    notes: order.notes || '',
  };

  return JSON.stringify(payload, null, 2);
};

const parseVehicleAutofillResult = (payload: unknown): VehicleAutofillResult => {
  const data = asRecord(payload);
  const parsed: VehicleAutofillResult = {
    engineType: normalizePlainValue(data.engineType),
    fuelType: normalizePlainValue(data.fuelType),
    drivetrain: normalizeMappedValue(data.drivetrain, DRIVETRAIN_MAP),
    transmission: normalizeMappedValue(data.transmission, TRANSMISSION_MAP),
    transmissionCode: normalizePlainValue(data.transmissionCode),
    engineDisplacement: normalizePlainValue(data.engineDisplacement),
    engineCode: normalizePlainValue(data.engineCode),
    trimLevel: normalizePlainValue(data.trimLevel),
    marketRegion: normalizeMappedValue(data.marketRegion, MARKET_REGION_MAP),
    steeringSide: normalizeMappedValue(data.steeringSide, STEERING_SIDE_MAP),
    doors: normalizePlainValue(data.doors),
    color: normalizePlainValue(data.color),
    additionalNotes: normalizePlainValue(data.additionalNotes),
    warnings: readWarnings(data.warnings),
    confidence: normalizePlainValue(data.confidence),
  };

  console.debug('[vehicleAutofill] parsed normalized result', parsed);
  return parsed;
};

export const mergeVehicleAutofill = (current: VehicleDetails | undefined, inferred: VehicleAutofillResult): VehicleDetails | null => {
  const base: VehicleDetails = { ...(current || {}) };
  let changed = false;

  VEHICLE_DETAIL_KEYS.forEach((key) => {
    if (key === 'additionalNotes') return;

    const incomingValue = inferred[key];
    const existingValue = base[key];
    if (!incomingValue || isWeakValue(incomingValue)) return;
    if (!isWeakValue(existingValue)) return;

    base[key] = incomingValue as never;
    changed = true;
  });

  const notesParts = [readString(base.additionalNotes)];
  const appended = [readString(inferred.additionalNotes), ...inferred.warnings];
  if (inferred.confidence) appended.push(`AI confidence: ${inferred.confidence}`);
  const uniqueToAppend = appended.filter((item) => item && !notesParts.some((existing) => existing.toLowerCase().includes(item.toLowerCase())));
  if (uniqueToAppend.length > 0) {
    const nextNotes = [notesParts[0], uniqueToAppend.join(' | ')].filter(Boolean).join(notesParts[0] ? '\n' : '');
    if (nextNotes !== (base.additionalNotes || '')) {
      base.additionalNotes = nextNotes;
      changed = true;
    }
  }

  console.debug('[vehicleAutofill] merged final result', {
    current,
    inferred,
    merged: changed ? base : null,
  });

  return changed ? base : null;
};

export const autofillVehicleDetailsFromVin = async (order: Order) => {
  const response = await aiCore.extractStructuredData({
    text: buildVehicleAutofillPrompt(order),
    schema: VEHICLE_AUTOFILL_SCHEMA as unknown as Record<string, unknown>,
    instructions: [
      'Infer only realistic automotive values from the provided VIN and known vehicle data.',
      'Treat VIN, brand, model, and year as the strongest signals; use bodyType and notes only as secondary hints.',
      'The bodyType field may contain noisy mixed data such as engine info, so ignore any bodyType fragments that look unrelated to body style.',
      'Use VIN and explicitly provided fields as the strongest signal.',
      'Be conservative. If a value is not reliably inferable, return an empty string.',
      'Do not hallucinate exact trim or color when uncertain.',
      'Return drivetrain only as one of: fwd, rwd, awd, 4wd.',
      'Return transmission only as one of: automatic, manual, cvt, dct, other.',
      'Return marketRegion only as one of: usa, europe, japan, gcc, china, other.',
      'Return steeringSide only as one of: left, right.',
      'Warnings should mention uncertainty, market compatibility risks, and steering relevance when appropriate.',
      'Keep additionalNotes concise and useful for parts compatibility checks.',
    ].join(' '),
  }, { cancelPrevious: false, timeoutMs: 18000 });

  if (!response.ok) {
    throw new Error(response.error || 'AI vehicle autofill failed');
  }

  console.debug('[vehicleAutofill] raw AI extracted payload', response.result.extracted);
  return parseVehicleAutofillResult(response.result.extracted);
};

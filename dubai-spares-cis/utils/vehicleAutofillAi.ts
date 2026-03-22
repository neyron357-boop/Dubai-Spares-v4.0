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

const DRIVETRAIN_MAP: Record<string, NonNullable<VehicleDetails['drivetrain']>> = {
  fwd: 'fwd',
  'front wheel drive': 'fwd',
  'front-wheel drive': 'fwd',
  front: 'fwd',
  rwd: 'rwd',
  'rear wheel drive': 'rwd',
  'rear-wheel drive': 'rwd',
  rear: 'rwd',
  awd: 'awd',
  'all wheel drive': 'awd',
  'all-wheel drive': 'awd',
  'full time awd': 'awd',
  'full-time awd': 'awd',
  '4wd': '4wd',
  '4x4': '4wd',
  'four wheel drive': '4wd',
  'four-wheel drive': '4wd',
};

const TRANSMISSION_MAP: Record<string, NonNullable<VehicleDetails['transmission']>> = {
  automatic: 'automatic',
  auto: 'automatic',
  'automatic transmission': 'automatic',
  manual: 'manual',
  mt: 'manual',
  'manual transmission': 'manual',
  cvt: 'cvt',
  variator: 'cvt',
  dct: 'dct',
  dsg: 'dct',
  'dual clutch': 'dct',
  'dual-clutch': 'dct',
  'dual clutch transmission': 'dct',
  other: 'other',
};

const MARKET_REGION_MAP: Record<string, NonNullable<VehicleDetails['marketRegion']>> = {
  china: 'china',
  chinese: 'china',
  japan: 'japan',
  japanese: 'japan',
  usa: 'usa',
  us: 'usa',
  america: 'usa',
  american: 'usa',
  europe: 'europe',
  european: 'europe',
  eu: 'europe',
  gcc: 'gcc',
  gulf: 'gcc',
  'middle east': 'gcc',
  other: 'other',
};

const STEERING_SIDE_MAP: Record<string, NonNullable<VehicleDetails['steeringSide']>> = {
  left: 'left',
  lhd: 'left',
  'left hand drive': 'left',
  'left-hand drive': 'left',
  right: 'right',
  rhd: 'right',
  'right hand drive': 'right',
  'right-hand drive': 'right',
};

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const readWarnings = (value: unknown) => (
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
);

const normalizeMappedValue = <T extends string>(value: unknown, map: Record<string, T>): T | undefined => {
  const normalized = readString(value).toLowerCase();
  if (!normalized) return undefined;
  return map[normalized];
};

const buildVehicleAutofillPrompt = (order: Order) => {
  const vehicleDetails = order.vehicleDetails || {};
  const payload = {
    brand: order.brand || '',
    model: order.model || '',
    year: order.year || '',
    vin: order.vin || '',
    bodyType: order.bodyType || '',
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
  return {
    engineType: readString(data.engineType),
    fuelType: readString(data.fuelType),
    drivetrain: normalizeMappedValue(data.drivetrain, DRIVETRAIN_MAP),
    transmission: normalizeMappedValue(data.transmission, TRANSMISSION_MAP),
    transmissionCode: readString(data.transmissionCode),
    engineDisplacement: readString(data.engineDisplacement),
    engineCode: readString(data.engineCode),
    trimLevel: readString(data.trimLevel),
    marketRegion: normalizeMappedValue(data.marketRegion, MARKET_REGION_MAP),
    steeringSide: normalizeMappedValue(data.steeringSide, STEERING_SIDE_MAP),
    doors: readString(data.doors),
    color: readString(data.color),
    additionalNotes: readString(data.additionalNotes),
    warnings: readWarnings(data.warnings),
    confidence: readString(data.confidence),
  };
};

const isWeakValue = (value: unknown) => {
  const normalized = readString(value).toLowerCase();
  if (!normalized) return true;
  return ['unknown', 'n/a', 'na', 'none', 'not sure', 'unsure', 'maybe', 'possibly', '?', '-', '—'].includes(normalized);
};

export const mergeVehicleAutofill = (current: VehicleDetails | undefined, inferred: VehicleAutofillResult): VehicleDetails | null => {
  const base: VehicleDetails = { ...(current || {}) };
  let changed = false;

  VEHICLE_DETAIL_KEYS.forEach((key) => {
    const incomingValue = inferred[key];
    if (!incomingValue || !isWeakValue(incomingValue) && !isWeakValue(base[key])) return;
    if (key === 'additionalNotes') return;
    if (isWeakValue(base[key])) {
      base[key] = incomingValue as never;
      changed = true;
    }
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

  return changed ? base : null;
};

export const autofillVehicleDetailsFromVin = async (order: Order) => {
  const response = await aiCore.extractStructuredData({
    text: buildVehicleAutofillPrompt(order),
    schema: VEHICLE_AUTOFILL_SCHEMA as unknown as Record<string, unknown>,
    instructions: [
      'Infer only realistic automotive values from the provided VIN and known vehicle data.',
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

  return parseVehicleAutofillResult(response.result.extracted);
};

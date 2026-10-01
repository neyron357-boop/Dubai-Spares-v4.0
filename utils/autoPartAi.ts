/** Local terminology lookup. Unknown descriptions are kept as entered. */
export type AutoPartAiAnalysis = {
  category: string;
  translated: string;
  translatedRu: string;
  estimatedWeightKg: number | null;
  fragile: boolean | null;
  sizeClass: string;
};
const TERMS = [
  ['передний бампер', 'front bumper'],
  ['задний бампер', 'rear bumper'],
  ['передняя фара', 'headlight'],
  ['задний фонарь', 'tail light'],
  ['лобовое стекло', 'windshield'],
  ['капот', 'hood'],
  ['крыло', 'fender'],
  ['двигатель', 'engine'],
  ['коробка передач', 'transmission'],
  ['радиатор', 'radiator'],
  ['зеркало', 'mirror'],
  ['дверь', 'door'],
];
export const analyzeAutoPartText = async (text: string): Promise<AutoPartAiAnalysis> => {
  const normalized = text.trim().toLowerCase(),
    term = TERMS.find(([ru, en]) => normalized === ru || normalized === en);
  return {
    category: '',
    translated: term?.[1] || '',
    translatedRu: term?.[0] || '',
    estimatedWeightKg: null,
    fragile: null,
    sizeClass: '',
  };
};
export const resolveAutoPartTranslation = (
  analysis: AutoPartAiAnalysis | null | undefined,
  original: string,
  language: 'ru' | 'en' | 'ar',
) =>
  language === 'ru'
    ? analysis?.translatedRu || original
    : language === 'en'
      ? analysis?.translated || original
      : original;

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig';

export type ImageManifestItem = {
  path: string;
  url: string | null;
  kind: 'main';
  width: number;
  height: number;
  size: number;
  originalSize: number;
  format: 'webp' | 'jpeg';
  mime: string;
};

type ActionScope = 'backup' | 'quote' | 'lead';

const MAX_DIMENSION_BY_SCOPE: Record<ActionScope, number> = {
  backup: 1920,
  quote: 1600,
  lead: 1600
};

const TARGET_BYTES_BY_SCOPE: Record<ActionScope, number> = {
  backup: 400 * 1024,
  quote: 250 * 1024,
  lead: 250 * 1024
};

const HARD_CAP_BYTES = 1024 * 1024;
const qualitySteps = [0.75, 0.62, 0.52, 0.46];

const randomId = () => Math.random().toString(36).slice(2, 10);
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const loadImage = (blob: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Failed to decode image'));
  };
  img.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))), type, quality);
  });

const resizeAndEncode = async (blob: Blob, maxDimension: number, quality: number): Promise<{ blob: Blob; width: number; height: number; format: 'webp' | 'jpeg' }> => {
  if (typeof document === 'undefined') return { blob, width: 0, height: 0, format: 'jpeg' };
  const image = await loadImage(blob);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob, width, height, format: 'jpeg' };
  ctx.drawImage(image, 0, 0, width, height);
  try {
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    return { blob: webp, width, height, format: 'webp' };
  } catch {
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
    return { blob: jpeg, width, height, format: 'jpeg' };
  }
};

const dataUrlToBlob = async (value: string): Promise<Blob> => {
  const response = await fetch(value);
  return response.blob();
};

const getBucketByScope = (scope: ActionScope) => (scope === 'backup' ? 'backups' : scope === 'quote' ? 'quotes' : 'leads');
const getStoragePublicUrl = (bucket: string, path: string) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

const uploadBlobToStorage = async (bucket: string, path: string, blob: Blob, signal?: AbortSignal): Promise<string> => {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-upsert': 'true',
      'Content-Type': blob.type || 'image/webp'
    },
    body: blob,
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Image upload failed ${response.status}: ${text.slice(0, 140)}`);
  }

  return getStoragePublicUrl(bucket, path);
};

const isDataImage = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image');

const getRootPath = (scope: ActionScope, rootId: string): string => {
  if (scope === 'backup') return `${rootId}`;
  if (scope === 'quote') return `${rootId}`;
  return `${rootId}`;
};

const compressForScope = async (source: Blob, scope: ActionScope) => {
  let best = await resizeAndEncode(source, MAX_DIMENSION_BY_SCOPE[scope], qualitySteps[0]);
  for (const quality of qualitySteps.slice(1)) {
    if (best.blob.size <= TARGET_BYTES_BY_SCOPE[scope]) break;
    best = await resizeAndEncode(source, MAX_DIMENSION_BY_SCOPE[scope], quality);
  }
  if (best.blob.size > HARD_CAP_BYTES) {
    best = await resizeAndEncode(source, Math.round(MAX_DIMENSION_BY_SCOPE[scope] * 0.72), 0.4);
  }
  if (best.blob.size > HARD_CAP_BYTES) {
    throw new Error('Image is larger than 1MB after compression. Choose a smaller image.');
  }
  return best;
};

const mapPayloadWithUploads = async (
  input: unknown,
  scope: ActionScope,
  rootId: string,
  manifest: ImageManifestItem[],
  options?: { signal?: AbortSignal }
): Promise<unknown> => {
  if (Array.isArray(input)) {
    const out: unknown[] = [];
    for (let i = 0; i < input.length; i += 1) {
      out.push(await mapPayloadWithUploads(input[i], scope, rootId, manifest, options));
      await yieldToUi();
    }
    return out;
  }

  if (input && typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      out[key] = await mapPayloadWithUploads(value, scope, rootId, manifest, options);
      await yieldToUi();
    }
    return out;
  }

  if (!isDataImage(input)) return input;

  const source = await dataUrlToBlob(input);
  const main = await compressForScope(source, scope);

  const imageId = randomId();
  const rootPath = getRootPath(scope, rootId);
  const basePath = `${rootPath}/${imageId}_main.${main.format === 'webp' ? 'webp' : 'jpg'}`;
  const bucket = getBucketByScope(scope);

  const mainUrl = await uploadBlobToStorage(bucket, basePath, main.blob, options?.signal);

  manifest.push(
    { path: `${bucket}/${basePath}`, url: mainUrl, kind: 'main', width: main.width, height: main.height, size: main.blob.size, originalSize: source.size, format: main.format, mime: main.blob.type || 'image/webp' }
  );

  return mainUrl;
};

export const preparePayloadWithImageManifest = async (
  input: unknown,
  scope: ActionScope,
  rootId: string,
  options?: { signal?: AbortSignal; allowUploadLater?: boolean }
): Promise<{ payload: unknown; imageManifest: ImageManifestItem[]; pendingUpload: boolean }> => {
  const imageManifest: ImageManifestItem[] = [];
  try {
    const payload = await mapPayloadWithUploads(input, scope, rootId, imageManifest, options);
    return { payload, imageManifest, pendingUpload: false };
  } catch (error) {
    if (options?.allowUploadLater) return { payload: input, imageManifest: [], pendingUpload: true };
    throw error;
  }
};

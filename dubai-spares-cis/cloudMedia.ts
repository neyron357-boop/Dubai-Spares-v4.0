const SUPABASE_URL = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined)?.trim() || 'https://jntgicfiehdprwhtjbuf.supabase.co';
const SUPABASE_ANON_KEY = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || 'sb_publishable_ZwcvMV3ccFi0xVapLOorsw_6wLL_9SC';

export type ImageManifestItem = {
  path: string;
  url: string | null;
  kind: 'main' | 'thumb';
  width: number;
  height: number;
  size: number;
  format: 'webp' | 'jpeg';
};

type ActionScope = 'backup' | 'quote' | 'lead';

const MAX_DIMENSION_BY_SCOPE: Record<ActionScope, number> = {
  backup: 1600,
  quote: 1200,
  lead: 1000
};

const qualitySteps = [0.72, 0.62, 0.52];

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

const getStoragePublicUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/images/${path}`;

const uploadBlobToStorage = async (path: string, blob: Blob, signal?: AbortSignal): Promise<string> => {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/images/${path}`, {
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

  return getStoragePublicUrl(path);
};

const isDataImage = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image');

const getRootPath = (scope: ActionScope, rootId: string): string => {
  if (scope === 'backup') return `backups/${rootId}`;
  if (scope === 'quote') return `quotes/${rootId}`;
  return `leads/${rootId}`;
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
    }
    return out;
  }

  if (!isDataImage(input)) return input;

  const source = await dataUrlToBlob(input);
  const maxDimension = MAX_DIMENSION_BY_SCOPE[scope];
  let best = await resizeAndEncode(source, maxDimension, qualitySteps[0]);
  for (const q of qualitySteps.slice(1)) {
    if (best.blob.size <= 250 * 1024) break;
    best = await resizeAndEncode(source, maxDimension, q);
  }

  const imageId = randomId();
  const basePath = `${getRootPath(scope, rootId)}/${imageId}_main.${best.format === 'webp' ? 'webp' : 'jpg'}`;
  const thumb = await resizeAndEncode(source, 480, 0.6);
  const thumbPath = `${getRootPath(scope, rootId)}/${imageId}_thumb.${thumb.format === 'webp' ? 'webp' : 'jpg'}`;

  const mainUrl = await uploadBlobToStorage(basePath, best.blob, options?.signal);
  const thumbUrl = await uploadBlobToStorage(thumbPath, thumb.blob, options?.signal);

  manifest.push(
    { path: basePath, url: mainUrl, kind: 'main', width: best.width, height: best.height, size: best.blob.size, format: best.format },
    { path: thumbPath, url: thumbUrl, kind: 'thumb', width: thumb.width, height: thumb.height, size: thumb.blob.size, format: thumb.format }
  );

  return mainUrl;
};

export const preparePayloadWithImageManifest = async (
  input: unknown,
  scope: ActionScope,
  rootId: string,
  options?: { signal?: AbortSignal; allowUploadLater?: boolean }
): Promise<{ payload: unknown; imageManifest: ImageManifestItem[]; pendingUpload: boolean }> => {
  const startedAt = performance.now();
  const imageManifest: ImageManifestItem[] = [];
  try {
    const payload = await mapPayloadWithUploads(input, scope, rootId, imageManifest, options);
    console.info('[cloudMedia] prepared', { scope, images: imageManifest.length, durationMs: Math.round(performance.now() - startedAt) });
    return { payload, imageManifest, pendingUpload: false };
  } catch (error) {
    if (options?.allowUploadLater) {
      console.warn('[cloudMedia] upload deferred', { scope, error: error instanceof Error ? error.message : String(error) });
      return { payload: input, imageManifest: [], pendingUpload: true };
    }
    throw error;
  }
};

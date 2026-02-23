import { SUPABASE_ANON_KEY, SUPABASE_URL, isCloudConfigured } from '../cloudConfig';
import { logger } from '../logging';

const configuredBucket = (import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined;
const BUCKET_CANDIDATES = [configuredBucket, 'images', 'order-images'].filter(
  (bucket, index, all): bucket is string => !!bucket && all.indexOf(bucket) === index
);

const MAX_IMAGE_DIMENSION = 1024;
const WEBP_QUALITY = 0.55;
const TARGET_BYTES = 300 * 1024; // ~10x compression target for typical 3 MB photos
const STORAGE_UPLOAD_RETRY_DELAYS_MS = [600, 1600];

type ImageTransformOptions = {
  width?: number;
  quality?: number;
};

const isBucketNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { message?: unknown; statusCode?: unknown; status?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
  const status = String(maybeError.statusCode ?? maybeError.status ?? '');

  return message.includes('bucket not found') || status === '404';
};

const isTransientStorageUploadError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { message?: unknown; statusCode?: unknown; status?: unknown; name?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
  const status = String(maybeError.statusCode ?? maybeError.status ?? '');
  const name = typeof maybeError.name === 'string' ? maybeError.name.toLowerCase() : '';

  if (name.includes('abort') || message.includes('network') || message.includes('load failed')) return true;
  return status === '408' || status === '429' || status === '502' || status === '503' || status === '504';
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toBlob = async (source: File | Blob | string): Promise<Blob> => {
  if (typeof source === 'string') {
    const response = await fetch(source);
    return response.blob();
  }

  return source;
};

const extensionFromBlob = (blob: Blob): string => {
  if (blob.type === 'image/webp') return 'webp';
  const [, ext] = (blob.type || '').split('/');
  return ext || 'jpg';
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for compression'));
    image.src = src;
  });

const computeTargetSize = (width: number, height: number) => {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas image compression failed'));
      }
    }, type, quality);
  });

const encodeCanvas = async (canvas: HTMLCanvasElement, quality: number): Promise<Blob> => {
  try {
    return await canvasToBlob(canvas, 'image/webp', quality);
  } catch {
    return canvasToBlob(canvas, 'image/jpeg', quality);
  }
};

const compressBlob = async (blob: Blob): Promise<Blob> => {
  if (typeof document === 'undefined') return blob;

  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(imageUrl);
    const { width, height } = computeTargetSize(image.naturalWidth || image.width, image.naturalHeight || image.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return blob;

    context.drawImage(image, 0, 0, width, height);

    // Adaptive multi-step: reduce quality until target size is met (≈10x compression)
    let result = await encodeCanvas(canvas, WEBP_QUALITY);
    for (const q of [0.45, 0.35]) {
      if (result.size <= TARGET_BYTES) break;
      result = await encodeCanvas(canvas, q);
    }
    return result;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const optimizeImageForUpload = async (
  source: File | Blob | string,
  label: string
): Promise<string> => {
  const originalBlob = await toBlob(source);
  const compressedBlob = await compressBlob(originalBlob);

  await logger.info('storage:compression', `${label} compressed`, {
    beforeBytes: originalBlob.size,
    afterBytes: compressedBlob.size,
    reductionBytes: originalBlob.size - compressedBlob.size,
    reductionPercent: originalBlob.size > 0
      ? Number((((originalBlob.size - compressedBlob.size) / originalBlob.size) * 100).toFixed(2))
      : 0
  });

  return blobToDataUrl(compressedBlob);
};

export const getOptimizedImageUrl = (imageUrl: string, options: ImageTransformOptions = {}): string => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }

  try {
    const parsed = new URL(imageUrl);
    const isSupabaseStorage = parsed.pathname.includes('/storage/v1/object/');
    if (!isSupabaseStorage) return imageUrl;

    const width = Math.round(options.width || 0);
    const quality = Math.round(options.quality || 0);

    if (width > 0) {
      parsed.searchParams.set('width', String(width));
    }

    if (quality > 0) {
      parsed.searchParams.set('quality', String(Math.min(100, Math.max(1, quality))));
    }

    return parsed.toString();
  } catch {
    return imageUrl;
  }
};

export const uploadImageToStorage = async (
  source: File | Blob | string,
  folder: string,
  fileName: string
): Promise<string> => {
  const blob = await toBlob(source);
  const compressed = await compressBlob(blob);
  const ext = extensionFromBlob(compressed);
  const path = `${folder}/${fileName}.${ext}`;

  if (!isCloudConfigured) {
    await logger.warn('storage:upload-skipped', 'Remote photo upload skipped: cloud not configured', {
      folder,
      fileName,
      sizeBytes: compressed.size
    });
    return `local://${path}`;
  }

  let lastError: unknown;
  for (const bucket of BUCKET_CANDIDATES) {
    for (let attempt = 0; attempt <= STORAGE_UPLOAD_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await wait(STORAGE_UPLOAD_RETRY_DELAYS_MS[attempt - 1]);
      }
      try {
        const response = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
          {
            method: 'POST',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'x-upsert': 'true',
              'Content-Type': compressed.type || 'image/webp'
            },
            body: compressed
          }
        );

        if (response.ok) {
          const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
          await logger.info('storage:upload-ok', `${folder}/${fileName} uploaded`, {
            bucket,
            path,
            beforeBytes: blob.size,
            afterBytes: compressed.size,
            reductionPercent: blob.size > 0
              ? Number((((blob.size - compressed.size) / blob.size) * 100).toFixed(2))
              : 0
          });
          return publicUrl;
        }

        const text = await response.text().catch(() => '');
        const err = new Error(`Upload failed ${response.status}: ${text.slice(0, 140)}`);
        if (isBucketNotFoundError({ message: text, status: response.status })) {
          lastError = err;
          break; // try next bucket
        }
        if (!isTransientStorageUploadError({ status: response.status })) {
          lastError = err;
          break;
        }
        lastError = err;
      } catch (error) {
        lastError = error;
        if (!isTransientStorageUploadError(error)) break;
      }
    }
  }

  await logger.warn('storage:upload-failed', 'Remote photo upload failed, falling back to local', {
    folder,
    fileName,
    error: String(lastError)
  });
  return `local://${path}`;
};

export const listStoragePathsRecursive = async (_bucket: string, _folder: string): Promise<string[]> => [];

const deleteStorageFiles = async (_bucket: string, _paths: string[]): Promise<void> => undefined;

const parseSupabasePublicStorageUrl = (imageUrl: string): { bucket: string; path: string } | null => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  try {
    const parsed = new URL(imageUrl);
    const marker = '/storage/v1/object/public/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const remainder = parsed.pathname.slice(markerIndex + marker.length);
    const firstSlash = remainder.indexOf('/');
    if (firstSlash <= 0) return null;
    const bucket = remainder.slice(0, firstSlash).trim();
    const path = decodeURIComponent(remainder.slice(firstSlash + 1)).trim();
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
};

export const recompressExistingStorageImage = async (imageUrl: string): Promise<boolean> => {
  const parsed = parseSupabasePublicStorageUrl(imageUrl);
  if (!parsed || !isCloudConfigured) return false;

  const originalResponse = await fetch(imageUrl);
  if (!originalResponse.ok) {
    throw new Error(`Failed to fetch original image ${originalResponse.status}`);
  }

  const originalBlob = await originalResponse.blob();
  if (!originalBlob.type.startsWith('image/')) return false;

  const compressedBlob = await compressBlob(originalBlob);
  const minimumReductionBytes = 120 * 1024;
  const reductionPercent = originalBlob.size > 0
    ? ((originalBlob.size - compressedBlob.size) / originalBlob.size) * 100
    : 0;

  if (compressedBlob.size >= originalBlob.size - minimumReductionBytes && reductionPercent < 20) {
    return false;
  }

  const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${parsed.bucket}/${parsed.path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-upsert': 'true',
      'Content-Type': compressedBlob.type || 'image/webp'
    },
    body: compressedBlob
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => '');
    throw new Error(`Failed to upload compressed image ${uploadResponse.status}: ${text.slice(0, 120)}`);
  }

  await logger.info('storage:recompress-existing', 'Recompressed existing storage image', {
    bucket: parsed.bucket,
    path: parsed.path,
    beforeBytes: originalBlob.size,
    afterBytes: compressedBlob.size,
    reductionPercent: Number(reductionPercent.toFixed(2))
  });

  return true;
};

export const deleteOrderFolderFromStorage = async (orderId: string): Promise<void> => {
  await logger.info('storage:cleanup', `[INFO] Storage cleanup skipped (local-first mode) for order ${orderId}.`);
};

export const ensurePublicImageUrls = async (
  images: string[],
  folder: string,
  options?: { skipUpload?: boolean }
): Promise<string[]> => {
  if (!images.length) return [];
  if (options?.skipUpload) return [];

  const uploaded = await Promise.all(
    images.map(async (image, index) => {
      if (image.startsWith('http://') || image.startsWith('https://')) {
        return image;
      }

      if (!image.startsWith('data:image')) {
        return image;
      }

      try {
        return await uploadImageToStorage(image, folder, `${Date.now()}-${index}`);
      } catch (error) {
        if (isBucketNotFoundError(error)) {
          return image;
        }

        throw error;
      }
    })
  );

  return uploaded;
};

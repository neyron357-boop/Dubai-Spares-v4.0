import { logger } from '../logging';
import { supabase } from '../supabaseClient';

const configuredBucket = (import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined;
const BUCKET_CANDIDATES = [configuredBucket, 'images', 'order-images'].filter(
  (bucket, index, all): bucket is string => !!bucket && all.indexOf(bucket) === index
);

const MAX_IMAGE_DIMENSION = 1200;
const JPEG_QUALITY = 0.7;

const isBucketNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { message?: unknown; statusCode?: unknown; status?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
  const status = String(maybeError.statusCode ?? maybeError.status ?? '');

  return message.includes('bucket not found') || status === '404';
};

const toBlob = async (source: File | Blob | string): Promise<Blob> => {
  if (typeof source === 'string') {
    const response = await fetch(source);
    return response.blob();
  }

  return source;
};

const extensionFromBlob = (blob: Blob): string => {
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
    return await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
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

export const uploadImageToStorage = async (
  source: File | Blob | string,
  folder: string,
  fileName: string
): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const blob = await toBlob(source);
  const ext = extensionFromBlob(blob);
  const path = `${folder}/${fileName}.${ext}`;

  for (const bucket of BUCKET_CANDIDATES) {
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'image/jpeg'
    });

    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    }

    if (!isBucketNotFoundError(error)) {
      throw error;
    }
  }

  throw new Error(
    `Supabase storage bucket not found. Tried: ${BUCKET_CANDIDATES.join(', ') || 'no buckets configured'}`
  );
};

export const listStoragePathsRecursive = async (bucket: string, folder: string): Promise<string[]> => {
  if (!supabase) return [];

  const collected: string[] = [];
  const walk = async (prefix: string): Promise<void> => {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw error;
    if (!data?.length) return;

    for (const item of data) {
      const itemPath = `${prefix}/${item.name}`;
      if (item.id) {
        collected.push(itemPath);
      } else {
        await walk(itemPath);
      }
    }
  };

  await walk(folder);
  return collected;
};

const deleteStorageFiles = async (bucket: string, paths: string[]): Promise<void> => {
  if (!supabase || !paths.length) return;

  const chunkSize = 100;
  for (let index = 0; index < paths.length; index += chunkSize) {
    const chunk = paths.slice(index, index + chunkSize);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) throw error;
  }
};

export const deleteOrderFolderFromStorage = async (orderId: string): Promise<void> => {
  if (!supabase) return;

  let deleted = 0;
  for (const bucket of BUCKET_CANDIDATES) {
    try {
      const folder = `orders/${orderId}`;
      const paths = await listStoragePathsRecursive(bucket, folder);
      await deleteStorageFiles(bucket, paths);
      deleted += paths.length;
    } catch (error) {
      if (!isBucketNotFoundError(error)) {
        throw error;
      }
    }
  }

  await logger.info('storage:cleanup', `[INFO] Storage cleanup: Deleted ${deleted} files for order ${orderId}.`);
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

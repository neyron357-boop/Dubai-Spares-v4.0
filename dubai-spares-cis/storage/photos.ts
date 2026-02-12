import { logger } from '../logging';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/imageCompression';

const configuredBucket = (import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined;
const BUCKET_CANDIDATES = [configuredBucket, 'images', 'order-images'].filter(
  (bucket, index, all): bucket is string => !!bucket && all.indexOf(bucket) === index
);

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

export const optimizeImageForUpload = async (
  source: File | Blob | string,
  label: string
): Promise<string> => {
  const originalBlob = await toBlob(source);
  const originalType = originalBlob.type || 'image/jpeg';
  const originalName = source instanceof File ? source.name : `image-${Date.now()}.${extensionFromBlob(originalBlob)}`;

  const fileForCompression = source instanceof File
    ? source
    : new File([originalBlob], originalName, { type: originalType, lastModified: Date.now() });

  const compressedFile = await compressImage(fileForCompression);

  await logger.info('storage:compression', `${label} compressed`, {
    beforeBytes: originalBlob.size,
    afterBytes: compressedFile.size,
    reductionBytes: originalBlob.size - compressedFile.size,
    reductionPercent: originalBlob.size > 0
      ? Number((((originalBlob.size - compressedFile.size) / originalBlob.size) * 100).toFixed(2))
      : 0
  });

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(compressedFile);
  });
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
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const blob = await toBlob(source);
  const ext = extensionFromBlob(blob);
  const path = `${folder}/${fileName}.${ext}`;

  for (const bucket of BUCKET_CANDIDATES) {
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'image/webp'
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
        const optimizedImage = await optimizeImageForUpload(image, `upload:${folder}[${index}]`);
        return await uploadImageToStorage(optimizedImage, folder, `${Date.now()}-${index}`);
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

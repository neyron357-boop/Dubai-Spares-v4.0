import { supabase } from '../supabaseClient';

const configuredBucket = (import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined;
const BUCKET_CANDIDATES = [configuredBucket, 'images', 'order-images'].filter(
  (bucket, index, all): bucket is string => !!bucket && all.indexOf(bucket) === index
);

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

export const ensurePublicImageUrls = async (
  images: string[],
  folder: string
): Promise<string[]> => {
  if (!images.length) return [];

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
          // Keep the local image value so order sync can continue even when storage is not provisioned.
          return image;
        }

        throw error;
      }
    })
  );

  return uploaded;
};

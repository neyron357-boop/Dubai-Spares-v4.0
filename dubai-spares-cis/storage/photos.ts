import { supabase } from '../supabaseClient';

const BUCKET = 'images';

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

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg'
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
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

      return uploadImageToStorage(image, folder, `${Date.now()}-${index}`);
    })
  );

  return uploaded;
};

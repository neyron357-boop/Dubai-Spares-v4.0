import { supabase } from '../supabaseClient';

const BUCKET = 'order-photos';

const base64ToBlob = async (base64: string): Promise<Blob> => {
  const res = await fetch(base64);
  return await res.blob();
};

export const uploadBase64Photo = async (base64: string, folder: string, filename: string): Promise<string> => {
  if (!supabase) throw new Error('Supabase not configured');

  const blob = await base64ToBlob(base64);
  const ext = blob.type.split('/')[1] || 'jpg';
  const path = `${folder}/${filename}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg'
  });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

export const uploadManyBase64Photos = async (photos: string[], folder: string): Promise<string[]> => {
  const uploaded = await Promise.all(
    photos.map((base64, index) => uploadBase64Photo(base64, folder, `${Date.now()}-${index}`))
  );
  return uploaded;
};

export const replaceBase64WithUrls = async (photos: string[], folder: string): Promise<string[]> => {
  const remoteUrls = photos.filter((p) => p.startsWith('http'));
  const base64Photos = photos.filter((p) => p.startsWith('data:image'));
  const uploaded = await uploadManyBase64Photos(base64Photos, folder);
  return [...remoteUrls, ...uploaded];
};

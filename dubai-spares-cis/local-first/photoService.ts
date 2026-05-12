import { LocalPhoto, PhotoMimeType } from './types';

export interface PhotoCompressionOptions {
  maxSidePx?: number;
  quality?: number;
  preferredMimeType?: PhotoMimeType;
}

const DEFAULT_OPTIONS: Required<PhotoCompressionOptions> = {
  maxSidePx: 1600,
  quality: 0.78,
  preferredMimeType: 'image/jpeg'
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode canvas image'));
    }, type, quality);
  });

const loadImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to load image'));
    };

    image.src = url;
  });

export const compressImageForStorage = async (
  file: File,
  options: PhotoCompressionOptions = {}
): Promise<Pick<LocalPhoto, 'mimeType' | 'blob' | 'width' | 'height' | 'sizeBytes'>> => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const image = await loadImageElement(file);
  const scale = Math.min(1, config.maxSidePx / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');

  ctx.drawImage(image, 0, 0, width, height);

  let mimeType: PhotoMimeType = config.preferredMimeType;
  let blob: Blob;

  try {
    blob = await canvasToBlob(canvas, config.preferredMimeType, config.quality);
    mimeType = config.preferredMimeType;
  } catch {
    blob = await canvasToBlob(canvas, 'image/jpeg', config.quality);
    mimeType = 'image/jpeg';
  }

  return {
    mimeType,
    blob,
    width,
    height,
    sizeBytes: blob.size
  };
};

export const createObjectUrl = (blob: Blob): string => URL.createObjectURL(blob);
export const revokeObjectUrl = (url: string): void => URL.revokeObjectURL(url);

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert blob to base64'));
    reader.readAsDataURL(blob);
  });

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const dataUrl = await readAsDataUrl(blob);
  const [, base64 = ''] = dataUrl.split(',', 2);
  return base64;
};

export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
};

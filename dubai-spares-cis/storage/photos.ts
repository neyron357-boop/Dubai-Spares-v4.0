import { logger } from '../logging';

const MAX_IMAGE_DIMENSION = 1200;
const WEBP_QUALITY = 0.72;

type ImageTransformOptions = {
  width?: number;
  quality?: number;
};

const toBlob = async (source: File | Blob | string): Promise<Blob> => {
  if (typeof source === 'string') {
    if (!source.startsWith('data:')) throw new Error('Only data URLs are supported in local mode');
    const response = await fetch(source);
    return response.blob();
  }

  return source;
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
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas image compression failed'));
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
    return await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const optimizeImageForUpload = async (source: File | Blob | string, label: string): Promise<string> => {
  const originalBlob = await toBlob(source);
  const compressedBlob = await compressBlob(originalBlob);

  await logger.info('storage:compression', `${label} compressed`, {
    beforeBytes: originalBlob.size,
    afterBytes: compressedBlob.size
  });

  return blobToDataUrl(compressedBlob);
};

export const getOptimizedImageUrl = (imageUrl: string, _options: ImageTransformOptions = {}): string => imageUrl;

export const uploadImageToStorage = async (source: File | Blob | string): Promise<string> => {
  return optimizeImageForUpload(source, 'local-image');
};

export const listStoragePathsRecursive = async (_bucket: string, _folder: string): Promise<string[]> => [];
export const deleteOrderFolderFromStorage = async (_orderId: string): Promise<void> => {};

export const ensurePublicImageUrls = async (images: string[]): Promise<string[]> => images;

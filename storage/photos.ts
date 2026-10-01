import { logger } from '../logging';
const MAX_IMAGE_DIMENSION = 1024;

const WEBP_QUALITY = 0.55;

const TARGET_BYTES = 200 * 1024;

const toBlob = async (source: File | Blob | string): Promise<Blob> => {
  if (typeof source === 'string') {
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

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas image compression failed'));
        }
      },
      type,
      quality,
    );
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
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return blob;

    const dimensionCaps = [MAX_IMAGE_DIMENSION, 900, 768];
    const qualitySteps = [WEBP_QUALITY, 0.45, 0.35, 0.26, 0.2, 0.14];

    let best = blob;
    for (const cap of dimensionCaps) {
      const scale = Math.min(1, cap / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const encoded = await encodeCanvas(canvas, quality);
        if (encoded.size < best.size) {
          best = encoded;
        }
        if (best.size <= TARGET_BYTES) {
          return best;
        }
      }
    }

    return best;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const optimizeLocalImage = async (
  source: File | Blob | string,
  label: string,
): Promise<string> => {
  const originalBlob = await toBlob(source);
  const compressedBlob = await compressBlob(originalBlob);

  await logger.info('storage:compression', `${label} compressed`, {
    beforeBytes: originalBlob.size,
    afterBytes: compressedBlob.size,
    reductionBytes: originalBlob.size - compressedBlob.size,
    reductionPercent:
      originalBlob.size > 0
        ? Number((((originalBlob.size - compressedBlob.size) / originalBlob.size) * 100).toFixed(2))
        : 0,
  });

  return blobToDataUrl(compressedBlob);
};

export const getOptimizedImageUrl = (
  url: string,
  _options?: { width?: number; quality?: number },
) => url;
export const saveLocalImage = async (
  source: File | Blob | string,
  _path?: string,
  _options?: unknown,
): Promise<string> => {
  if (typeof source === 'string' && /^https?:/i.test(source)) return source;
  return optimizeLocalImage(source, 'local-image');
};
export const saveLocalFile = async (file: File | Blob, _path?: string): Promise<string> =>
  blobToDataUrl(file);
export const prepareLocalImageUrls = async (
  images: string[],
  _path?: string,
): Promise<string[]> => [...new Set(images.filter(Boolean))];

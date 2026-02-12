const MAX_SIZE_MB = 0.8;
const MAX_WIDTH_OR_HEIGHT = 1600;
const INITIAL_QUALITY = 0.8;
const FALLBACK_FILE_TYPE = 'image/webp';

type BrowserImageCompressionFn = (
  file: File,
  options: {
    maxSizeMB: number;
    maxWidthOrHeight: number;
    useWebWorker: boolean;
    initialQuality: number;
    fileType: string;
  }
) => Promise<File | Blob>;

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
    image.onerror = () => reject(new Error('Failed to load image for compression fallback'));
    image.src = src;
  });

const computeTargetSize = (width: number, height: number) => {
  const scale = Math.min(1, MAX_WIDTH_OR_HEIGHT / Math.max(width, height));
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

const compressWithCanvasFallback = async (file: File): Promise<Blob> => {
  const src = await blobToDataUrl(file);
  const image = await loadImage(src);
  const { width, height } = computeTargetSize(image.naturalWidth || image.width, image.naturalHeight || image.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = INITIAL_QUALITY;
  let compressed = await canvasToBlob(canvas, FALLBACK_FILE_TYPE, quality);
  const maxBytes = MAX_SIZE_MB * 1024 * 1024;

  while (compressed.size > maxBytes && quality > 0.4) {
    quality = Number((quality - 0.1).toFixed(2));
    compressed = await canvasToBlob(canvas, FALLBACK_FILE_TYPE, quality);
  }

  return compressed;
};

const loadBrowserImageCompression = async (): Promise<BrowserImageCompressionFn | null> => {
  try {
    const moduleName = 'browser-image-compression';
    const module = await import(/* @vite-ignore */ moduleName);
    return (module?.default || module) as BrowserImageCompressionFn;
  } catch {
    return null;
  }
};

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  if (typeof document === 'undefined') {
    return file;
  }

  const options = {
    maxSizeMB: MAX_SIZE_MB,
    maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT,
    useWebWorker: true,
    initialQuality: INITIAL_QUALITY,
    fileType: FALLBACK_FILE_TYPE
  } as const;

  const imageCompression = await loadBrowserImageCompression();

  try {
    const compressed = imageCompression
      ? await imageCompression(file, options)
      : await compressWithCanvasFallback(file);

    return new File([compressed], file.name.replace(/\.[^.]+$/, '.webp'), {
      type: compressed.type || FALLBACK_FILE_TYPE,
      lastModified: Date.now()
    });
  } catch (error) {
    console.error('Image compression failed', error);
    return file;
  }
}

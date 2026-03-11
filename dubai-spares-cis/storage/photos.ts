import { SUPABASE_ANON_KEY, SUPABASE_URL, isCloudConfigured } from '../cloudConfig';
import { logger } from '../logging';
import { markBrokenImageUrl, shouldBlacklistByStatus } from './brokenImageBlacklist';

const configuredBucket = (import.meta as any).env?.VITE_SUPABASE_STORAGE_BUCKET as string | undefined;
const BUCKET_CANDIDATES = [configuredBucket, 'images', 'order-images'].filter(
  (bucket, index, all): bucket is string => !!bucket && all.indexOf(bucket) === index
);

const MAX_IMAGE_DIMENSION = 1024;
const WEBP_QUALITY = 0.55;
const TARGET_BYTES = 200 * 1024; // aggressive compression target (~1 MB -> ~200 KB)
const STORAGE_UPLOAD_RETRY_DELAYS_MS = [600, 1600];
const STORAGE_LIST_PAGE_SIZE = 100;
const MAINTENANCE_CONCURRENCY = Math.min(16, Math.max(8, (typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency)) || 8));

type ImageTransformOptions = {
  width?: number;
  quality?: number;
};

type StorageObjectEntry = {
  path: string;
  size: number;
  mimetype: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StorageImageEntry = {
  bucket: string;
  path: string;
  size: number;
  mimetype: string;
  publicUrl: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StorageMaintenanceResult = {
  scanned: number;
  imageFiles: number;
  deduplicated: number;
  compressed: number;
  bytesSaved: number;
  failures: number;
  dedupMappings: Array<{ bucket: string; canonicalPath: string; duplicatePath: string; size: number }>;
};

export type StorageMaintenanceProgress = {
  phase: 'scan' | 'deduplicate' | 'compress' | 'delete' | 'done';
  bucket: string;
  processed: number;
  total: number;
  imageFiles: number;
  deduplicated: number;
  compressed: number;
  failures: number;
  bytesSaved: number;
  currentPath?: string;
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

const buildStorageHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
});

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

const compressBlobAggressive = async (blob: Blob): Promise<Blob> => {
  if (typeof document === 'undefined') return blob;

  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(imageUrl);
    const scale = Math.min(1, 900 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return blob;

    context.drawImage(image, 0, 0, width, height);
    let result = await encodeCanvas(canvas, 0.34);
    for (const q of [0.26, 0.2, 0.14]) {
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
  const normalizedName = fileName.trim();
  const hasKnownExtension = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(normalizedName);
  const path = `${folder}/${hasKnownExtension ? normalizedName : `${normalizedName}.${ext}`}`;

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
  if (typeof source === 'string' && source.startsWith('data:image')) {
    return source;
  }
  return `local://${path}`;
};

export const uploadFileToStorage = async (
  source: File | Blob | string,
  folder: string,
  fileName: string,
  mimeType?: string
): Promise<string> => {
  const blob = await toBlob(source);
  const normalizedName = fileName.trim();
  const path = `${folder}/${normalizedName}`;

  if (!isCloudConfigured) {
    await logger.warn('storage:file-upload-skipped', 'Remote file upload skipped: cloud not configured', {
      folder,
      fileName,
      sizeBytes: blob.size
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
              'Content-Type': mimeType || blob.type || 'application/octet-stream'
            },
            body: blob
          }
        );

        if (response.ok) {
          const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
          await logger.info('storage:file-upload-ok', `${folder}/${fileName} uploaded`, {
            bucket,
            path,
            bytes: blob.size,
            mimeType: mimeType || blob.type || 'application/octet-stream'
          });
          return publicUrl;
        }

        const text = await response.text().catch(() => '');
        const err = new Error(`Upload failed ${response.status}: ${text.slice(0, 140)}`);
        if (isBucketNotFoundError({ message: text, status: response.status })) {
          lastError = err;
          break;
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

  await logger.warn('storage:file-upload-failed', 'Remote file upload failed, falling back to local', {
    folder,
    fileName,
    error: String(lastError)
  });
  return `local://${path}`;
};

const listStorageObjectsRecursive = async (bucket: string, folder = ''): Promise<StorageObjectEntry[]> => {
  if (!isCloudConfigured) return [];

  const normalizedPrefix = folder.replace(/^\/+/, '').trim();
  const foldersQueue = [normalizedPrefix];
  const entries: StorageObjectEntry[] = [];

  while (foldersQueue.length > 0) {
    const prefix = foldersQueue.shift() || '';
    let offset = 0;

    while (true) {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: {
          ...buildStorageHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prefix,
          limit: STORAGE_LIST_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' }
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Storage list failed ${response.status}: ${text.slice(0, 140)}`);
      }

      const page = (await response.json().catch(() => [])) as Array<{ name?: string; id?: string | null; metadata?: { size?: number; mimetype?: string } | null; created_at?: string; updated_at?: string; last_accessed_at?: string }>;
      if (!Array.isArray(page) || page.length === 0) break;

      for (const item of page) {
        const name = String(item?.name || '').trim();
        if (!name) continue;

        const childPath = prefix ? `${prefix}/${name}` : name;
        if (!item?.id) {
          foldersQueue.push(childPath);
          continue;
        }

        entries.push({
          path: childPath,
          size: Math.max(0, Number(item.metadata?.size || 0)),
          mimetype: String(item.metadata?.mimetype || ''),
          createdAt: typeof item.created_at === 'string' ? item.created_at : undefined,
          updatedAt: typeof item.updated_at === 'string' ? item.updated_at : (typeof item.last_accessed_at === 'string' ? item.last_accessed_at : undefined)
        });
      }

      if (page.length < STORAGE_LIST_PAGE_SIZE) break;
      offset += page.length;
    }
  }

  return entries;
};

export const listStoragePathsRecursive = async (bucket: string, folder: string): Promise<string[]> => {
  const objects = await listStorageObjectsRecursive(bucket, folder);
  return objects.map((entry) => entry.path);
};

export const listAllStorageImages = async (): Promise<StorageImageEntry[]> => {
  if (!isCloudConfigured) return [];

  const result: StorageImageEntry[] = [];
  for (const bucket of BUCKET_CANDIDATES) {
    let objects: StorageObjectEntry[] = [];
    try {
      objects = await listStorageObjectsRecursive(bucket, '');
    } catch {
      continue;
    }

    objects
      .filter((entry) => isImagePath(entry.path, entry.mimetype))
      .forEach((entry) => {
        result.push({
          bucket,
          path: entry.path,
          size: Math.max(0, Number(entry.size || 0)),
          mimetype: entry.mimetype,
          publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${entry.path}`,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        });
      });
  }

  return result;
};

const deleteStorageFiles = async (bucket: string, paths: string[]): Promise<void> => {
  if (!paths.length) return;

  const batchResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: {
      ...buildStorageHeaders(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefixes: paths })
  });

  if (batchResponse.ok) return;

  for (const path of paths) {
    const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`, {
      method: 'DELETE',
      headers: buildStorageHeaders()
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`Storage delete failed ${response.status}: ${text.slice(0, 140)}`);
    }
  }
};

const isImagePath = (path: string, mimetype: string): boolean => {
  if (mimetype.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(path);
};

const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
};

const buildVisualSignature = async (blob: Blob): Promise<string | null> => {
  if (typeof document === 'undefined') return null;

  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(imageUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const rawHash = await sha256Hex(rgba.buffer);
    return `${width}x${height}:${rawHash}`;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

export const runStorageImageMaintenance = async (options: {
  deduplicateByExactSize?: boolean;
  applyDedupDeletes?: boolean;
  recompressAll?: boolean;
  onProgress?: (progress: StorageMaintenanceProgress) => void;
} = {}): Promise<StorageMaintenanceResult> => {
  const result: StorageMaintenanceResult = {
    scanned: 0,
    imageFiles: 0,
    deduplicated: 0,
    compressed: 0,
    bytesSaved: 0,
    failures: 0,
    dedupMappings: []
  };

  const emitProgress = (progress: Omit<StorageMaintenanceProgress, 'imageFiles' | 'deduplicated' | 'compressed' | 'failures' | 'bytesSaved'>) => {
    options.onProgress?.({
      ...progress,
      imageFiles: result.imageFiles,
      deduplicated: result.deduplicated,
      compressed: result.compressed,
      failures: result.failures,
      bytesSaved: result.bytesSaved
    });
  };

  if (!isCloudConfigured) {
    throw new Error('Cloud storage is not configured.');
  }

  for (const bucket of BUCKET_CANDIDATES) {
    let objects: StorageObjectEntry[] = [];
    try {
      objects = await listStorageObjectsRecursive(bucket, '');
      emitProgress({ phase: 'scan', bucket, processed: objects.length, total: objects.length });
    } catch (error) {
      await logger.warn('storage:maintenance', 'Failed to scan storage bucket', { bucket, error: String(error) });
      result.failures += 1;
      continue;
    }

    result.scanned += objects.length;
    const imageObjects = objects.filter((item) => isImagePath(item.path, item.mimetype));
    result.imageFiles += imageObjects.length;

    const deletedPaths = new Set<string>();
    if (options.deduplicateByExactSize) {
      let dedupProcessed = 0;
      const signatureGroups = new Map<string, StorageObjectEntry[]>();
      const hashCache = new Map<string, string>();

      const fileSignature = async (path: string): Promise<string> => {
        const cached = hashCache.get(path);
        if (cached) return cached;
        const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`, {
          method: 'GET',
          headers: buildStorageHeaders()
        });
        if (!response.ok) throw new Error(`download ${response.status}`);
        const blob = await response.blob();
        const visual = await buildVisualSignature(blob);
        if (visual) {
          hashCache.set(path, `visual:${visual}`);
          return `visual:${visual}`;
        }

        const buffer = await blob.arrayBuffer();
        const binaryHash = await sha256Hex(buffer);
        const fallback = `binary:${binaryHash}`;
        hashCache.set(path, fallback);
        return fallback;
      };

      await runWithConcurrency(imageObjects, MAINTENANCE_CONCURRENCY, async (entry) => {
        dedupProcessed += 1;
        emitProgress({ phase: 'deduplicate', bucket, processed: dedupProcessed, total: imageObjects.length, currentPath: entry.path });
        try {
          const signature = await fileSignature(entry.path);
          const list = signatureGroups.get(signature) || [];
          list.push(entry);
          signatureGroups.set(signature, list);
        } catch (error) {
          result.failures += 1;
          await logger.warn('storage:maintenance', 'Failed to hash image for deduplication', {
            bucket,
            path: entry.path,
            error: String(error)
          });
        }
      });

      for (const [, signatureGroup] of signatureGroups) {
        if (signatureGroup.length < 2) continue;

        const sortedByPreferredCanonical = [...signatureGroup].sort((a, b) => {
          if (a.size !== b.size) return a.size - b.size;
          return a.path.localeCompare(b.path);
        });

        const canonical = sortedByPreferredCanonical[0];
        const duplicatesToRemove = sortedByPreferredCanonical.filter((entry) => entry.path !== canonical.path);
        duplicatesToRemove.forEach((entry) => {
          result.dedupMappings.push({
            bucket,
            canonicalPath: canonical.path,
            duplicatePath: entry.path,
            size: entry.size
          });
        });
      }

      if (options.applyDedupDeletes !== false && result.dedupMappings.length > 0) {
        const duplicatesToDelete = result.dedupMappings
          .filter((mapping) => mapping.bucket === bucket)
          .map((mapping) => mapping.duplicatePath);
        let deleted = 0;
        const duplicateSizeMap = new Map(result.dedupMappings.filter((mapping) => mapping.bucket === bucket).map((mapping) => [mapping.duplicatePath, mapping.size]));
        for (let offset = 0; offset < duplicatesToDelete.length; offset += 20) {
          const chunk = duplicatesToDelete.slice(offset, offset + 20);
          emitProgress({ phase: 'delete', bucket, processed: deleted, total: duplicatesToDelete.length, currentPath: chunk[0] });
          try {
            await deleteStorageFiles(bucket, chunk);
            chunk.forEach((path) => {
              deleted += 1;
              deletedPaths.add(path);
              const size = duplicateSizeMap.get(path) || 0;
              result.bytesSaved += size;
              result.deduplicated += 1;
            });
          } catch (error) {
            result.failures += chunk.length;
            await logger.warn('storage:maintenance', 'Failed to delete duplicate batch', { bucket, chunkSize: chunk.length, error: String(error) });
          }
        }
      }
    }

    if (!options.recompressAll) continue;

    const compressQueue = imageObjects.filter((image) => !deletedPaths.has(image.path));
    let compressedProcessed = 0;
    await runWithConcurrency(compressQueue, MAINTENANCE_CONCURRENCY, async (image) => {
      compressedProcessed += 1;
      emitProgress({ phase: 'compress', bucket, processed: compressedProcessed, total: compressQueue.length, currentPath: image.path });

      try {
        const encodedPath = image.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const downloadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`, {
          method: 'GET',
          headers: buildStorageHeaders()
        });
        if (!downloadResponse.ok) {
          if (shouldBlacklistByStatus(downloadResponse.status)) {
            markBrokenImageUrl(`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${image.path}`);
            return;
          }
          throw new Error(`download ${downloadResponse.status}`);
        }

        const originalBlob = await downloadResponse.blob();
        if (!originalBlob.type.startsWith('image/') && !isImagePath(image.path, originalBlob.type)) return;
        const compressedBlob = await compressBlobAggressive(originalBlob);
        if (compressedBlob.size >= originalBlob.size) return;

        const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`, {
          method: 'POST',
          headers: {
            ...buildStorageHeaders(),
            'x-upsert': 'true',
            'Content-Type': compressedBlob.type || 'image/webp'
          },
          body: compressedBlob
        });
        if (!uploadResponse.ok) {
          throw new Error(`upload ${uploadResponse.status}`);
        }

        result.compressed += 1;
        result.bytesSaved += Math.max(0, originalBlob.size - compressedBlob.size);
      } catch (error) {
        result.failures += 1;
        await logger.warn('storage:maintenance', 'Failed to recompress image', {
          bucket,
          path: image.path,
          error: String(error)
        });
      }
    });
  }

  emitProgress({ phase: 'done', bucket: 'all', processed: result.scanned, total: result.scanned });

  return result;
};

export const deleteStorageDuplicateMappings = async (
  mappings: Array<{ bucket: string; duplicatePath: string }>,
  onProgress?: (progress: { processed: number; total: number; bucket: string; path: string }) => void
): Promise<{ deleted: number; failures: number }> => {
  let deleted = 0;
  let failures = 0;
  for (let index = 0; index < mappings.length; index++) {
    const mapping = mappings[index];
    onProgress?.({ processed: index, total: mappings.length, bucket: mapping.bucket, path: mapping.duplicatePath });
    try {
      await deleteStorageFiles(mapping.bucket, [mapping.duplicatePath]);
      deleted += 1;
    } catch {
      failures += 1;
    }
  }
  return { deleted, failures };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) => {
  if (!items.length) return;
  let cursor = 0;
  const size = Math.max(1, concurrency);
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current], current);
    }
  }));
};

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

export const deleteStorageImageByPublicUrl = async (imageUrl: string): Promise<boolean> => {
  const parsed = parseSupabasePublicStorageUrl(imageUrl);
  if (!parsed || !isCloudConfigured) return false;
  await deleteStorageFiles(parsed.bucket, [parsed.path]);
  return true;
};

export const recompressExistingStorageImage = async (imageUrl: string): Promise<boolean> => {
  const parsed = parseSupabasePublicStorageUrl(imageUrl);
  if (!parsed || !isCloudConfigured) return false;

  let originalResponse = await fetch(imageUrl);
  if (!originalResponse.ok) {
    if (shouldBlacklistByStatus(originalResponse.status)) {
      markBrokenImageUrl(imageUrl);
      return false;
    }
    const encodedPath = parsed.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    originalResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${parsed.bucket}/${encodedPath}`, {
      headers: buildStorageHeaders()
    });
  }
  if (!originalResponse.ok) {
    if (shouldBlacklistByStatus(originalResponse.status)) {
      markBrokenImageUrl(imageUrl);
      return false;
    }
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
  if (!isCloudConfigured) {
    await logger.info('storage:cleanup', `[INFO] Storage cleanup skipped (cloud storage disabled) for order ${orderId}.`);
    return;
  }

  const folder = `orders/${orderId}`;
  let deleted = 0;

  for (const bucket of BUCKET_CANDIDATES) {
    try {
      const paths = await listStoragePathsRecursive(bucket, folder);
      if (!paths.length) continue;
      await deleteStorageFiles(bucket, paths);
      deleted += paths.length;
    } catch (error) {
      await logger.warn('storage:cleanup', 'Failed to cleanup order folder in storage bucket', {
        orderId,
        bucket,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await logger.info('storage:cleanup', 'Storage cleanup completed for order', { orderId, deleted });
};

export const ensurePublicImageUrls = async (
  images: string[],
  folder: string,
  options?: { skipUpload?: boolean; fileNames?: string[]; cleanupExtraFiles?: boolean }
): Promise<string[]> => {
  await logger.info('storage:ensure-public-start', 'Normalizing image URLs for persistence', {
    folder,
    total: images.length,
    skipUpload: !!options?.skipUpload,
    cleanupExtraFiles: !!options?.cleanupExtraFiles,
    localUrls: images.filter((image) => String(image || '').startsWith('local://')).length,
    dataUrls: images.filter((image) => String(image || '').startsWith('data:image')).length,
    remoteUrls: images.filter((image) => /^https?:\/\//i.test(String(image || ''))).length
  });

  if (options?.skipUpload) return [];

  if (!images.length) {
    await logger.info('storage:ensure-public-done', 'Image URLs normalized for persistence', {
      folder,
      total: images.length,
      uploadedRemote: 0,
      remainingLocal: 0,
      remainingData: 0
    });

    if (options?.cleanupExtraFiles && isCloudConfigured) {
      for (const bucket of BUCKET_CANDIDATES) {
        try {
          const remote = await listStoragePathsRecursive(bucket, folder);
          for (let offset = 0; offset < remote.length; offset += 20) {
            await deleteStorageFiles(bucket, remote.slice(offset, offset + 20));
          }
        } catch (error) {
          await logger.warn('storage:cleanup-extra-files', 'Failed to cleanup folder after image removal', {
            bucket,
            folder,
            error: String(error)
          });
        }
      }
    }
    return [];
  }

  const uploaded = await Promise.all(
    images.map(async (image, index) => {
      if (image.startsWith('http://') || image.startsWith('https://')) {
        return image;
      }

      if (image.startsWith('local://')) {
        await logger.warn('storage:ensure-public-local', 'Local-only image URL detected; this image can break after restart/deploy', {
          folder,
          index,
          image
        });
        return image;
      }

      if (!image.startsWith('data:image')) {
        return image;
      }

      try {
        const fallbackName = `${Date.now()}-${index}`;
        const fileName = options?.fileNames?.[index] || fallbackName;
        return await uploadImageToStorage(image, folder, fileName);
      } catch (error) {
        if (isBucketNotFoundError(error)) {
          return image;
        }

        throw error;
      }
    })
  );

  await logger.info('storage:ensure-public-done', 'Image URLs normalized for persistence', {
    folder,
    total: images.length,
    uploadedRemote: uploaded.filter((url) => /^https?:\/\//i.test(String(url || ''))).length,
    remainingLocal: uploaded.filter((url) => String(url || '').startsWith('local://')).length,
    remainingData: uploaded.filter((url) => String(url || '').startsWith('data:image')).length
  });

  if (options?.cleanupExtraFiles && isCloudConfigured) {
    for (const bucket of BUCKET_CANDIDATES) {
      try {
        const currentPaths = new Set(
          uploaded
            .map((url) => parseSupabasePublicStorageUrl(url))
            .filter((entry): entry is { bucket: string; path: string } => !!entry && entry.bucket === bucket)
            .map((entry) => entry.path)
        );
        if (!currentPaths.size) continue;
        const remote = await listStoragePathsRecursive(bucket, folder);
        const extraPaths = remote.filter((path) => !currentPaths.has(path));
        for (let offset = 0; offset < extraPaths.length; offset += 20) {
          await deleteStorageFiles(bucket, extraPaths.slice(offset, offset + 20));
        }
      } catch (error) {
        await logger.warn('storage:cleanup-extra-files', 'Failed to cleanup extra files in folder', {
          bucket,
          folder,
          error: String(error)
        });
      }
    }
  }

  return uploaded;
};

const CLIPBOARD_FILENAME_PREFIX = 'clipboard';

const guessExtension = (mimeType: string) => {
  const normalized = String(mimeType || '').toLowerCase();
  if (!normalized.startsWith('image/')) return 'png';
  const ext = normalized.split('/')[1] || 'png';
  return ext.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
};

const extractImageUrlFromHtml = (html: string): string | null => {
  if (!html.trim()) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const candidate = doc.querySelector('img')?.getAttribute('src')?.trim() || '';
    if (/^https?:\/\//i.test(candidate)) return candidate;
  } catch {
    // ignore parse errors
  }
  return null;
};

const fetchImageFileByUrl = async (url: string, fileIndex: number): Promise<File | null> => {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) return null;
  const extension = guessExtension(blob.type);
  return new File([blob], `${CLIPBOARD_FILENAME_PREFIX}-${Date.now()}-${fileIndex + 1}.${extension}`, { type: blob.type });
};

export const readClipboardImageFiles = async (): Promise<File[]> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('clipboard_api_unavailable');
  }

  const files: File[] = [];
  const fallbackUrls: string[] = [];

  if (typeof navigator.clipboard.read === 'function') {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const extension = guessExtension(type);
          files.push(new File([blob], `${CLIPBOARD_FILENAME_PREFIX}-${Date.now()}-${files.length + 1}.${extension}`, { type }));
          continue;
        }
        if (type === 'text/html') {
          const htmlBlob = await item.getType(type);
          const html = await htmlBlob.text();
          const url = extractImageUrlFromHtml(html);
          if (url) fallbackUrls.push(url);
        }
      }
    }
  }

  if (files.length) return files;

  const textUrlCandidates = new Set<string>(fallbackUrls);
  if (typeof navigator.clipboard.readText === 'function') {
    const text = (await navigator.clipboard.readText()).trim();
    if (/^https?:\/\//i.test(text)) textUrlCandidates.add(text);
  }

  for (const [index, url] of Array.from(textUrlCandidates).entries()) {
    try {
      const file = await fetchImageFileByUrl(url, index);
      if (file) files.push(file);
    } catch {
      // ignore unsupported/blocked urls
    }
  }

  return files;
};

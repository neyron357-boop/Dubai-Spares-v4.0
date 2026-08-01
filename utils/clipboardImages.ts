const CLIPBOARD_FILENAME_PREFIX = 'clipboard';

const guessExtension = (mimeType: string) => {
  const normalized = String(mimeType || '').toLowerCase();
  if (!normalized.startsWith('image/')) return 'png';
  const ext = normalized.split('/')[1] || 'png';
  return ext.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
};

const extractImageSourcesFromHtml = (html: string): string[] => {
  const sources = new Set<string>();
  if (!html.trim()) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src')?.trim();
      if (src) sources.add(src);
      const dataSrc = img.getAttribute('data-src')?.trim();
      if (dataSrc) sources.add(dataSrc);
    });
  } catch {
    // ignore parse errors
  }
  return Array.from(sources);
};

const readUrlFromMarkdownImage = (text: string): string | null => {
  const match = text.match(/!\[[^\]]*]\(([^)]+)\)/);
  return match?.[1]?.trim() || null;
};

const parseDataImageUrl = (value: string): { mimeType: string; base64: string } | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\n\r]+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2].replace(/\s+/g, '');
  if (!mimeType || !base64) return null;
  return { mimeType, base64 };
};

const fileFromDataImageUrl = (value: string, fileIndex: number): File | null => {
  const parsed = parseDataImageUrl(value);
  if (!parsed) return null;

  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const extension = guessExtension(parsed.mimeType);
  const blob = new Blob([bytes], { type: parsed.mimeType });
  return new File([blob], `${CLIPBOARD_FILENAME_PREFIX}-${Date.now()}-${fileIndex + 1}.${extension}`, { type: parsed.mimeType });
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
  const fallbackSources: string[] = [];

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
          fallbackSources.push(...extractImageSourcesFromHtml(html));
        }
      }
    }
  }

  if (files.length) return files;

  const textUrlCandidates = new Set<string>(fallbackSources);
  if (typeof navigator.clipboard.readText === 'function') {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) {
      textUrlCandidates.add(text);
      const markdownImageUrl = readUrlFromMarkdownImage(text);
      if (markdownImageUrl) textUrlCandidates.add(markdownImageUrl);
    }
  }

  for (const [index, source] of Array.from(textUrlCandidates).entries()) {
    try {
      const inlineFile = fileFromDataImageUrl(source, index);
      if (inlineFile) {
        files.push(inlineFile);
        continue;
      }

      const file = await fetchImageFileByUrl(source, index);
      if (file) {
        files.push(file);
      }
    } catch {
      // ignore unsupported/blocked urls
    }
  }

  return files;
};

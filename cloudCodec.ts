const MAX_COMPRESSED_BYTES = 1.5 * 1024 * 1024;
const SMALL_JSON_LIMIT_BYTES = 20 * 1024;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToBlobPart = (bytes: Uint8Array): BlobPart =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const gzipBytes = async (input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream is not supported in this browser');
  }
  const stream = new Blob([bytesToBlobPart(input)]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer) as Uint8Array<ArrayBuffer>;
};

const ungzipBytes = async (input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this browser');
  }
  const stream = new Blob([bytesToBlobPart(input)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer) as Uint8Array<ArrayBuffer>;
};

export type EncodedPayload = {
  payloadB64: string;
  payloadCodec: string;
  payloadJson: unknown | null;
  compressedBytes: number;
  rawBytes: number;
};

export const encodePayloadToCompressedTransport = async (payload: unknown): Promise<EncodedPayload> => {
  const rawText = JSON.stringify(payload);
  const rawBytes = new TextEncoder().encode(rawText) as Uint8Array<ArrayBuffer>;
  let compressed: Uint8Array<ArrayBuffer> = rawBytes;
  let codec = 'identity+b64';

  if (typeof CompressionStream !== 'undefined') {
    compressed = await gzipBytes(rawBytes);
    codec = 'gzip+b64';
  }

  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('Backup слишком большой — удалите тяжёлые медиа или используйте частичный бекап');
  }

  return {
    payloadB64: bytesToBase64(compressed),
    payloadCodec: codec,
    payloadJson: rawBytes.byteLength <= SMALL_JSON_LIMIT_BYTES ? payload : null,
    compressedBytes: compressed.byteLength,
    rawBytes: rawBytes.byteLength
  };
};

export const decodePayloadFromCompressedTransport = async <T>(payloadB64: string, payloadCodec?: string): Promise<T> => {
  if (!payloadB64) {
    throw new Error('Compressed payload is empty');
  }

  if (payloadCodec && !payloadCodec.startsWith('gzip') && !payloadCodec.startsWith('identity')) {
    throw new Error(`Unsupported payload codec: ${payloadCodec}`);
  }

  const compressed = base64ToBytes(payloadB64);
  const rawBytes = payloadCodec?.startsWith('gzip') ? await ungzipBytes(compressed) : compressed;
  const json = new TextDecoder().decode(rawBytes);
  return JSON.parse(json) as T;
};

export const getJsonBytes = (payload: unknown): number => {
  try {
    return new Blob([JSON.stringify(payload)]).size;
  } catch {
    return 0;
  }
};

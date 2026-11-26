import { SerializedTopology } from './types';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function encodeTopologyToToken(topology: SerializedTopology): Promise<string> {
  const json = JSON.stringify(topology);
  const inputBytes = new TextEncoder().encode(json);

  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(inputBytes.byteLength);
    copy.set(inputBytes);
    await writer.write(copy);
    await writer.close();
    const compressed = await readStreamBytes(cs.readable);
    return `z.${bytesToBase64Url(compressed)}`;
  }

  return `u.${bytesToBase64Url(inputBytes)}`;
}

export async function decodeTopologyFromToken(token: string): Promise<SerializedTopology | null> {
  try {
    const trimmed = token.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('z.')) {
      if (typeof DecompressionStream === 'undefined') return null;
      const compressed = base64UrlToBytes(trimmed.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const copy = new Uint8Array(compressed.byteLength);
      copy.set(compressed);
      await writer.write(copy);
      await writer.close();
      const rawBytes = await readStreamBytes(ds.readable);
      const json = new TextDecoder().decode(rawBytes);
      return JSON.parse(json) as SerializedTopology;
    }

    if (trimmed.startsWith('u.')) {
      const rawBytes = base64UrlToBytes(trimmed.slice(2));
      const json = new TextDecoder().decode(rawBytes);
      return JSON.parse(json) as SerializedTopology;
    }

    // Legacy raw base64url fallback
    const rawBytes = base64UrlToBytes(trimmed);
    const json = new TextDecoder().decode(rawBytes);
    return JSON.parse(json) as SerializedTopology;
  } catch {
    return null;
  }
}

export function extractShareTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  if (window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashToken = hashParams.get('t');
    if (hashToken) return hashToken;
  }

  if (window.location.search) {
    const queryParams = new URLSearchParams(window.location.search);
    const queryToken = queryParams.get('t');
    if (queryToken) return queryToken;
  }

  return null;
}

export function buildShareUrl(token: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#t=${token}`;
}

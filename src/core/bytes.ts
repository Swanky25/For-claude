import type { Sample } from './types';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

/** Build a Sample from text, using UTF-8 as the byte representation. */
export function fromText(text: string): Sample {
  return { text, bytes: utf8Encoder.encode(text) };
}

/** Build a Sample from bytes, decoding a lossy UTF-8 text view. */
export function fromBytes(bytes: Uint8Array): Sample {
  return { bytes, text: utf8Decoder.decode(bytes) };
}

/**
 * Build a Sample from bytes that are known to be a byte-per-character mapping.
 * Used where an operation works on code units below 256 (XOR output, Latin-1)
 * and round-tripping through UTF-8 would corrupt the high range.
 */
export function fromLatin1(bytes: Uint8Array): Sample {
  let text = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { bytes, text };
}

/** Interpret each character's low byte, the inverse of `fromLatin1`. */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Build a Sample from bytes, preferring a UTF-8 reading when the bytes are
 * valid UTF-8 and falling back to a byte-per-character view when they are not.
 *
 * Decoders that recover raw octets — quoted-printable, decimal byte lists, XOR
 * — cannot know which they are holding. Guessing wrong is very visible: UTF-8
 * text read as Latin-1 shows up as the familiar "cafÃ©" mojibake.
 */
export function fromBytesAuto(bytes: Uint8Array): Sample {
  try {
    return { bytes, text: strictUtf8.decode(bytes) };
  } catch {
    return fromLatin1(bytes);
  }
}

export const EMPTY: Sample = { bytes: new Uint8Array(0), text: '' };

/** Fraction of bytes that are printable ASCII, tab, newline or carriage return. */
export function printableRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let ok = 0;
  for (const b of bytes) {
    if ((b >= 0x20 && b <= 0x7e) || b === 9 || b === 10 || b === 13) ok++;
  }
  return ok / bytes.length;
}

/** True when the sample looks like binary rather than readable text. */
export function looksBinary(sample: Sample): boolean {
  return printableRatio(sample.bytes) < 0.85;
}

/** Uppercase A-Z only, everything else dropped. */
export function lettersOnly(text: string): string {
  return text.replace(/[^a-zA-Z]/g, '').toUpperCase();
}

/** Strip whitespace, which most encodings tolerate as formatting. */
export function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Portable base64 decode to bytes; throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Portable base64 encode from bytes. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Low-level codec primitives shared by the encoding operations.
 *
 * These are deliberately tolerant: real-world ciphertext arrives with stray
 * whitespace, missing padding and mixed alphabets. Each returns null rather
 * than throwing so callers can treat "not this encoding" as an ordinary result.
 */

export const B64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const B64_URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const B32_RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const B32_HEX = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
export const B58_BITCOIN = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const B58_RIPPLE = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

const lookupCache = new Map<string, Int16Array>();

/** Char-code -> symbol value table for an alphabet, built once per alphabet. */
function lookupFor(alphabet: string): Int16Array {
  let table = lookupCache.get(alphabet);
  if (!table) {
    table = new Int16Array(128).fill(-1);
    for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
    lookupCache.set(alphabet, table);
  }
  return table;
}

/**
 * Decode an alphabet whose symbol count is a power of two (base64, base32,
 * base16, base2) by streaming bits into bytes.
 *
 * Trailing bits that do not complete a byte are discarded, which is what makes
 * unpadded input work; but if those bits are non-zero the input was not really
 * this encoding, and we reject it.
 */
export function decodeBits(input: string, alphabet: string, bitsPerChar: number): Uint8Array | null {
  const table = lookupFor(alphabet);
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let symbols = 0;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 61 || code === 32 || code === 10 || code === 13 || code === 9) continue; // '=' and whitespace
    if (code > 127) return null;
    const value = table[code];
    if (value < 0) return null;
    symbols++;
    buffer = (buffer << bitsPerChar) | value;
    bits += bitsPerChar;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }

  if (symbols === 0 || out.length === 0) return null;
  // Leftover bits must be zero padding, not data.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return Uint8Array.from(out);
}

/**
 * Decode a base whose symbol count is not a power of two (base58) via
 * arbitrary-precision division on a byte array.
 */
export function decodeBaseN(input: string, alphabet: string): Uint8Array | null {
  const base = alphabet.length;
  const table = lookupFor(alphabet);
  const trimmed = input.replace(/\s+/g, '');
  if (trimmed.length === 0) return null;

  const bytes: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code > 127) return null;
    let carry = table[code];
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * base;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading zero symbols encode leading zero bytes.
  let leadingZeros = 0;
  while (leadingZeros < trimmed.length && trimmed[leadingZeros] === alphabet[0]) leadingZeros++;

  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[leadingZeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

/** Ascii85 / base85, accepting the optional <~ ~> wrapper and 'z' zero-run shorthand. */
export function decodeAscii85(input: string): Uint8Array | null {
  let text = input.trim();
  if (text.startsWith('<~')) text = text.slice(2);
  if (text.endsWith('~>')) text = text.slice(0, -2);
  text = text.replace(/\s+/g, '');
  if (text.length === 0) return null;

  const out: number[] = [];
  let tuple = 0;
  let count = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === 'z' && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = text.charCodeAt(i);
    if (code < 33 || code > 117) return null;
    tuple = tuple * 85 + (code - 33);
    if (++count === 5) {
      if (tuple > 0xffffffff) return null;
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }

  if (count === 1) return null; // a single leftover symbol is never valid
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    if (tuple > 0xffffffff) return null;
    const full = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff];
    out.push(...full.slice(0, count - 1));
  }

  return out.length ? Uint8Array.from(out) : null;
}

/** Parse whitespace/punctuation separated integers in a given radix. */
export function decodeNumbers(input: string, radix: number, maxValue = 255): Uint8Array | null {
  const tokens = input.trim().split(/[^0-9a-fA-F]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const out = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    const value = parseInt(tokens[i], radix);
    if (!Number.isFinite(value) || value < 0 || value > maxValue) return null;
    // Reject digits outside the radix, which parseInt would silently truncate.
    if (value.toString(radix).length !== tokens[i].replace(/^0+(?=.)/, '').length) return null;
    out[i] = value;
  }
  return out;
}

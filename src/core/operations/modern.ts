import CryptoJS from 'crypto-js';
import { fromBytesAuto, fromText, latin1Bytes, stripWhitespace } from '../bytes';
import type { Operation, OperationResult, ParamValues, Sample } from '../types';

const NONE: OperationResult[] = [];

type WordArray = CryptoJS.lib.WordArray;

function wordArrayToBytes(words: WordArray): Uint8Array {
  const out = new Uint8Array(words.sigBytes);
  for (let i = 0; i < words.sigBytes; i++) {
    out[i] = (words.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function bytesToWordArray(bytes: Uint8Array): WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

const HEX_ONLY = /^[0-9a-fA-F]+$/;
const BASE64_ONLY = /^[A-Za-z0-9+/=_-]+$/;

/**
 * Interpret a key, IV or ciphertext string in the requested format.
 *
 * "auto" is the default because ciphertext is pasted in whatever form it was
 * found: hex from a hexdump, Base64 from a config file, raw bytes from a
 * download. Hex is checked first since a hex string is also valid Base64.
 */
function parseField(value: string, format: string | undefined): WordArray {
  const text = stripWhitespace(value);
  switch (format) {
    case 'hex':
      return CryptoJS.enc.Hex.parse(text);
    case 'base64':
      return CryptoJS.enc.Base64.parse(text);
    case 'utf8':
      return CryptoJS.enc.Utf8.parse(value);
    default:
      if (text.length % 2 === 0 && HEX_ONLY.test(text) && text.length >= 16) {
        return CryptoJS.enc.Hex.parse(text);
      }
      if (BASE64_ONLY.test(text) && text.length % 4 === 0) {
        return CryptoJS.enc.Base64.parse(text);
      }
      return CryptoJS.enc.Utf8.parse(value);
  }
}

const MODES: Record<string, typeof CryptoJS.mode.CBC> = {
  CBC: CryptoJS.mode.CBC,
  ECB: CryptoJS.mode.ECB,
  CTR: CryptoJS.mode.CTR,
  CFB: CryptoJS.mode.CFB,
  OFB: CryptoJS.mode.OFB,
};

const KEY_FORMATS = ['auto', 'utf8', 'hex', 'base64'];

interface CipherSpec {
  id: string;
  label: string;
  description: string;
  algorithm: typeof CryptoJS.AES;
  /** ECB and CBC need whole blocks; stream modes do not. */
  blockSize: number;
}

/**
 * Build a decrypt operation for a block cipher.
 *
 * These all require a key, so they never take part in the automatic solver —
 * there is nothing to search. They exist so that once you know the key, the
 * result can be fed straight back through the rest of the pipeline.
 */
function blockCipher(spec: CipherSpec): Operation {
  return {
    id: spec.id,
    label: spec.label,
    category: 'modern',
    description: spec.description,
    requiresKey: true,
    params: [
      { name: 'key', label: 'Key', type: 'string', placeholder: 'hex, Base64 or passphrase' },
      { name: 'keyFormat', label: 'Key format', type: 'select', options: KEY_FORMATS, default: 'auto' },
      { name: 'iv', label: 'IV (not used by ECB)', type: 'string', placeholder: 'hex or Base64' },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: Object.keys(MODES),
        default: 'CBC',
      },
      {
        name: 'inputFormat',
        label: 'Ciphertext format',
        type: 'select',
        options: ['auto', 'base64', 'hex', 'raw'],
        default: 'auto',
      },
    ],
    run(input, params?: ParamValues): OperationResult[] {
      const key = params?.key ? String(params.key) : '';
      if (!key) return NONE;

      const modeName = String(params?.mode ?? 'CBC').toUpperCase();
      const mode = MODES[modeName];
      if (!mode) return NONE;

      const ciphertext =
        params?.inputFormat === 'raw'
          ? bytesToWordArray(input.bytes)
          : parseField(input.text, params?.inputFormat as string | undefined);
      if (ciphertext.sigBytes === 0) return NONE;
      if (
        (modeName === 'ECB' || modeName === 'CBC') &&
        ciphertext.sigBytes % spec.blockSize !== 0
      ) {
        return NONE;
      }

      const iv = params?.iv ? parseField(String(params.iv), undefined) : undefined;
      const keyWords = parseField(key, params?.keyFormat as string | undefined);

      try {
        const decrypted = spec.algorithm.decrypt(
          CryptoJS.lib.CipherParams.create({ ciphertext }),
          keyWords,
          {
            mode,
            iv,
            padding: modeName === 'ECB' || modeName === 'CBC'
              ? CryptoJS.pad.Pkcs7
              : CryptoJS.pad.NoPadding,
          },
        );
        const bytes = wordArrayToBytes(decrypted);
        if (bytes.length === 0) return NONE;
        return [
          {
            output: fromBytesAuto(bytes),
            detail: `${modeName}${iv ? ' with IV' : ''}`,
            prior: 1,
          },
        ];
      } catch {
        // A wrong key usually fails at the padding check, which is itself a
        // useful signal: the operation simply yields nothing.
        return NONE;
      }
    },
  };
}

export const aes = blockCipher({
  id: 'aes',
  label: 'AES',
  description: 'AES-128/192/256 decryption with a supplied key. Modes CBC, ECB, CTR, CFB, OFB.',
  algorithm: CryptoJS.AES,
  blockSize: 16,
});

export const des = blockCipher({
  id: 'des',
  label: 'DES',
  description: 'Single DES decryption with a supplied 8-byte key.',
  algorithm: CryptoJS.DES,
  blockSize: 8,
});

export const tripleDes = blockCipher({
  id: '3des',
  label: 'Triple DES',
  description: '3DES/DES-EDE decryption with a supplied 16- or 24-byte key.',
  algorithm: CryptoJS.TripleDES,
  blockSize: 8,
});

export const rc4: Operation = {
  id: 'rc4',
  label: 'RC4',
  category: 'modern',
  description: 'RC4 stream cipher with a supplied key.',
  requiresKey: true,
  params: [
    { name: 'key', label: 'Key', type: 'string', placeholder: 'hex, Base64 or passphrase' },
    { name: 'keyFormat', label: 'Key format', type: 'select', options: KEY_FORMATS, default: 'auto' },
    {
      name: 'inputFormat',
      label: 'Ciphertext format',
      type: 'select',
      options: ['auto', 'base64', 'hex', 'raw'],
      default: 'auto',
    },
  ],
  run(input, params?: ParamValues) {
    const key = params?.key ? String(params.key) : '';
    if (!key) return NONE;
    const ciphertext =
      params?.inputFormat === 'raw'
        ? bytesToWordArray(input.bytes)
        : parseField(input.text, params?.inputFormat as string | undefined);
    if (ciphertext.sigBytes === 0) return NONE;

    try {
      const decrypted = CryptoJS.RC4.decrypt(
        CryptoJS.lib.CipherParams.create({ ciphertext }),
        parseField(key, params?.keyFormat as string | undefined),
        {},
      );
      const bytes = wordArrayToBytes(decrypted);
      return bytes.length ? [{ output: fromBytesAuto(bytes), prior: 1 }] : NONE;
    } catch {
      return NONE;
    }
  },
};

// ---------------------------------------------------------------------------
// Inspection helpers
// ---------------------------------------------------------------------------

function base64UrlToText(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    return new TextDecoder().decode(latin1Bytes(atob(full)));
  } catch {
    return null;
  }
}

export const jwt: Operation = {
  id: 'jwt',
  label: 'JWT',
  category: 'modern',
  description: 'Decodes the header and payload of a JSON Web Token. Does not verify the signature.',
  applicable(input) {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(input.text.trim());
  },
  run(input) {
    const parts = input.text.trim().split('.');
    if (parts.length !== 3) return NONE;
    const header = base64UrlToText(parts[0]);
    const payload = base64UrlToText(parts[1]);
    if (!header || !payload) return NONE;

    const pretty = (json: string): string => {
      try {
        return JSON.stringify(JSON.parse(json), null, 2);
      } catch {
        return json;
      }
    };

    let algorithm = 'unknown';
    try {
      algorithm = String(JSON.parse(header).alg ?? 'unknown');
    } catch {
      // Leave the default; a malformed header is still worth showing.
    }

    const signatureNote =
      algorithm.toLowerCase() === 'none'
        ? 'alg "none" — this token is unsigned and trivially forgeable'
        : `alg ${algorithm} — signature present but NOT verified`;

    return [
      {
        output: fromText(`// header\n${pretty(header)}\n\n// payload\n${pretty(payload)}`),
        detail: signatureNote,
        prior: 1,
      },
    ];
  },
};

interface HashCandidate {
  name: string;
  test: (text: string) => boolean;
}

/** Ordered most-likely-first within each length. */
const HASH_SHAPES: HashCandidate[] = [
  { name: 'CRC-32', test: (t) => HEX_ONLY.test(t) && t.length === 8 },
  { name: 'MD5 (or NTLM / MD4)', test: (t) => HEX_ONLY.test(t) && t.length === 32 },
  { name: 'SHA-1', test: (t) => HEX_ONLY.test(t) && t.length === 40 },
  { name: 'SHA-224', test: (t) => HEX_ONLY.test(t) && t.length === 56 },
  { name: 'SHA-256', test: (t) => HEX_ONLY.test(t) && t.length === 64 },
  { name: 'SHA-384', test: (t) => HEX_ONLY.test(t) && t.length === 96 },
  { name: 'SHA-512', test: (t) => HEX_ONLY.test(t) && t.length === 128 },
  { name: 'bcrypt', test: (t) => /^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(t) },
  { name: 'MD5-crypt', test: (t) => /^\$1\$[^$]{1,8}\$[./A-Za-z0-9]{22}$/.test(t) },
  { name: 'SHA-256-crypt', test: (t) => /^\$5\$/.test(t) },
  { name: 'SHA-512-crypt', test: (t) => /^\$6\$/.test(t) },
  { name: 'Argon2', test: (t) => /^\$argon2[id]{1,2}\$/.test(t) },
  { name: 'PHC / scrypt', test: (t) => /^\$scrypt\$/.test(t) },
];

export const identifyHash: Operation = {
  id: 'hash-id',
  label: 'Identify hash',
  category: 'modern',
  description:
    'Identifies a hash or password digest by shape. Hashes are one-way: this reports what it is, not what it was.',
  applicable(input) {
    const text = input.text.trim();
    return text.length >= 8 && text.length <= 256 && !/\s/.test(text);
  },
  run(input) {
    const text = input.text.trim();
    const matches = HASH_SHAPES.filter((shape) => shape.test(text));
    if (matches.length === 0) return NONE;

    const names = matches.map((m) => m.name).join(', ');
    return [
      {
        output: fromText(
          `Matches: ${names}\n\n` +
            `Length: ${text.length} characters\n` +
            'A hash cannot be reversed. Recovering the input means guessing it ' +
            'and hashing the guesses (a dictionary or brute-force attack), which ' +
            'this tool does not do.',
        ),
        detail: names,
        prior: 1,
      },
    ];
  },
};

export const modernOperations: Operation[] = [aes, des, tripleDes, rc4, jwt, identifyHash];

/** Exposed for tests: the byte conversions are easy to get subtly wrong. */
export const __internals = { wordArrayToBytes, bytesToWordArray, parseField };

export type { Sample };

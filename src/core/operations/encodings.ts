import { fromBytes, fromBytesAuto, fromText, stripWhitespace } from '../bytes';
import type { Operation, OperationResult, Sample } from '../types';
import {
  B32_HEX,
  B32_RFC4648,
  B58_BITCOIN,
  B58_RIPPLE,
  B64_STANDARD,
  B64_URLSAFE,
  decodeAscii85,
  decodeBaseN,
  decodeBits,
  decodeNumbers,
} from './codecs';

const utf8Encoder = new TextEncoder();

/** Shorthand for the single-result case. */
const one = (output: Sample, detail?: string, prior = 1): OperationResult[] => [
  { output, detail, prior },
];

const NONE: OperationResult[] = [];

// ---------------------------------------------------------------------------
// Binary-to-text encodings
// ---------------------------------------------------------------------------

const BASE64_SHAPE = /^[A-Za-z0-9+/\-_]+={0,2}$/;

export const base64: Operation = {
  id: 'base64',
  label: 'Base64',
  category: 'encoding',
  description: 'RFC 4648 Base64, including the URL-safe alphabet and unpadded input.',
  applicable(input) {
    const text = stripWhitespace(input.text);
    if (text.length < 4 || !BASE64_SHAPE.test(text)) return false;
    // Length 1 mod 4 can never be produced by Base64.
    return stripWhitespace(text.replace(/=+$/, '')).length % 4 !== 1;
  },
  run(input) {
    const text = stripWhitespace(input.text);
    const urlSafe = /[-_]/.test(text);
    const alphabet = urlSafe ? B64_URLSAFE : B64_STANDARD;
    const bytes = decodeBits(text, alphabet, 6);
    if (!bytes) return NONE;
    return one(fromBytes(bytes), urlSafe ? 'URL-safe alphabet' : undefined);
  },
};

export const base32: Operation = {
  id: 'base32',
  label: 'Base32',
  category: 'encoding',
  description: 'RFC 4648 Base32, standard and extended-hex alphabets.',
  applicable(input) {
    const text = stripWhitespace(input.text).replace(/=+$/, '');
    return text.length >= 8 && /^[A-Za-z2-7]+$/.test(text);
  },
  run(input) {
    const text = stripWhitespace(input.text).toUpperCase();
    const results: OperationResult[] = [];
    const standard = decodeBits(text, B32_RFC4648, 5);
    if (standard) results.push({ output: fromBytes(standard), prior: 1 });
    if (/^[0-9A-V=\s]+$/i.test(text)) {
      const hex = decodeBits(text, B32_HEX, 5);
      if (hex) results.push({ output: fromBytes(hex), detail: 'extended hex alphabet', prior: 0.6 });
    }
    return results;
  },
};

export const base58: Operation = {
  id: 'base58',
  label: 'Base58',
  category: 'encoding',
  description: 'Base58 as used by Bitcoin addresses and IPFS, plus the Ripple alphabet.',
  applicable(input) {
    const text = stripWhitespace(input.text);
    return text.length >= 4 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(text);
  },
  run(input) {
    const text = stripWhitespace(input.text);
    const results: OperationResult[] = [];
    const bitcoin = decodeBaseN(text, B58_BITCOIN);
    if (bitcoin) results.push({ output: fromBytes(bitcoin), prior: 1 });
    const ripple = decodeBaseN(text, B58_RIPPLE);
    if (ripple) results.push({ output: fromBytes(ripple), detail: 'Ripple alphabet', prior: 0.4 });
    return results;
  },
};

export const base85: Operation = {
  id: 'base85',
  label: 'Base85 / Ascii85',
  category: 'encoding',
  description: 'Adobe Ascii85, with or without the <~ ~> delimiters.',
  applicable(input) {
    const text = stripWhitespace(input.text).replace(/^<~|~>$/g, '');
    if (text.length < 5) return false;
    return /^[\x21-\x75]+$/.test(text);
  },
  run(input) {
    const bytes = decodeAscii85(input.text);
    return bytes ? one(fromBytes(bytes)) : NONE;
  },
};

export const hex: Operation = {
  id: 'hex',
  label: 'Hexadecimal',
  category: 'encoding',
  description: 'Hex bytes, with or without separators and 0x prefixes.',
  applicable(input) {
    const text = input.text.replace(/0x/gi, '').replace(/[\s,:;.-]+/g, '');
    return text.length >= 4 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
  },
  run(input) {
    const text = input.text.replace(/0x/gi, '').replace(/[\s,:;.-]+/g, '');
    const bytes = decodeBits(text, '0123456789abcdef', 4);
    if (bytes) return one(fromBytes(bytes));
    const upper = decodeBits(text.toLowerCase(), '0123456789abcdef', 4);
    return upper ? one(fromBytes(upper)) : NONE;
  },
};

export const binary: Operation = {
  id: 'binary',
  label: 'Binary',
  category: 'encoding',
  description: 'Bits grouped into bytes, separators optional.',
  applicable(input) {
    const text = stripWhitespace(input.text);
    return text.length >= 8 && text.length % 8 === 0 && /^[01]+$/.test(text);
  },
  run(input) {
    const bytes = decodeBits(stripWhitespace(input.text), '01', 1);
    return bytes ? one(fromBytes(bytes)) : NONE;
  },
};

export const decimalBytes: Operation = {
  id: 'decimal',
  label: 'Decimal bytes',
  category: 'encoding',
  description: 'Character codes in decimal, e.g. "72 101 108 108 111".',
  applicable(input) {
    const text = input.text.trim();
    return /^[\d\s,;.|]+$/.test(text) && /\d/.test(text) && text.split(/[^\d]+/).filter(Boolean).length >= 2;
  },
  run(input) {
    const bytes = decodeNumbers(input.text, 10, 0x10ffff);
    if (!bytes) return NONE;
    // Values above 255 are code points rather than bytes.
    const tokens = input.text.trim().split(/[^\d]+/).filter(Boolean).map(Number);
    if (tokens.some((n) => n > 255)) {
      return one(fromText(String.fromCodePoint(...tokens)), 'Unicode code points');
    }
    return one(fromBytesAuto(Uint8Array.from(tokens)));
  },
};

export const octalBytes: Operation = {
  id: 'octal',
  label: 'Octal bytes',
  category: 'encoding',
  description: 'Character codes in octal, e.g. "110 145 154".',
  applicable(input) {
    const text = input.text.trim();
    return /^[0-7\s,;.|]+$/.test(text) && text.split(/[^0-7]+/).filter(Boolean).length >= 2;
  },
  run(input) {
    const bytes = decodeNumbers(input.text, 8);
    return bytes ? one(fromBytesAuto(bytes)) : NONE;
  },
};

// ---------------------------------------------------------------------------
// Text escapes
// ---------------------------------------------------------------------------

export const urlDecode: Operation = {
  id: 'url',
  label: 'URL / percent encoding',
  category: 'encoding',
  description: 'Percent-encoded octets, with + treated as space.',
  applicable(input) {
    return /%[0-9a-fA-F]{2}/.test(input.text);
  },
  run(input) {
    try {
      const decoded = decodeURIComponent(input.text.replace(/\+/g, ' '));
      return decoded === input.text ? NONE : one(fromText(decoded));
    } catch {
      // Malformed sequences: decode the octets we can and leave the rest.
      const decoded = input.text.replace(/%([0-9a-fA-F]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      );
      return decoded === input.text ? NONE : one(fromText(decoded), 'partial decode', 0.6);
    }
  },
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  cent: '¢',
  pound: '£',
  euro: '€',
  yen: '¥',
  sect: '§',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
};

export const htmlEntities: Operation = {
  id: 'html',
  label: 'HTML entities',
  category: 'encoding',
  description: 'Named and numeric HTML character references.',
  applicable(input) {
    return /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]{2,10});/.test(input.text);
  },
  run(input) {
    const decoded = input.text.replace(
      /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]{2,10});/g,
      (match, body: string) => {
        if (body[0] === '#') {
          const code =
            body[1] === 'x' || body[1] === 'X'
              ? parseInt(body.slice(2), 16)
              : parseInt(body.slice(1), 10);
          return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
      },
    );
    return decoded === input.text ? NONE : one(fromText(decoded));
  },
};

export const unicodeEscapes: Operation = {
  id: 'unicode-escape',
  label: 'Unicode / hex escapes',
  category: 'encoding',
  description: String.raw`Backslash escapes: \uXXXX, \u{XXXXX}, \xNN and octal \NNN.`,
  applicable(input) {
    return /\\(?:u\{?[0-9a-fA-F]{2,6}\}?|x[0-9a-fA-F]{2}|[0-7]{2,3})/.test(input.text);
  },
  run(input) {
    let changed = false;
    const decoded = input.text
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h: string) => {
        const code = parseInt(h, 16);
        if (code > 0x10ffff) return m;
        changed = true;
        return String.fromCodePoint(code);
      })
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => {
        changed = true;
        return String.fromCharCode(parseInt(h, 16));
      })
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => {
        changed = true;
        return String.fromCharCode(parseInt(h, 16));
      })
      .replace(/\\([0-7]{2,3})/g, (m, o: string) => {
        const code = parseInt(o, 8);
        if (code > 255) return m;
        changed = true;
        return String.fromCharCode(code);
      });
    return changed ? one(fromText(decoded)) : NONE;
  },
};

export const quotedPrintable: Operation = {
  id: 'quoted-printable',
  label: 'Quoted-printable',
  category: 'encoding',
  description: 'MIME quoted-printable, including soft line breaks.',
  applicable(input) {
    return /=[0-9A-F]{2}/.test(input.text) || /=\r?\n/.test(input.text);
  },
  run(input) {
    const unfolded = input.text.replace(/=\r?\n/g, '');
    // Quoted-printable encodes octets, so decode to bytes and let the byte
    // sequence decide whether it is UTF-8 or Latin-1.
    const out: number[] = [];
    let changed = unfolded !== input.text;
    for (let i = 0; i < unfolded.length; i++) {
      const match = /^=([0-9A-Fa-f]{2})/.exec(unfolded.slice(i, i + 3));
      if (match) {
        out.push(parseInt(match[1], 16));
        i += 2;
        changed = true;
      } else {
        const code = unfolded.charCodeAt(i);
        if (code < 256) out.push(code);
        else out.push(...utf8Encoder.encode(unfolded[i]));
      }
    }
    return changed ? one(fromBytesAuto(Uint8Array.from(out))) : NONE;
  },
};

// ---------------------------------------------------------------------------
// Symbol alphabets
// ---------------------------------------------------------------------------

const MORSE: Record<string, string> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
  '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-....-': '-',
  '.----.': "'", '---...': ':', '-.-.-.': ';', '-.--.': '(', '-.--.-': ')',
  '.-..-.': '"', '.--.-.': '@', '-...-': '=', '.-.-.': '+', '..--.-': '_',
  '...-..-': '$', '-.-.--': '!',
};

export const morse: Operation = {
  id: 'morse',
  label: 'Morse code',
  category: 'encoding',
  description: 'Dots and dashes; / or a double space separates words.',
  applicable(input) {
    const text = input.text.trim();
    if (text.length < 3) return false;
    // Accept the common unicode stand-ins for dot and dash too.
    return /^[.\-_·•–—/|\s]+$/.test(text) && /[.\-_·•–—]/.test(text);
  },
  run(input) {
    const normalised = input.text
      .replace(/[·•]/g, '.')
      .replace(/[_–—]/g, '-')
      .replace(/\|/g, '/')
      .trim();

    // Word separators: an explicit slash, or a run of two or more spaces.
    const words = normalised.split(/\s*\/\s*|\s{2,}/);
    const out: string[] = [];
    for (const word of words) {
      const letters = word.trim().split(/\s+/).filter(Boolean);
      if (letters.length === 0) continue;
      let decoded = '';
      for (const letter of letters) {
        const ch = MORSE[letter];
        if (!ch) return NONE;
        decoded += ch;
      }
      out.push(decoded);
    }
    return out.length ? one(fromText(out.join(' '))) : NONE;
  },
};

/** Baconian: 5 symbols per letter, either 24-letter (I=J, U=V) or 26-letter. */
export const bacon: Operation = {
  id: 'bacon',
  label: "Bacon's cipher",
  category: 'encoding',
  description: 'Groups of five A/B (or 0/1) symbols per letter.',
  applicable(input) {
    const text = stripWhitespace(input.text).toUpperCase();
    if (text.length < 10 || text.length % 5 !== 0) return false;
    return /^[AB]+$/.test(text) || /^[01]+$/.test(text);
  },
  run(input) {
    const text = stripWhitespace(input.text).toUpperCase();
    const bits = /^[01]+$/.test(text)
      ? text.replace(/0/g, 'A').replace(/1/g, 'B')
      : text;
    if (!/^[AB]+$/.test(bits) || bits.length % 5 !== 0) return NONE;

    const results: OperationResult[] = [];
    for (const variant of ['26', '24'] as const) {
      let out = '';
      let valid = true;
      for (let i = 0; i < bits.length; i += 5) {
        let value = 0;
        for (let j = 0; j < 5; j++) value = value * 2 + (bits[i + j] === 'B' ? 1 : 0);
        if (variant === '26') {
          if (value > 25) {
            valid = false;
            break;
          }
          out += String.fromCharCode(65 + value);
        } else {
          // The classical alphabet folds I/J and U/V into single slots.
          if (value > 23) {
            valid = false;
            break;
          }
          const CLASSICAL = 'ABCDEFGHIKLMNOPQRSTUWXYZ';
          out += CLASSICAL[value];
        }
      }
      if (valid && out) {
        results.push({
          output: fromText(out),
          detail: variant === '26' ? '26-letter alphabet' : '24-letter alphabet (I=J, U=V)',
          prior: variant === '26' ? 1 : 0.8,
        });
      }
    }
    return results;
  },
};

/** Polybius/tap code: pairs of counts addressing a 5x5 grid with I/J merged. */
export const tapCode: Operation = {
  id: 'tap-code',
  label: 'Tap code',
  category: 'encoding',
  description: 'Pairs of tap groups addressing a 5x5 Polybius square (I/J shared).',
  applicable(input) {
    const groups = input.text.trim().split(/[^.•·]+/).filter(Boolean);
    return groups.length >= 2 && groups.length % 2 === 0 && groups.every((g) => g.length <= 5);
  },
  run(input) {
    const groups = input.text.trim().split(/[^.•·]+/).filter(Boolean);
    if (groups.length === 0 || groups.length % 2 !== 0) return NONE;
    const SQUARE = 'ABCDEFGHIKLMNOPQRSTUVWXYZ';
    let out = '';
    for (let i = 0; i < groups.length; i += 2) {
      const row = groups[i].length;
      const col = groups[i + 1].length;
      if (row < 1 || row > 5 || col < 1 || col > 5) return NONE;
      out += SQUARE[(row - 1) * 5 + (col - 1)];
    }
    return out ? one(fromText(out)) : NONE;
  },
};

const NATO: Record<string, string> = {
  alfa: 'A', alpha: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E',
  foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I', juliett: 'J', juliet: 'J',
  kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P',
  quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V',
  whiskey: 'W', whisky: 'W', xray: 'X', 'x-ray': 'X', yankee: 'Y', zulu: 'Z',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', niner: '9',
};

export const natoAlphabet: Operation = {
  id: 'nato',
  label: 'NATO phonetic alphabet',
  category: 'encoding',
  description: 'Spelling alphabet words such as "Alfa Bravo Charlie".',
  applicable(input) {
    const words = input.text.toLowerCase().match(/[a-z-]+/g);
    if (!words || words.length < 2) return false;
    return words.every((w) => w in NATO);
  },
  run(input) {
    const words = input.text.toLowerCase().match(/[a-z-]+/g);
    if (!words) return NONE;
    let out = '';
    for (const word of words) {
      const ch = NATO[word];
      if (!ch) return NONE;
      out += ch;
    }
    return out ? one(fromText(out)) : NONE;
  },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export const reverseText: Operation = {
  id: 'reverse',
  label: 'Reverse',
  category: 'utility',
  description: 'Reverses the character order.',
  applicable(input) {
    return input.text.length > 1;
  },
  run(input) {
    return one(fromText([...input.text].reverse().join('')));
  },
};

export const encodingOperations: Operation[] = [
  base64,
  base32,
  base58,
  base85,
  hex,
  binary,
  decimalBytes,
  octalBytes,
  urlDecode,
  htmlEntities,
  unicodeEscapes,
  quotedPrintable,
  morse,
  bacon,
  tapCode,
  natoAlphabet,
  reverseText,
];

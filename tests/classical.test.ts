import { describe, expect, it } from 'vitest';
import { fromLatin1, fromText, lettersOnly } from '../src/core/bytes';
import {
  affine,
  atbash,
  caesar,
  columnar,
  columnarDecrypt,
  railFence,
  railFenceDecrypt,
  rot47,
  shiftText,
  substitution,
  vigenere,
  vigenereDecrypt,
  xorRepeatingKey,
  xorSingleByte,
} from '../src/core/operations/classical';
import type { Operation } from '../src/core/types';

/**
 * Long enough for statistical attacks to have something to work with. Cipher
 * cracking is a statistical business: every cracker here is expected to fail on
 * a short sample, so the tests use a realistic amount of text.
 */
const PLAIN = `It was a bright cold day in April and the clocks were striking
thirteen. Winston Smith slipped quickly through the glass doors of Victory
Mansions though not quickly enough to prevent a swirl of gritty dust from
entering along with him. The hallway smelt of boiled cabbage and old rag mats.`;

const PLAIN_LETTERS = lettersOnly(PLAIN);

function outputs(op: Operation, input: string) {
  const sample = fromText(input);
  if (op.applicable && !op.applicable(sample)) return [];
  return op.run(sample);
}

/** The best result's text, as the solver would rank it. */
function best(op: Operation, input: string): string {
  return outputs(op, input)[0]?.output.text ?? '';
}

describe('Caesar', () => {
  it('recovers the plaintext and reports the shift', () => {
    const cipher = shiftText(PLAIN, 13);
    const [top] = outputs(caesar, cipher);
    expect(top.output.text).toBe(PLAIN);
    expect(top.detail).toContain('13');
  });

  it('solves every non-zero shift', () => {
    for (let k = 1; k < 26; k++) {
      expect(best(caesar, shiftText(PLAIN, k))).toBe(PLAIN);
    }
  });

  it('honours an explicit shift', () => {
    const result = caesar.run(fromText(shiftText(PLAIN, 7)), { shift: 7 });
    expect(result[0].output.text).toBe(PLAIN);
  });
});

describe('Atbash', () => {
  it('is its own inverse', () => {
    const cipher = atbash.run(fromText(PLAIN))[0].output.text;
    expect(cipher).not.toBe(PLAIN);
    expect(atbash.run(fromText(cipher))[0].output.text).toBe(PLAIN);
  });
});

describe('ROT47', () => {
  it('round-trips printable ASCII', () => {
    const cipher = rot47.run(fromText(PLAIN))[0].output.text;
    expect(rot47.run(fromText(cipher))[0].output.text).toBe(PLAIN);
  });
});

describe('Affine', () => {
  it('recovers the key pair', () => {
    // Encrypt with a=5, b=8.
    const cipher = PLAIN.replace(/[a-z]/gi, (ch) => {
      const base = ch === ch.toUpperCase() ? 65 : 97;
      const x = ch.charCodeAt(0) - base;
      return String.fromCharCode(((5 * x + 8) % 26) + base);
    });
    const [top] = outputs(affine, cipher);
    expect(top.output.text).toBe(PLAIN);
    expect(top.detail).toBe('a=5, b=8');
  });
});

describe('Vigenere', () => {
  /** Encrypt by shifting forward with the key. */
  function encrypt(text: string, key: string): string {
    let out = '';
    let j = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      const base = code >= 65 && code <= 90 ? 65 : code >= 97 && code <= 122 ? 97 : 0;
      if (!base) {
        out += ch;
        continue;
      }
      const shift = key.toUpperCase().charCodeAt(j % key.length) - 65;
      out += String.fromCharCode(((code - base + shift) % 26) + base);
      j++;
    }
    return out;
  }

  it('round-trips with a known key', () => {
    expect(vigenereDecrypt(encrypt(PLAIN, 'LEMON'), 'LEMON')).toBe(PLAIN);
  });

  it('recovers the key from ciphertext alone', () => {
    const [top] = outputs(vigenere, encrypt(PLAIN, 'LEMON'));
    expect(top.output.text).toBe(PLAIN);
    expect(top.detail).toContain('LEMON');
  });

  it('recovers a longer key', () => {
    const [top] = outputs(vigenere, encrypt(PLAIN, 'CRYPTOGRAM'));
    expect(top.detail).toContain('CRYPTOGRAM');
    expect(top.output.text).toBe(PLAIN);
  });
});

describe('Simple substitution', () => {
  const KEY = 'ZEBRASCDFGHIJKLMNOPQTUVWXY'; // plaintext A-Z maps to these

  function encrypt(text: string): string {
    return text.replace(/[a-z]/gi, (ch) => {
      const upper = ch.toUpperCase();
      const mapped = KEY[upper.charCodeAt(0) - 65];
      return ch === upper ? mapped : mapped.toLowerCase();
    });
  }

  it('recovers the plaintext by hill climbing', () => {
    const [top] = outputs(substitution, encrypt(PLAIN));
    // Hill climbing is heuristic; require near-perfect recovery rather than
    // an exact match, since rare letters may never be pinned down.
    const recovered = lettersOnly(top.output.text);
    let matches = 0;
    for (let i = 0; i < PLAIN_LETTERS.length; i++) {
      if (recovered[i] === PLAIN_LETTERS[i]) matches++;
    }
    expect(matches / PLAIN_LETTERS.length).toBeGreaterThan(0.9);
  });

  it('applies a supplied key directly', () => {
    const result = substitution.run(fromText(encrypt('HELLO')), {
      // The decrypt key is the inverse mapping: for each ciphertext letter,
      // which plaintext letter it stands for.
      key: Array.from({ length: 26 }, (_, i) =>
        String.fromCharCode(65 + KEY.indexOf(String.fromCharCode(65 + i))),
      ).join(''),
    });
    expect(result[0].output.text).toBe('HELLO');
  });
});

describe('Rail fence', () => {
  function encrypt(text: string, rails: number): string {
    const rows: string[] = Array.from({ length: rails }, () => '');
    let rail = 0;
    let direction = 1;
    for (const ch of text) {
      rows[rail] += ch;
      if (rail === 0) direction = 1;
      else if (rail === rails - 1) direction = -1;
      rail += direction;
    }
    return rows.join('');
  }

  it('round-trips', () => {
    expect(railFenceDecrypt(encrypt(PLAIN, 4), 4)).toBe(PLAIN);
  });

  it('finds the rail count', () => {
    const [top] = outputs(railFence, encrypt(PLAIN_LETTERS, 5));
    expect(top.output.text).toBe(PLAIN_LETTERS);
    expect(top.detail).toBe('5 rails');
  });
});

describe('Columnar transposition', () => {
  /** Write row-wise into columns, then read them in `order`. */
  function encrypt(text: string, order: number[]): string {
    const cols = order.length;
    const columns: string[] = new Array(cols).fill('');
    for (let i = 0; i < text.length; i++) columns[i % cols] += text[i];
    return order.map((c) => columns[c]).join('');
  }

  it('round-trips', () => {
    const order = [2, 0, 3, 1];
    expect(columnarDecrypt(encrypt(PLAIN_LETTERS, order), order)).toBe(PLAIN_LETTERS);
  });

  it('brute-forces the column order', () => {
    const [top] = outputs(columnar, encrypt(PLAIN_LETTERS, [2, 0, 3, 1]));
    expect(top.output.text).toBe(PLAIN_LETTERS);
  });
});

describe('XOR', () => {
  const bytes = new TextEncoder().encode(PLAIN);

  it('brute-forces a single-byte key', () => {
    const cipher = bytes.map((b) => b ^ 0x5a);
    const [top] = outputs(xorSingleByte, fromLatin1(cipher).text);
    expect(top.output.text).toBe(PLAIN);
    expect(top.detail).toContain('5a');
  });

  it('recovers a repeating key', () => {
    const key = new TextEncoder().encode('SECRET');
    const cipher = bytes.map((b, i) => b ^ key[i % key.length]);
    const [top] = outputs(xorRepeatingKey, fromLatin1(cipher).text);
    expect(top.output.text).toBe(PLAIN);
    expect(top.detail).toContain('SECRET');
  });
});

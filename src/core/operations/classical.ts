import { fromLatin1, fromText, latin1Bytes, lettersOnly } from '../bytes';
import {
  bestCaesarShift,
  chiSquaredShift,
  fitness,
  indexOfCoincidence,
  letterCounts,
  letterIndices,
  ngramLogProbIndices,
} from '../scoring/score';
import type { Operation, OperationResult, ParamValues } from '../types';

const A = 65;
const NONE: OperationResult[] = [];

/** Shift every letter by `k`, preserving case and leaving other characters be. */
export function shiftText(text: string, k: number): string {
  const shift = ((k % 26) + 26) % 26;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 65 && c <= 90) out += String.fromCharCode(((c - 65 + shift) % 26) + 65);
    else if (c >= 97 && c <= 122) out += String.fromCharCode(((c - 97 + shift) % 26) + 97);
    else out += text[i];
  }
  return out;
}

/** Apply a ciphertext->plaintext letter mapping, preserving case and layout. */
function applyKey(text: string, key: Uint8Array): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 65 && c <= 90) out += String.fromCharCode(key[c - 65] + A);
    else if (c >= 97 && c <= 122) out += String.fromCharCode(key[c - 97] + A + 32);
    else out += text[i];
  }
  return out;
}

/** Keep the best `n` results by score, highest first. */
function topBy<T>(items: T[], score: (item: T) => number, n: number): T[] {
  return items
    .map((item) => ({ item, s: score(item) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.item);
}

/**
 * Does this input plausibly *are* alphabetic ciphertext?
 *
 * Substitution and transposition ciphers are defined over an alphabet, so their
 * output is letters, spaces and punctuation — never a meaningful share of
 * digits. Base64, Base32 and hex all carry digits, and turning the letter
 * ciphers loose on them is actively harmful: a substitution solver has 26!
 * degrees of freedom, so given any letter sequence it will find a mapping that
 * scores as convincing English. Gating on the shape of the input is what stops
 * the cracker from overfitting the very scorer used to rank it.
 */
function looksAlphabetic(input: { text: string }): boolean {
  let letters = 0;
  let digits = 0;
  let other = 0;
  for (let i = 0; i < input.text.length; i++) {
    const c = input.text.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++;
    else if (c >= 48 && c <= 57) digits++;
    else if (c > 32) other++;
  }
  const total = letters + digits + other;
  if (total < 3) return false;
  return digits / total <= 0.05 && letters / total >= 0.8;
}

const enoughLetters = (min: number) => (input: { text: string }) =>
  lettersOnly(input.text).length >= min && looksAlphabetic(input);

/**
 * Shortlist by the cheap n-gram score, then settle the order with the full
 * language model.
 *
 * Transposition candidates cluster tightly: a wrong column order can differ
 * from the right one by a single displaced character, which a mean-per-position
 * n-gram score barely registers. Word-level evidence separates them, because
 * one misplaced letter derails an entire word. Segmenting is far too slow to
 * apply to every candidate, so it is reserved for the handful that survive.
 */
function rerankByFitness<T extends { text: string; score: number }>(
  candidates: T[],
  shortlist: number,
  keep: number,
): T[] {
  const best = topBy(candidates, (c) => c.score, shortlist);
  return topBy(best, (c) => fitness(fromText(c.text)).score, keep);
}

// ---------------------------------------------------------------------------
// Monoalphabetic shifts
// ---------------------------------------------------------------------------

export const caesar: Operation = {
  id: 'caesar',
  label: 'Caesar / ROT-N',
  category: 'classical',
  description: 'Shift cipher. Tries all 26 rotations and ranks them by English fitness.',
  params: [{ name: 'shift', label: 'Shift (blank to solve)', type: 'number', placeholder: '13' }],
  applicable: enoughLetters(3),
  run(input, params?: ParamValues) {
    const explicit = params?.shift;
    if (explicit !== undefined && explicit !== '') {
      const k = Number(explicit);
      if (Number.isFinite(k)) {
        return [{ output: fromText(shiftText(input.text, -k)), detail: `shift ${k}`, prior: 1 }];
      }
    }

    const candidates: { shift: number; text: string; score: number }[] = [];
    for (let k = 1; k < 26; k++) {
      const text = shiftText(input.text, -k);
      candidates.push({ shift: k, text, score: ngramLogProbIndices(letterIndices(text)) });
    }
    // Chi-squared agreement is a second opinion: when the top n-gram result is
    // also the best frequency fit we are almost certainly right.
    const chiBest = bestCaesarShift(lettersOnly(input.text)).shift;

    return topBy(candidates, (c) => c.score, 3).map((c, rank) => ({
      output: fromText(c.text),
      detail: c.shift === 13 ? 'ROT13 (shift 13)' : `shift ${c.shift}`,
      params: { shift: c.shift },
      prior: rank === 0 ? (c.shift === chiBest ? 1 : 0.8) : 0.45,
    }));
  },
};

export const atbash: Operation = {
  id: 'atbash',
  label: 'Atbash',
  category: 'classical',
  description: 'Reverses the alphabet: A becomes Z, B becomes Y.',
  applicable: enoughLetters(3),
  run(input) {
    let out = '';
    for (let i = 0; i < input.text.length; i++) {
      const c = input.text.charCodeAt(i);
      if (c >= 65 && c <= 90) out += String.fromCharCode(90 - (c - 65));
      else if (c >= 97 && c <= 122) out += String.fromCharCode(122 - (c - 97));
      else out += input.text[i];
    }
    return [{ output: fromText(out), prior: 1 }];
  },
};

export const rot47: Operation = {
  id: 'rot47',
  label: 'ROT47',
  category: 'classical',
  description: 'Rotates the 94 printable ASCII characters by 47 places.',
  applicable(input) {
    const printable = input.text.match(/[\x21-\x7e]/g)?.length ?? 0;
    return printable >= 4 && printable / input.text.length > 0.6;
  },
  run(input) {
    let out = '';
    for (let i = 0; i < input.text.length; i++) {
      const c = input.text.charCodeAt(i);
      out += c >= 33 && c <= 126 ? String.fromCharCode(33 + ((c - 33 + 47) % 94)) : input.text[i];
    }
    return [{ output: fromText(out), prior: 1 }];
  },
};

/** Modular inverse of a mod 26, or 0 when a is not invertible. */
function inverseMod26(a: number): number {
  for (let x = 1; x < 26; x++) if ((a * x) % 26 === 1) return x;
  return 0;
}

export const affine: Operation = {
  id: 'affine',
  label: 'Affine',
  category: 'classical',
  description: 'Solves E(x) = ax + b over all 312 valid key pairs.',
  params: [
    { name: 'a', label: 'a (blank to solve)', type: 'number', placeholder: '5' },
    { name: 'b', label: 'b', type: 'number', placeholder: '8' },
  ],
  applicable: enoughLetters(8),
  run(input, params?: ParamValues) {
    const decrypt = (a: number, b: number): string | null => {
      const aInv = inverseMod26(a);
      if (!aInv) return null;
      let out = '';
      for (let i = 0; i < input.text.length; i++) {
        const c = input.text.charCodeAt(i);
        const base = c >= 65 && c <= 90 ? 65 : c >= 97 && c <= 122 ? 97 : 0;
        if (!base) {
          out += input.text[i];
          continue;
        }
        const y = c - base;
        out += String.fromCharCode((((aInv * (y - b)) % 26) + 26) % 26 + base);
      }
      return out;
    };

    if (params?.a !== undefined && params.a !== '') {
      const a = Number(params.a);
      const b = Number(params.b ?? 0);
      const text = decrypt(a, b);
      return text ? [{ output: fromText(text), detail: `a=${a}, b=${b}`, prior: 1 }] : NONE;
    }

    const candidates: { a: number; b: number; text: string; score: number }[] = [];
    for (let a = 1; a < 26; a += 2) {
      if (a === 13 || !inverseMod26(a)) continue;
      for (let b = 0; b < 26; b++) {
        if (a === 1 && b === 0) continue; // identity
        const text = decrypt(a, b);
        if (text) {
          candidates.push({ a, b, text, score: ngramLogProbIndices(letterIndices(text)) });
        }
      }
    }
    return topBy(candidates, (c) => c.score, 2).map((c, rank) => ({
      output: fromText(c.text),
      detail: `a=${c.a}, b=${c.b}`,
      params: { a: c.a, b: c.b },
      prior: rank === 0 ? 0.85 : 0.4,
    }));
  },
};

// ---------------------------------------------------------------------------
// Vigenere
// ---------------------------------------------------------------------------

/** Decrypt with a keyword, skipping non-letters without consuming key positions. */
export function vigenereDecrypt(text: string, key: string): string {
  const k = lettersOnly(key);
  if (!k) return text;
  let out = '';
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const base = c >= 65 && c <= 90 ? 65 : c >= 97 && c <= 122 ? 97 : 0;
    if (!base) {
      out += text[i];
      continue;
    }
    const shift = k.charCodeAt(j % k.length) - A;
    out += String.fromCharCode(((c - base - shift + 26) % 26) + base);
    j++;
  }
  return out;
}

/**
 * Recover the key for one candidate length by solving each column as an
 * independent Caesar: every `len`-th letter shares a key letter, so its letter
 * distribution should match English once the right shift is removed.
 */
function solveVigenereKey(letters: string, len: number): string {
  let key = '';
  for (let offset = 0; offset < len; offset++) {
    let column = '';
    for (let i = offset; i < letters.length; i += len) column += letters[i];
    const counts = letterCounts(column);
    let best = 0;
    let bestChi = Infinity;
    for (let shift = 0; shift < 26; shift++) {
      const chi = chiSquaredShift(counts, shift, column.length);
      if (chi < bestChi) {
        bestChi = chi;
        best = shift;
      }
    }
    key += String.fromCharCode(A + best);
  }
  return key;
}

/**
 * Polish a key recovered by frequency analysis.
 *
 * Chi-squared decides each column from only n/len letters, so for longer keys
 * individual positions are often one or two letters off. Re-testing each
 * position against the quadgram score of the *whole* decryption uses the
 * surrounding plaintext as context, which is far more evidence than the column
 * had on its own.
 */
function refineVigenereKey(text: string, key: string, passes = 2): string {
  const chars = key.split('');
  const scoreOf = (candidate: string[]) =>
    ngramLogProbIndices(letterIndices(vigenereDecrypt(text, candidate.join(''))));

  let best = scoreOf(chars);
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (let i = 0; i < chars.length; i++) {
      const original = chars[i];
      let bestChar = original;
      for (let c = 0; c < 26; c++) {
        chars[i] = String.fromCharCode(A + c);
        const score = scoreOf(chars);
        if (score > best) {
          best = score;
          bestChar = chars[i];
          improved = true;
        }
      }
      chars[i] = bestChar;
    }
    if (!improved) break;
  }
  return chars.join('');
}

/**
 * Collapse a key that is itself a repetition.
 *
 * Every multiple of the true key length fits the ciphertext equally well, so
 * frequency analysis is just as happy with LEMONLEMON as with LEMON. They
 * decrypt identically; the shorter one is the real answer.
 */
function minimalKeyPeriod(key: string): string {
  for (let period = 1; period < key.length; period++) {
    if (key.length % period !== 0) continue;
    const candidate = key.slice(0, period);
    if (candidate.repeat(key.length / period) === key) return candidate;
  }
  return key;
}

const MAX_KEY_LENGTH = 24;

export const vigenere: Operation = {
  id: 'vigenere',
  label: 'Vigenere',
  category: 'classical',
  description:
    'Polyalphabetic shift. Finds the key length by index of coincidence, then solves each column by frequency analysis.',
  params: [{ name: 'key', label: 'Keyword (blank to solve)', type: 'string', placeholder: 'LEMON' }],
  applicable: enoughLetters(20),
  run(input, params?: ParamValues) {
    const key = params?.key ? String(params.key) : '';
    if (key) {
      return [
        {
          output: fromText(vigenereDecrypt(input.text, key)),
          detail: `key "${key.toUpperCase()}"`,
          prior: 1,
        },
      ];
    }

    const letters = lettersOnly(input.text);
    if (letters.length < 20) return NONE;

    // Average the per-column index of coincidence for each candidate length.
    // The true length (and its multiples) push the columns back toward the
    // monoalphabetic 0.066; wrong lengths stay near the 0.038 of random text.
    const scored: { len: number; ic: number }[] = [];
    for (let len = 1; len <= Math.min(MAX_KEY_LENGTH, Math.floor(letters.length / 4)); len++) {
      let total = 0;
      for (let offset = 0; offset < len; offset++) {
        let column = '';
        for (let i = offset; i < letters.length; i += len) column += letters[i];
        total += indexOfCoincidence(column);
      }
      scored.push({ len, ic: total / len });
    }

    // Try the most English-looking lengths, preferring shorter keys among ties
    // so we report LEMON rather than LEMONLEMON.
    const lengths = scored
      .sort((a, b) => b.ic - a.ic || a.len - b.len)
      .slice(0, 6)
      .map((s) => s.len);

    const candidates = lengths.map((len) => {
      const recovered = minimalKeyPeriod(
        refineVigenereKey(input.text, solveVigenereKey(letters, len)),
      );
      const text = vigenereDecrypt(input.text, recovered);
      return {
        len: recovered.length,
        key: recovered,
        text,
        score: ngramLogProbIndices(letterIndices(text)),
      };
    });

    return rerankByFitness(candidates, 4, 2).map((c, rank) => ({
      output: fromText(c.text),
      detail: `key "${c.key}" (length ${c.len})`,
      params: { key: c.key },
      prior: rank === 0 ? 0.9 : 0.35,
    }));
  },
};

// ---------------------------------------------------------------------------
// Simple substitution
// ---------------------------------------------------------------------------

/**
 * Solve an arbitrary monoalphabetic substitution by hill climbing.
 *
 * Starting from a frequency-matched guess, repeatedly swap two letters of the
 * key and keep the swap when the quadgram score improves. A single climb gets
 * stuck in local optima, so we restart from shuffled keys and keep the best.
 */
function solveSubstitution(
  cipherIdx: Uint8Array,
  restarts: number,
  random: () => number,
): { key: Uint8Array; score: number } {
  const n = cipherIdx.length;
  const scratch = new Uint8Array(n);
  const counts = new Int32Array(26);
  for (let i = 0; i < n; i++) counts[cipherIdx[i]]++;

  // English letters ordered by frequency, used to seed the first climb.
  const ENGLISH_ORDER = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';
  const byFrequency = [...Array(26).keys()].sort((a, b) => counts[b] - counts[a]);
  const seed = new Uint8Array(26);
  byFrequency.forEach((cipherLetter, rank) => {
    seed[cipherLetter] = ENGLISH_ORDER.charCodeAt(rank) - A;
  });

  const scoreKey = (key: Uint8Array): number => {
    for (let i = 0; i < n; i++) scratch[i] = key[cipherIdx[i]];
    return ngramLogProbIndices(scratch, n);
  };

  let bestKey = seed.slice();
  let bestScore = scoreKey(seed);

  for (let restart = 0; restart < restarts; restart++) {
    const key = restart === 0 ? seed.slice() : bestKey.slice();
    if (restart > 0) {
      // Perturb rather than fully randomise: a few swaps escapes the local
      // optimum while keeping the progress already made.
      for (let i = 0; i < 3; i++) {
        const a = Math.floor(random() * 26);
        const b = Math.floor(random() * 26);
        const t = key[a];
        key[a] = key[b];
        key[b] = t;
      }
    }
    let score = scoreKey(key);

    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < 25; a++) {
        for (let b = a + 1; b < 26; b++) {
          const ta = key[a];
          key[a] = key[b];
          key[b] = ta;
          const candidate = scoreKey(key);
          if (candidate > score) {
            score = candidate;
            improved = true;
          } else {
            const tb = key[a];
            key[a] = key[b];
            key[b] = tb;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key.slice();
    }
  }

  return { key: bestKey, score: bestScore };
}

/** Deterministic PRNG so results are reproducible between runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const substitution: Operation = {
  id: 'substitution',
  label: 'Simple substitution',
  category: 'classical',
  description:
    'Arbitrary monoalphabetic substitution, solved by hill climbing on quadgram statistics.',
  expensive: true,
  applicable(input) {
    if (!enoughLetters(60)(input)) return false;
    // A monoalphabetic substitution just permutes the alphabet, so it leaves
    // the index of coincidence at English's ~0.066. Text that is markedly
    // flatter is polyalphabetic, or not a letter cipher at all.
    return indexOfCoincidence(lettersOnly(input.text)) >= 0.052;
  },
  params: [
    {
      name: 'key',
      label: 'Key: plaintext for A-Z (blank to solve)',
      type: 'string',
      placeholder: 'ZEBRASCDFGHIJKLMNOPQTUVWXY',
    },
  ],
  run(input, params?: ParamValues) {
    const supplied = params?.key ? lettersOnly(String(params.key)) : '';
    if (supplied.length === 26) {
      const key = new Uint8Array(26);
      for (let i = 0; i < 26; i++) key[i] = supplied.charCodeAt(i) - A;
      return [{ output: fromText(applyKey(input.text, key)), detail: `key ${supplied}`, prior: 1 }];
    }

    const cipherIdx = letterIndices(input.text);
    if (cipherIdx.length < 60) return NONE;

    const { key, score } = solveSubstitution(cipherIdx, 12, mulberry32(0x5eed));
    let keyString = '';
    for (let i = 0; i < 26; i++) keyString += String.fromCharCode(key[i] + A);

    return [
      {
        output: fromText(applyKey(input.text, key)),
        detail: `key ${keyString}`,
        params: { key: keyString },
        // Hill climbing on short text is unreliable; let the language score
        // decide, and only claim high confidence once it clearly converged.
        prior: score > -4.6 ? 0.85 : 0.4,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Transposition
// ---------------------------------------------------------------------------

/** Read a rail-fence zigzag of `rails` back into order. */
export function railFenceDecrypt(text: string, rails: number): string {
  if (rails < 2 || rails >= text.length) return text;
  const pattern: number[] = [];
  let rail = 0;
  let direction = 1;
  for (let i = 0; i < text.length; i++) {
    pattern.push(rail);
    if (rail === 0) direction = 1;
    else if (rail === rails - 1) direction = -1;
    rail += direction;
  }

  const out = new Array<string>(text.length);
  let cursor = 0;
  for (let r = 0; r < rails; r++) {
    for (let i = 0; i < text.length; i++) {
      if (pattern[i] === r) out[i] = text[cursor++];
    }
  }
  return out.join('');
}

export const railFence: Operation = {
  id: 'railfence',
  label: 'Rail fence',
  category: 'classical',
  description: 'Zigzag transposition; tries every rail count that fits.',
  params: [{ name: 'rails', label: 'Rails (blank to solve)', type: 'number', placeholder: '3' }],
  applicable(input) {
    return input.text.trim().length >= 6 && looksAlphabetic(input);
  },
  run(input, params?: ParamValues) {
    const text = input.text;
    if (params?.rails) {
      const rails = Number(params.rails);
      return [
        { output: fromText(railFenceDecrypt(text, rails)), detail: `${rails} rails`, prior: 1 },
      ];
    }

    const max = Math.min(12, Math.floor(text.length / 2));
    const candidates: { rails: number; text: string; score: number }[] = [];
    for (let rails = 2; rails <= max; rails++) {
      const decoded = railFenceDecrypt(text, rails);
      candidates.push({ rails, text: decoded, score: ngramLogProbIndices(letterIndices(decoded)) });
    }
    return rerankByFitness(candidates, 6, 2).map((c, rank) => ({
      output: fromText(c.text),
      detail: `${c.rails} rails`,
      params: { rails: c.rails },
      prior: rank === 0 ? 0.8 : 0.35,
    }));
  },
};

/** Undo a columnar transposition given the column read order. */
export function columnarDecrypt(text: string, order: number[]): string {
  const cols = order.length;
  const n = text.length;
  const rows = Math.ceil(n / cols);
  const longColumns = n % cols === 0 ? cols : n % cols;

  const columns: string[] = new Array(cols).fill('');
  let cursor = 0;
  for (const col of order) {
    const height = col < longColumns ? rows : rows - 1;
    columns[col] = text.slice(cursor, cursor + height);
    cursor += height;
  }

  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < columns[c].length) out += columns[c][r];
    }
  }
  return out;
}

function* permutations(n: number): Generator<number[]> {
  const arr = [...Array(n).keys()];
  const c = new Array(n).fill(0);
  yield arr.slice();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swap = i % 2 === 0 ? 0 : c[i];
      const t = arr[swap];
      arr[swap] = arr[i];
      arr[i] = t;
      yield arr.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export const columnar: Operation = {
  id: 'columnar',
  label: 'Columnar transposition',
  category: 'classical',
  description: 'Brute-forces every column order for key widths 2 to 6.',
  expensive: true,
  applicable(input) {
    return lettersOnly(input.text).length >= 12 && looksAlphabetic(input);
  },
  run(input) {
    // Column order only makes sense over the letters themselves; spacing in the
    // ciphertext is an artefact of how it was written down.
    const text = lettersOnly(input.text);
    const candidates: { order: number[]; text: string; score: number }[] = [];

    for (let width = 2; width <= 6; width++) {
      if (text.length < width * 2) break;
      for (const order of permutations(width)) {
        const decoded = columnarDecrypt(text, order);
        candidates.push({
          order: order.slice(),
          text: decoded,
          score: ngramLogProbIndices(letterIndices(decoded)),
        });
      }
    }

    return rerankByFitness(candidates, 12, 2).map((c, rank) => ({
      output: fromText(c.text),
      detail: `width ${c.order.length}, order ${c.order.map((n) => n + 1).join('-')}`,
      params: { order: c.order.map((n) => n + 1).join('-') },
      prior: rank === 0 ? 0.7 : 0.3,
    }));
  },
};

// ---------------------------------------------------------------------------
// XOR
// ---------------------------------------------------------------------------

/**
 * How plausible a decrypted byte column looks as English.
 *
 * XOR output is bytes, not letters, so the quadgram model cannot be used
 * directly on a single column. This weighs the character classes that dominate
 * English text and punishes anything unprintable.
 */
function byteColumnScore(bytes: Uint8Array, key: number): number {
  let score = 0;
  for (const b of bytes) {
    const c = b ^ key;
    if (c === 32) score += 3;
    else if (c >= 97 && c <= 122) score += 2.5;
    else if (c >= 65 && c <= 90) score += 1.5;
    else if (c >= 48 && c <= 57) score += 0.5;
    else if (c === 10 || c === 13 || c === 9) score += 0.5;
    else if (c >= 33 && c <= 126) score += 0.2;
    else score -= 12; // control bytes and high bytes are decisive evidence against
  }
  return score / Math.max(1, bytes.length);
}

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

export const xorSingleByte: Operation = {
  id: 'xor-single',
  label: 'XOR (single byte)',
  category: 'classical',
  description: 'Brute-forces all 255 single-byte XOR keys.',
  applicable(input) {
    return input.bytes.length >= 8;
  },
  run(input) {
    const data = input.bytes;
    const candidates: { key: number; score: number }[] = [];
    for (let key = 1; key < 256; key++) {
      candidates.push({ key, score: byteColumnScore(data, key) });
    }
    return topBy(candidates, (c) => c.score, 3).map((c, rank) => ({
      output: fromLatin1(xorBytes(data, Uint8Array.of(c.key))),
      detail: `key 0x${c.key.toString(16).padStart(2, '0')}`,
      params: { key: `0x${c.key.toString(16).padStart(2, '0')}` },
      prior: rank === 0 ? 0.75 : 0.3,
    }));
  },
};

/** Bit differences between two equal-length byte runs. */
function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

export const xorRepeatingKey: Operation = {
  id: 'xor-repeating',
  label: 'XOR (repeating key)',
  category: 'classical',
  description:
    'Finds the key length by normalised Hamming distance, then solves each key byte independently.',
  expensive: true,
  params: [{ name: 'key', label: 'Key (blank to solve)', type: 'string', placeholder: 'SECRET' }],
  applicable(input) {
    return input.bytes.length >= 24;
  },
  run(input, params?: ParamValues) {
    const data = input.bytes;
    if (params?.key) {
      const key = new TextEncoder().encode(String(params.key));
      return [
        { output: fromLatin1(xorBytes(data, key)), detail: `key "${params.key}"`, prior: 1 },
      ];
    }

    // Blocks a whole key apart differ only by plaintext, so the true key length
    // minimises the per-bit difference between consecutive blocks.
    const maxLen = Math.min(40, Math.floor(data.length / 4));
    const lengths: { len: number; distance: number }[] = [];
    for (let len = 2; len <= maxLen; len++) {
      const blocks = Math.min(6, Math.floor(data.length / len) - 1);
      if (blocks < 2) continue;
      let total = 0;
      for (let i = 0; i < blocks; i++) {
        total += hammingDistance(
          data.subarray(i * len, (i + 1) * len),
          data.subarray((i + 1) * len, (i + 2) * len),
        );
      }
      lengths.push({ len, distance: total / (blocks * len) });
    }
    if (lengths.length === 0) return NONE;

    const best = lengths.sort((a, b) => a.distance - b.distance).slice(0, 4);
    const results: OperationResult[] = [];

    for (const { len } of best) {
      const key = new Uint8Array(len);
      for (let offset = 0; offset < len; offset++) {
        const column = new Uint8Array(Math.ceil((data.length - offset) / len));
        let n = 0;
        for (let i = offset; i < data.length; i += len) column[n++] = data[i];
        const slice = column.subarray(0, n);
        let bestByte = 0;
        let bestScore = -Infinity;
        for (let candidate = 0; candidate < 256; candidate++) {
          const score = byteColumnScore(slice, candidate);
          if (score > bestScore) {
            bestScore = score;
            bestByte = candidate;
          }
        }
        key[offset] = bestByte;
      }
      const plain = xorBytes(data, key);
      const printableKey = [...key].every((b) => b >= 32 && b <= 126)
        ? `"${String.fromCharCode(...key)}"`
        : `0x${[...key].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      results.push({
        output: fromLatin1(plain),
        detail: `key ${printableKey} (length ${len})`,
        params: { key: String.fromCharCode(...key) },
        prior: 0.6,
      });
    }

    return topBy(results, (r) => byteColumnScore(latin1Bytes(r.output.text), 0), 2);
  },
};

export const classicalOperations: Operation[] = [
  caesar,
  atbash,
  rot47,
  affine,
  vigenere,
  substitution,
  railFence,
  columnar,
  xorSingleByte,
  xorRepeatingKey,
];

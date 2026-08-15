import { lettersOnly, printableRatio } from '../bytes';
import type { Sample } from '../types';
import {
  BIGRAM_FLOOR,
  LETTER_FREQ,
  QUADGRAM_FLOOR,
  SCALE,
  TRIGRAM_FLOOR,
  model,
} from './model';

/**
 * Penalty applied when a quadgram is absent from the model and we fall back to
 * its trigram suffix. A trigram is roughly one letter's worth of probability
 * more likely than the quadgram extending it, so backing off without a penalty
 * would make unseen quadgrams look *better* than observed ones.
 */
const BACKOFF_PENALTY = -1.2;

/**
 * Calibration points for turning a mean log10 probability per quadgram into a
 * 0..1 englishness. Held-out English prose measures about -4.2 against the
 * committed model and random letters about -7.8 (see tests/scoring.test.ts).
 * The anchors sit slightly outside that range so genuine plaintext lands near
 * 0.87 rather than saturating at 1, leaving room to rank good candidates
 * against each other.
 */
const ENGLISH_NGRAM = -3.6;
const RANDOM_NGRAM = -8.0;

const CODE_A = 65;

/**
 * Mean log10 probability per position under the quadgram model, with trigram
 * and bigram backoff. Higher (closer to zero) is more English.
 *
 * This is the hot path: crackers call it once per candidate key, so it works
 * directly on char codes and avoids allocating.
 */
export function ngramLogProb(letters: string): number {
  const m = model();
  const n = letters.length;
  if (n === 0) return RANDOM_NGRAM;

  if (n < 4) {
    // Too short for quadgrams; score the bigrams we do have.
    if (n < 2) return RANDOM_NGRAM;
    let sum = 0;
    for (let i = 1; i < n; i++) {
      const idx = (letters.charCodeAt(i - 1) - CODE_A) * 26 + (letters.charCodeAt(i) - CODE_A);
      const b = m.bigram[idx];
      sum += b ? b / SCALE + BIGRAM_FLOOR : BIGRAM_FLOOR;
    }
    // Bigram log-probabilities live on a different scale to quadgrams; shift
    // them so the caller's calibration still applies.
    return sum / (n - 1) - 1.4;
  }

  let sum = 0;
  let c0 = letters.charCodeAt(0) - CODE_A;
  let c1 = letters.charCodeAt(1) - CODE_A;
  let c2 = letters.charCodeAt(2) - CODE_A;
  for (let i = 3; i < n; i++) {
    const c3 = letters.charCodeAt(i) - CODE_A;
    const quad = m.quadgram[((c0 * 26 + c1) * 26 + c2) * 26 + c3];
    if (quad !== 0) {
      sum += quad / SCALE + QUADGRAM_FLOOR;
    } else {
      const tri = m.trigram[(c1 * 26 + c2) * 26 + c3];
      sum += (tri ? tri / SCALE + TRIGRAM_FLOOR : TRIGRAM_FLOOR) + BACKOFF_PENALTY;
    }
    c0 = c1;
    c1 = c2;
    c2 = c3;
  }
  return sum / (n - 3);
}

/**
 * The same quadgram score over pre-extracted letter indices (0..25).
 *
 * Hill-climbing a substitution key evaluates hundreds of thousands of candidate
 * plaintexts; going through strings would spend most of the time in allocation
 * and `charCodeAt`. Crackers keep the ciphertext as indices once and decrypt
 * into a scratch buffer they rescore in place.
 */
export function ngramLogProbIndices(idx: Uint8Array, length = idx.length): number {
  const m = model();
  if (length < 4) return RANDOM_NGRAM;
  const quad = m.quadgram;
  const tri = m.trigram;
  let sum = 0;
  let c0 = idx[0];
  let c1 = idx[1];
  let c2 = idx[2];
  for (let i = 3; i < length; i++) {
    const c3 = idx[i];
    const q = quad[((c0 * 26 + c1) * 26 + c2) * 26 + c3];
    if (q !== 0) {
      sum += q / SCALE + QUADGRAM_FLOOR;
    } else {
      const t = tri[(c1 * 26 + c2) * 26 + c3];
      sum += (t ? t / SCALE + TRIGRAM_FLOOR : TRIGRAM_FLOOR) + BACKOFF_PENALTY;
    }
    c0 = c1;
    c1 = c2;
    c2 = c3;
  }
  return sum / (length - 3);
}

/** Extract A-Z letters of a string as 0..25 indices. */
export function letterIndices(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 65 && c <= 90) out[n++] = c - 65;
    else if (c >= 97 && c <= 122) out[n++] = c - 97;
  }
  return out.subarray(0, n);
}

/** Map a mean n-gram log probability onto 0..1. */
export function normaliseNgram(logProb: number): number {
  const t = (logProb - RANDOM_NGRAM) / (ENGLISH_NGRAM - RANDOM_NGRAM);
  return Math.max(0, Math.min(1, t));
}

/** Letter counts of an A-Z string. */
export function letterCounts(letters: string): Int32Array {
  const counts = new Int32Array(26);
  for (let i = 0; i < letters.length; i++) counts[letters.charCodeAt(i) - CODE_A]++;
  return counts;
}

/**
 * Index of coincidence: the chance two letters drawn at random match. English
 * sits near 0.066, uniformly random text near 0.038. Polyalphabetic ciphers
 * flatten the distribution, so this is what separates Vigenere from Caesar.
 */
export function indexOfCoincidence(letters: string): number {
  const counts = letterCounts(letters);
  const n = letters.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < 26; i++) sum += counts[i] * (counts[i] - 1);
  return sum / (n * (n - 1));
}

/**
 * Chi-squared distance between a shifted letter distribution and English.
 * Lower is a better fit. Used to solve each Caesar column of a Vigenere key.
 */
export function chiSquaredShift(counts: Int32Array, shift: number, total: number): number {
  if (total === 0) return Infinity;
  let chi = 0;
  for (let i = 0; i < 26; i++) {
    const expected = total * LETTER_FREQ[i];
    const observed = counts[(i + shift) % 26];
    const diff = observed - expected;
    chi += (diff * diff) / expected;
  }
  return chi;
}

/** The shift whose decryption best matches English letter frequencies. */
export function bestCaesarShift(letters: string): { shift: number; chi: number } {
  const counts = letterCounts(letters);
  let best = 0;
  let bestChi = Infinity;
  for (let shift = 0; shift < 26; shift++) {
    const chi = chiSquaredShift(counts, shift, letters.length);
    if (chi < bestChi) {
      bestChi = chi;
      best = shift;
    }
  }
  return { shift: best, chi: bestChi };
}

/** Fraction of alphabetic characters that belong to a recognised word. */
export function wordCoverage(text: string): number {
  const m = model();
  const tokens = text.toUpperCase().match(/[A-Z']+/g);
  if (!tokens) return 0;
  let covered = 0;
  let total = 0;
  for (const token of tokens) {
    const word = token.replace(/'/g, '');
    if (!word) continue;
    total += word.length;
    if (m.words.has(word) || word === 'A' || word === 'I') covered += word.length;
  }
  return total === 0 ? 0 : covered / total;
}

export interface Segmentation {
  /** Best-guess spacing, lowercase. */
  text: string;
  /** Fraction of letters accounted for by dictionary words. */
  coverage: number;
  /**
   * Mean log10 probability per letter of the chosen split. Unlike `coverage`
   * this distinguishes a split into common words from one that merely happens
   * to be spellable: "it was" and "si twas" both cover every letter, but the
   * first is orders of magnitude more likely.
   */
  logProb: number;
}

const MAX_WORD = 20;
const SEGMENT_LIMIT = 4000;

/**
 * Recover word boundaries from unspaced letters by dynamic programming over
 * Zipf-estimated word probabilities.
 *
 * Classical ciphers are traditionally transmitted without spaces, so their
 * plaintext scores poorly on `wordCoverage` even when perfectly recovered.
 * Segmenting first both rescues the score and gives the UI something readable.
 */
export function segment(letters: string): Segmentation {
  const m = model();
  const n = letters.length;
  if (n === 0) return { text: '', coverage: 0, logProb: WORD_FLOOR };
  if (n > SEGMENT_LIMIT) {
    // Segmenting is O(n * MAX_WORD); for very long inputs sample the head.
    const head = segment(letters.slice(0, SEGMENT_LIMIT));
    return { ...head, text: `${head.text} ...` };
  }

  const best = new Float64Array(n + 1).fill(-Infinity);
  const from = new Int32Array(n + 1);
  const known = new Uint8Array(n + 1);
  best[0] = 0;

  for (let end = 1; end <= n; end++) {
    const lo = Math.max(0, end - MAX_WORD);
    for (let start = lo; start < end; start++) {
      if (best[start] === -Infinity) continue;
      const word = letters.slice(start, end);
      const known1 = word.length === 1 && (word === 'A' || word === 'I');
      const logP = m.wordLogP.get(word);
      // Unknown spans stay reachable but their cost grows faster than linearly,
      // so splitting into a known word plus a short unknown always beats
      // swallowing both into one long unknown run.
      const cost = logP ?? (known1 ? -1.5 : -(2 + Math.pow(word.length, 1.4)));
      const total = best[start] + cost;
      if (total > best[end]) {
        best[end] = total;
        from[end] = start;
        known[end] = logP !== undefined || known1 ? 1 : 0;
      }
    }
  }

  const parts: string[] = [];
  let covered = 0;
  let cursor = n;
  while (cursor > 0) {
    const start = from[cursor];
    parts.push(letters.slice(start, cursor).toLowerCase());
    if (known[cursor]) covered += cursor - start;
    cursor = start;
  }
  parts.reverse();
  return { text: parts.join(' '), coverage: covered / n, logProb: best[n] / n };
}

/**
 * Calibration for the segmentation log-probability. Fluent English splits into
 * common words at roughly -0.75 per letter; forced splits full of rare or
 * unknown spans fall well below -1.6.
 */
const WORD_FLOOR = -1.9;
const WORD_CEILING = -0.7;

function normaliseSegment(logProb: number): number {
  return Math.max(0, Math.min(1, (logProb - WORD_FLOOR) / (WORD_CEILING - WORD_FLOOR)));
}

export interface Fitness {
  /** Overall englishness, 0..1. */
  score: number;
  /** Mean n-gram log probability per position. */
  ngram: number;
  /** Fraction of letters in recognised words. */
  words: number;
  printable: number;
  /** Populated when the text had no spacing of its own. */
  segmented?: string;
}

/**
 * Full-quality englishness of a decoded sample.
 *
 * Deliberately more expensive than `ngramLogProb` — it segments unspaced text
 * and consults the dictionary — so crackers use the cheap path in their inner
 * loops and only call this when ranking finished candidates.
 */
export function fitness(sample: Sample): Fitness {
  const { text, bytes } = sample;
  const printable = printableRatio(bytes);
  const letters = lettersOnly(text);

  if (letters.length === 0) {
    return { score: 0, ngram: RANDOM_NGRAM, words: 0, printable };
  }

  const ngram = ngramLogProb(letters);
  const ngramNorm = normaliseNgram(ngram);

  // Text that already carries spaces can be scored directly; text without them
  // has to be segmented first or every classical plaintext would look wordless.
  const spacing = (text.match(/\s/g)?.length ?? 0) / Math.max(1, text.length);
  let words: number;
  let segmented: string | undefined;
  if (spacing > 0.02) {
    words = wordCoverage(text);
  } else {
    const seg = segment(letters);
    // Coverage says whether the letters can be spelled out as words at all;
    // the segmentation probability says whether they spell out *likely* ones.
    // Transposition candidates routinely tie on the first and separate on the
    // second, so both contribute.
    words = 0.5 * seg.coverage + 0.5 * normaliseSegment(seg.logProb);
    segmented = seg.text;
  }

  // Binary output is almost never the answer, so weight printability heavily.
  const printablePenalty = printable * printable;
  // Short samples give noisy statistics; shrink their score toward the middle
  // rather than letting a lucky 4-letter fragment outrank real plaintext.
  const lengthFactor = 0.55 + 0.45 * Math.min(1, letters.length / 24);

  const score = (0.55 * ngramNorm + 0.45 * words) * printablePenalty * lengthFactor;

  return { score, ngram, words, printable, segmented };
}

/** Convenience: englishness of a plain string. */
export function scoreText(text: string): number {
  return normaliseNgram(ngramLogProb(lettersOnly(text)));
}

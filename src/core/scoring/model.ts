import { base64ToBytes } from '../bytes';
import * as data from './model.generated';

/**
 * The unpacked English language model.
 *
 * The generated module ships quantised tables as base64; this module expands
 * them once, lazily, into flat typed arrays that scoring can index directly.
 */
export interface LanguageModel {
  unigram: Uint8Array;
  bigram: Uint8Array;
  trigram: Uint8Array;
  /** Expanded from the sparse representation to a dense 26^4 table. */
  quadgram: Uint8Array;
  letterFreq: readonly number[];
  words: Set<string>;
  /** log10 of an estimated unigram word probability, from Zipf rank. */
  wordLogP: Map<string, number>;
}

let cached: LanguageModel | null = null;

/** Expand LEB128 index deltas + score bytes back into a dense table. */
function expandSparse(indexB64: string, scoreB64: string, size: number): Uint8Array {
  const idx = base64ToBytes(indexB64);
  const scores = base64ToBytes(scoreB64);
  const table = new Uint8Array(size);
  let pos = 0;
  let cursor = 0;
  for (let n = 0; n < scores.length; n++) {
    let delta = 0;
    let shift = 0;
    for (;;) {
      const byte = idx[pos++];
      delta |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    cursor += delta;
    table[cursor] = scores[n];
  }
  return table;
}

export function model(): LanguageModel {
  if (cached) return cached;

  const words = data.WORDS.split(' ');
  const wordLogP = new Map<string, number>();
  // Zipf's law: the rank-r word has probability about 1/(r * H_N). Good enough
  // to rank segmentations, and far cheaper to ship than real frequencies.
  const harmonic = Math.log(words.length) + 0.5772156649;
  words.forEach((word, i) => {
    wordLogP.set(word, -Math.log10((i + 1) * harmonic));
  });

  cached = {
    unigram: base64ToBytes(data.UNIGRAM_B64),
    bigram: base64ToBytes(data.BIGRAM_B64),
    trigram: base64ToBytes(data.TRIGRAM_B64),
    quadgram: expandSparse(data.QUADGRAM_INDEX_B64, data.QUADGRAM_SCORE_B64, 26 ** 4),
    letterFreq: data.LETTER_FREQ,
    words: new Set(words),
    wordLogP,
  };
  return cached;
}

export const SCALE = data.SCALE;
export const BIGRAM_FLOOR = data.BIGRAM_FLOOR;
export const TRIGRAM_FLOOR = data.TRIGRAM_FLOOR;
export const QUADGRAM_FLOOR = data.QUADGRAM_FLOOR;
export const LETTER_FREQ = data.LETTER_FREQ;

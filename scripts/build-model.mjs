#!/usr/bin/env node
/**
 * Builds the English language model used to score candidate plaintexts.
 *
 * Reads a plain-text corpus and emits `src/core/scoring/model.generated.ts`
 * containing packed n-gram log-probability tables plus a frequency-ordered
 * word list. The generated file is committed, so the corpus itself never has
 * to live in the repo.
 *
 *   node scripts/build-model.mjs <corpusDir> [--freq ranked.txt] [--dict words.txt]
 *
 * The n-gram tables come from the corpus. The vocabulary is built by merging a
 * modern frequency-ordered list (--freq) with the corpus's own word counts and
 * validating both against a large dictionary (--dict); a literary corpus on its
 * own has excellent letter statistics but badly dated vocabulary.
 *
 * Corpora and lists used for the committed model:
 *   corpus  https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/gutenberg.zip
 *   --freq  https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt
 *   --dict  https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt
 *
 * Packing: every n-gram table is conceptually a dense Uint8Array indexed by the
 * base-26 value of its letters. Each byte holds a quantised log10 probability:
 *
 *   log10(p) = byte / SCALE + floor
 *
 * where `floor` is the log-probability assigned to n-grams that never appeared.
 * Dense + quantised makes lookup a single array index at scoring time.
 *
 * Tables up to trigrams are emitted dense. The quadgram table has 456,976 slots
 * of which only ~18% are ever observed, so it is emitted sparsely instead:
 * ascending indices as LEB128 deltas plus one score byte each. That is ~2.5x
 * smaller on the wire and is expanded back to a dense array at load time.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const A = 'A'.charCodeAt(0);
const SCALE = 32; // quantisation steps per decade of probability
const WORD_LIMIT = 24000; // vocabulary size kept for segmentation and coverage
const FREQ_LIMIT = 10000; // entries taken from the modern frequency list
const INFLECT_FROM = 4000; // how many top stems to inflect
const INFLECT_LIMIT = 8000; // cap on generated inflections

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (/\.(txt|text|md)$/i.test(entry)) out.push(full);
  }
  return out;
}

/** Uppercase A-Z only; every other character becomes a single space separator. */
function normalise(raw) {
  let out = '';
  let lastWasSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    let letter = 0;
    if (c >= 65 && c <= 90) letter = c;
    else if (c >= 97 && c <= 122) letter = c - 32;
    if (letter) {
      out += String.fromCharCode(letter);
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      out += ' ';
      lastWasSpace = true;
    }
  }
  return out;
}

function packCounts(counts, size) {
  let total = 0;
  for (let i = 0; i < size; i++) total += counts[i];
  if (total === 0) throw new Error('empty corpus');

  // Unseen n-grams are treated as "would have appeared 0.1 times", which keeps
  // the penalty finite but firmly worse than anything actually observed.
  const floor = Math.log10(0.1 / total);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (counts[i] === 0) continue;
    const logp = Math.log10(counts[i] / total);
    bytes[i] = Math.max(0, Math.min(255, Math.round((logp - floor) * SCALE)));
  }
  return { bytes, floor, total };
}

/** LEB128 varint deltas of the indices of every non-zero entry, plus its score. */
function packSparse(bytes) {
  const indices = [];
  const scores = [];
  let prev = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) continue;
    let delta = i - prev;
    prev = i;
    while (delta >= 0x80) {
      indices.push((delta & 0x7f) | 0x80);
      delta >>>= 7;
    }
    indices.push(delta);
    scores.push(bytes[i]);
  }
  return { indices: Uint8Array.from(indices), scores: Uint8Array.from(scores) };
}

const VOWELS = 'AEIOU';

/**
 * Regular inflections of a stem. A literary corpus supplies plenty of letter
 * statistics but misses everyday forms ("jump" without "jumps"), and every
 * candidate here is checked against the real dictionary before being kept, so
 * over-generating costs nothing but a lookup.
 */
function inflections(stem) {
  const out = [`${stem}S`, `${stem}ED`, `${stem}ING`, `${stem}ER`, `${stem}EST`, `${stem}LY`];
  const last = stem[stem.length - 1];
  const prev = stem[stem.length - 2] ?? '';

  if (/(?:S|X|Z|CH|SH)$/.test(stem)) out.push(`${stem}ES`);
  if (last === 'E') {
    const base = stem.slice(0, -1);
    out.push(`${base}ING`, `${base}ED`, `${base}ES`, `${base}ER`, `${base}EST`);
  }
  if (last === 'Y' && !VOWELS.includes(prev)) {
    const base = stem.slice(0, -1);
    out.push(`${base}IES`, `${base}IED`, `${base}IER`, `${base}IEST`, `${base}ILY`);
  }
  // "stop" -> "stopped": a final consonant after a single vowel doubles.
  if (
    stem.length >= 3 &&
    !VOWELS.includes(last) &&
    VOWELS.includes(prev) &&
    !VOWELS.includes(stem[stem.length - 3])
  ) {
    out.push(`${stem}${last}ED`, `${stem}${last}ING`, `${stem}${last}ER`);
  }
  return out;
}

/**
 * Merge the modern frequency list, generated inflections and the corpus's own
 * vocabulary into one rank-ordered list. Position in this list is what the
 * runtime turns into a Zipf word probability, so the ordering matters: common
 * modern words first, archaic corpus tail last.
 */
function buildVocabulary(corpusCounts, freqPath, dictPath) {
  const dict = dictPath
    ? new Set(
        readFileSync(dictPath, 'utf8')
          .split(/\r?\n/)
          .map((w) => w.trim().toUpperCase())
          .filter((w) => /^[A-Z]{2,24}$/.test(w)),
      )
    : null;

  const ranked = [];
  const seen = new Set();
  const push = (w) => {
    if (w.length < 2 || seen.has(w) || ranked.length >= WORD_LIMIT) return false;
    seen.add(w);
    ranked.push(w);
    return true;
  };

  if (freqPath) {
    const lines = readFileSync(freqPath, 'utf8').split(/\r?\n/);
    for (const line of lines.slice(0, FREQ_LIMIT)) {
      const w = line.trim().toUpperCase();
      if (/^[A-Z]+$/.test(w)) push(w);
    }
  }
  const afterFreq = ranked.length;

  if (dict) {
    let added = 0;
    for (const stem of ranked.slice(0, INFLECT_FROM)) {
      if (added >= INFLECT_LIMIT) break;
      for (const form of inflections(stem)) {
        if (added >= INFLECT_LIMIT) break;
        if (dict.has(form) && push(form)) added++;
      }
    }
  }
  const afterInflect = ranked.length;

  for (const [word, count] of [...corpusCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (count < 5 || ranked.length >= WORD_LIMIT) break;
    if (dict && !dict.has(word)) continue;
    push(word);
  }

  console.log(
    `vocabulary: ${afterFreq.toLocaleString()} frequency-ranked + ` +
      `${(afterInflect - afterFreq).toLocaleString()} inflections + ` +
      `${(ranked.length - afterInflect).toLocaleString()} from corpus = ${ranked.length.toLocaleString()}`,
  );
  return ranked;
}

function main() {
  const argv = process.argv.slice(2);
  const dirs = [];
  let freqPath = null;
  let dictPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--freq') freqPath = argv[++i];
    else if (argv[i] === '--dict') dictPath = argv[++i];
    else dirs.push(argv[i]);
  }
  if (dirs.length === 0) {
    console.error(
      'usage: node scripts/build-model.mjs <corpusDir> [--freq ranked.txt] [--dict words.txt]',
    );
    process.exit(1);
  }

  const files = dirs.flatMap((d) => collectFiles(resolve(d)));
  if (files.length === 0) throw new Error('no corpus files found');
  console.log(`reading ${files.length} corpus file(s)`);

  const unigram = new Float64Array(26);
  const bigram = new Float64Array(26 ** 2);
  const trigram = new Float64Array(26 ** 3);
  const quadgram = new Float64Array(26 ** 4);
  const words = new Map();
  let letterCount = 0;
  let charCount = 0;

  for (const file of files) {
    const text = normalise(readFileSync(file, 'latin1'));
    charCount += text.length;

    for (const word of text.split(' ')) {
      if (word.length < 2) continue;
      words.set(word, (words.get(word) ?? 0) + 1);
    }

    // n-gram counts run over the letters-only stream so that word boundaries,
    // punctuation and line breaks never split an n-gram.
    let i1 = -1;
    let i2 = -1;
    let i3 = -1;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 32) continue;
      const v = c - A;
      letterCount++;
      unigram[v]++;
      if (i1 >= 0) bigram[i1 * 26 + v]++;
      if (i2 >= 0) trigram[(i2 * 26 + i1) * 26 + v]++;
      if (i3 >= 0) quadgram[((i3 * 26 + i2) * 26 + i1) * 26 + v]++;
      i3 = i2;
      i2 = i1;
      i1 = v;
    }
  }

  const uni = packCounts(unigram, 26);
  const bi = packCounts(bigram, 26 ** 2);
  const tri = packCounts(trigram, 26 ** 3);
  const quad = packCounts(quadgram, 26 ** 4);

  const observedQuads = quad.bytes.reduce((n, b) => n + (b > 0 ? 1 : 0), 0);
  console.log(
    `${charCount.toLocaleString()} chars, ${letterCount.toLocaleString()} letters, ` +
      `${words.size.toLocaleString()} distinct words, ` +
      `${observedQuads.toLocaleString()} observed quadgrams`,
  );

  const topWords = buildVocabulary(words, freqPath, dictPath);

  // Letter probabilities stay as plain floats: chi-squared needs the actual
  // distribution, not a log.
  const letterFreq = Array.from(unigram, (n) => +(n / letterCount).toFixed(8));

  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const quadSparse = packSparse(quad.bytes);
  const out = `// GENERATED FILE - do not edit by hand.
// Produced by scripts/build-model.mjs from a plain-text English corpus.
// Regenerate with: npm run build:model -- <corpusDir>
//
// Source: ${files.length} file(s), ${letterCount.toLocaleString()} letters.

/** Quantisation steps per decade of probability. */
export const SCALE = ${SCALE};

/** log10 probability assigned to an n-gram that never occurred in the corpus. */
export const UNIGRAM_FLOOR = ${uni.floor};
export const BIGRAM_FLOOR = ${bi.floor};
export const TRIGRAM_FLOOR = ${tri.floor};
export const QUADGRAM_FLOOR = ${quad.floor};

/** Relative frequency of each letter A-Z in the corpus. Sums to 1. */
export const LETTER_FREQ: readonly number[] = ${JSON.stringify(letterFreq)};

/** Dense base-26-indexed tables of quantised log10 probabilities, base64 encoded. */
export const UNIGRAM_B64 = '${b64(uni.bytes)}';
export const BIGRAM_B64 = '${b64(bi.bytes)}';
export const TRIGRAM_B64 =
  '${b64(tri.bytes)}';

/**
 * Quadgram table, sparse: ${quadSparse.scores.length.toLocaleString()} observed of ${(26 ** 4).toLocaleString()} slots.
 * QUADGRAM_INDEX_B64 holds ascending slot indices as LEB128 deltas; the nth
 * varint pairs with the nth byte of QUADGRAM_SCORE_B64.
 */
export const QUADGRAM_COUNT = ${quadSparse.scores.length};
export const QUADGRAM_INDEX_B64 =
  '${b64(quadSparse.indices)}';
export const QUADGRAM_SCORE_B64 =
  '${b64(quadSparse.scores)}';

/** Vocabulary of ${topWords.length.toLocaleString()} words, most frequent first. */
export const WORDS = '${topWords.join(' ')}';
`;

  const dest = resolve('src/core/scoring/model.generated.ts');
  writeFileSync(dest, out);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`wrote ${dest} (${kb(out.length)})`);
  console.log(
    `  quadgram sparse ${kb(b64(quadSparse.indices).length + b64(quadSparse.scores).length)} ` +
      `(dense would be ${kb(b64(quad.bytes).length)}), ` +
      `trigram ${kb(b64(tri.bytes).length)}, words ${kb(topWords.join(' ').length)}`,
  );
}

main();

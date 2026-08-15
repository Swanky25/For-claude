import { lettersOnly, printableRatio } from './bytes';
import { fitness } from './scoring/score';
import { autoOperations } from './registry';
import type { Finding, Operation, Sample, Step } from './types';

export interface SolveOptions {
  /** How many layers deep to peel. */
  maxDepth?: number;
  /** How many partial results to carry forward at each depth. */
  beamWidth?: number;
  maxResults?: number;
  /** Stop expanding once this much wall-clock time has been spent. */
  timeBudgetMs?: number;
  /** Restrict the search to these operation ids. */
  only?: string[];
}

const DEFAULTS = {
  maxDepth: 3,
  beamWidth: 6,
  maxResults: 12,
  timeBudgetMs: 5000,
};

interface Node {
  sample: Sample;
  steps: Step[];
  score: number;
  /** Product of the priors of every step taken to get here. */
  priorProduct: number;
  /** Ranking used to decide what to explore next; see `promiseOf`. */
  promise: number;
}

/**
 * Credit given to a clean structural decode when deciding what to explore next.
 *
 * Intermediate layers are the crux of multi-layer solving: the Base64 sitting
 * inside another Base64 is *not supposed to look like English*, so ranking the
 * frontier on englishness alone throws the real chain away in favour of cipher
 * output that happens to score slightly higher. An encoding that decodes
 * cleanly is strong evidence in its own right — Base64 with valid padding
 * rarely yields fully printable output by accident — so it earns a place in the
 * beam regardless of whether the result reads as English yet.
 */
const STRUCTURAL_BONUS = 0.35;

/**
 * A result this English is treated as the answer and is not transformed again.
 *
 * Without this the search happily keeps going after it has already won, and
 * because the plaintext is now the input, the next layer of ciphers produces
 * near-copies of it that score almost as well — burying the real answer under
 * a dozen slightly-corrupted twins of itself.
 */
const SOLVED_THRESHOLD = 0.62;

function promiseOf(op: Operation, output: Sample, score: number, priorProduct: number): number {
  const clean = op.category === 'encoding' && printableRatio(output.bytes) > 0.95;
  return score + (clean ? STRUCTURAL_BONUS * priorProduct : 0);
}

/**
 * Confidence blends three things: how English the output looks, how much each
 * operation trusted its own result, and how many layers were needed. The depth
 * term is a tie-breaker — given two chains that produce equally good text, the
 * shorter explanation is the better one.
 */
function confidenceOf(score: number, priorProduct: number, depth: number): number {
  const priorFactor = 0.65 + 0.35 * priorProduct;
  const depthPenalty = Math.pow(0.94, Math.max(0, depth - 1));
  return score * priorFactor * depthPenalty;
}

/** Cheap identity for cycle detection; long outputs only need a prefix. */
function signature(sample: Sample): string {
  const text = sample.text;
  return text.length <= 512 ? text : `${text.length}:${text.slice(0, 256)}${text.slice(-128)}`;
}

/**
 * Peel layers of encoding and cipher off an input until something looks like
 * English.
 *
 * This is a beam search rather than an exhaustive one. Each layer multiplies
 * the branching factor — most operations return several candidate outputs —
 * so the search keeps only the most promising nodes at each depth. That is
 * what makes chains like "Base64 of ROT13 of Morse" tractable while still
 * terminating quickly on input that is not encoded at all.
 */
export function solve(input: Sample, options: SolveOptions = {}): Finding[] {
  const { maxDepth, beamWidth, maxResults, timeBudgetMs } = { ...DEFAULTS, ...options };
  const started = Date.now();

  let pool = autoOperations;
  if (options.only) {
    const wanted = new Set(options.only);
    pool = pool.filter((op) => wanted.has(op.id));
  }

  const baseFitness = fitness(input);
  const findings: Finding[] = [];
  const seen = new Set<string>([signature(input)]);

  // The input itself is a legitimate answer: it may simply not be encoded.
  findings.push({
    steps: [],
    output: input,
    score: baseFitness.score,
    confidence: baseFitness.score,
    segmented: baseFitness.segmented,
  });

  let frontier: Node[] = [
    { sample: input, steps: [], score: baseFitness.score, priorProduct: 1, promise: 1 },
  ];

  for (let depth = 0; depth < maxDepth; depth++) {
    if (Date.now() - started > timeBudgetMs) break;

    const next: Node[] = [];

    for (const node of frontier) {
      for (const op of pool) {
        if (Date.now() - started > timeBudgetMs) break;
        // Expensive crackers are worth their cost on the original input and on
        // a first successful decode, but not deep in a speculative chain.
        if (op.expensive && depth > 1) continue;
        if (!isApplicable(op, node.sample)) continue;

        let results;
        try {
          results = op.run(node.sample);
        } catch {
          continue; // a decoder that throws simply does not apply
        }

        for (const result of results) {
          const sig = signature(result.output);
          if (seen.has(sig)) continue;
          seen.add(sig);

          const measured = fitness(result.output);
          const steps: Step[] = [
            ...node.steps,
            { opId: op.id, label: op.label, detail: result.detail, params: result.params },
          ];
          const priorProduct = node.priorProduct * (result.prior ?? 1);

          findings.push({
            steps,
            output: result.output,
            score: measured.score,
            confidence: confidenceOf(measured.score, priorProduct, steps.length),
            segmented: measured.segmented,
          });

          if (measured.score < SOLVED_THRESHOLD) {
            next.push({
              sample: result.output,
              steps,
              score: measured.score,
              priorProduct,
              promise: promiseOf(op, result.output, measured.score, priorProduct),
            });
          }
        }
      }
    }

    if (next.length === 0) break;
    frontier = next.sort((a, b) => b.promise - a.promise).slice(0, beamWidth);
  }

  return dedupe(findings.sort((a, b) => b.confidence - a.confidence)).slice(0, maxResults);
}

/**
 * Drop findings whose text differs from a better one only in punctuation,
 * spacing or case — the same recovered message reached by a longer route.
 */
function dedupe(sorted: Finding[]): Finding[] {
  const kept: Finding[] = [];
  const seenText = new Set<string>();
  for (const finding of sorted) {
    const key = lettersOnly(finding.output.text) || finding.output.text.trim();
    if (seenText.has(key)) continue;
    seenText.add(key);
    kept.push(finding);
  }
  return kept;
}

function isApplicable(op: Operation, sample: Sample): boolean {
  if (!op.applicable) return true;
  try {
    return op.applicable(sample);
  } catch {
    return false;
  }
}

/**
 * A one-line summary of a decode chain, e.g. "Base64 -> Caesar (shift 13)".
 */
export function describeChain(finding: Finding): string {
  if (finding.steps.length === 0) return 'no transformation';
  return finding.steps
    .map((step) => (step.detail ? `${step.label} (${step.detail})` : step.label))
    .join(' → ');
}

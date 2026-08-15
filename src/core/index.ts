/** Public surface of the decipher engine, independent of any UI. */

export * from './types';
export {
  EMPTY,
  bytesToBase64,
  fromBytes,
  fromBytesAuto,
  fromLatin1,
  fromText,
  latin1Bytes,
  lettersOnly,
  looksBinary,
  printableRatio,
  toHex,
} from './bytes';
export { applicableOperations, autoOperations, getOperation, operations } from './registry';
export { describeChain, solve, type SolveOptions } from './magic';
export {
  fitness,
  indexOfCoincidence,
  letterCounts,
  ngramLogProb,
  scoreText,
  segment,
  wordCoverage,
  type Fitness,
} from './scoring/score';

/** Core vocabulary shared by every decoder, cracker and the solver. */

/**
 * A value flowing through the pipeline.
 *
 * Everything is fundamentally bytes — Base64 and XOR happily produce data that
 * is not valid text — but most classical ciphers are defined over characters.
 * A Sample therefore carries both views, kept in sync by the constructors in
 * `bytes.ts`, so each operation can use whichever is natural for it.
 */
export interface Sample {
  readonly bytes: Uint8Array;
  /** UTF-8 view of `bytes`, lossy for binary data. */
  readonly text: string;
}

export type Category = 'encoding' | 'classical' | 'modern' | 'utility';

/** A parameter an operation accepts when driven manually from the UI. */
export interface ParamSpec {
  name: string;
  label: string;
  type: 'string' | 'number' | 'select';
  /** Options for `select`. */
  options?: string[];
  default?: string | number;
  placeholder?: string;
}

export type ParamValues = Record<string, string | number | undefined>;

/** One candidate output produced by an operation. */
export interface OperationResult {
  output: Sample;
  /** Recovered parameters, rendered as a short human-readable summary. */
  detail?: string;
  /** Machine-readable form of `detail`, so the UI can offer "re-run with these". */
  params?: ParamValues;
  /**
   * The operation's own confidence in this result, independent of how English
   * the output looks: 1 for a lossless structural decode such as Base64, lower
   * for a statistical guess such as a Vigenere key. Used to break ties between
   * candidates that score alike.
   */
  prior?: number;
}

export interface Operation {
  id: string;
  label: string;
  category: Category;
  /** One-line explanation shown in the UI. */
  description: string;
  /**
   * Cheap structural pre-check. When it returns false the operation is skipped
   * without running, which is what keeps the recursive solver tractable.
   */
  applicable?(input: Sample): boolean;
  run(input: Sample, params?: ParamValues): OperationResult[];
  /**
   * Operations that cannot work without a user-supplied secret. These are
   * excluded from the automatic solver and only offered manually.
   */
  requiresKey?: boolean;
  params?: ParamSpec[];
  /**
   * Relative cost hint. The solver expands cheap operations at every node but
   * reserves expensive ones (substitution hill-climbing) for promising nodes.
   */
  expensive?: boolean;
}

/** One link in a decode chain. */
export interface Step {
  opId: string;
  label: string;
  detail?: string;
  params?: ParamValues;
}

/** A complete result from the recursive solver. */
export interface Finding {
  /** The operations applied, outermost layer first. */
  steps: Step[];
  output: Sample;
  /** English fitness of `output`, 0..1. */
  score: number;
  /** Overall confidence, blending fitness with each step's prior. */
  confidence: number;
  /** Plausible word segmentation when the output has no spaces of its own. */
  segmented?: string;
}

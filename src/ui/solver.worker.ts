/// <reference lib="webworker" />
import { fromText, lettersOnly, printableRatio } from '../core/bytes';
import { solve } from '../core/magic';
import { applicableOperations, autoOperations, getOperation, operations } from '../core/registry';
import { fitness, indexOfCoincidence } from '../core/scoring/score';
import type { Category, Finding, ParamSpec, ParamValues, SolveOptions } from '../core';

/**
 * The engine runs here rather than on the main thread.
 *
 * Solving is synchronous and deliberately compute-heavy — substitution hill
 * climbing alone evaluates hundreds of thousands of candidate plaintexts — so
 * running it inline would lock the page for seconds at a time.
 */

/** The serialisable description of an operation the UI needs to render it. */
export interface OperationMeta {
  id: string;
  label: string;
  category: Category;
  description: string;
  requiresKey: boolean;
  params: ParamSpec[];
}

export interface InputAnalysis {
  length: number;
  bytes: number;
  letters: number;
  digits: number;
  printable: number;
  indexOfCoincidence: number;
  /** Ids of the automatic operations whose structural pre-check passes. */
  applicable: string[];
}

export type WorkerRequest =
  | { id: number; type: 'solve'; text: string; options?: SolveOptions }
  | { id: number; type: 'run'; opId: string; text: string; params?: ParamValues }
  | { id: number; type: 'catalog' }
  | { id: number; type: 'analyse'; text: string };

export type WorkerResponse =
  | { id: number; type: 'solved'; findings: Finding[]; elapsedMs: number }
  | { id: number; type: 'ran'; findings: Finding[] }
  | { id: number; type: 'catalog'; operations: OperationMeta[] }
  | { id: number; type: 'analysis'; analysis: InputAnalysis }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'catalog') {
      ctx.postMessage({
        id: request.id,
        type: 'catalog',
        operations: operations.map((op) => ({
          id: op.id,
          label: op.label,
          category: op.category,
          description: op.description,
          requiresKey: op.requiresKey ?? false,
          params: op.params ?? [],
        })),
      } satisfies WorkerResponse);
      return;
    }

    if (request.type === 'analyse') {
      const sample = fromText(request.text);
      const letters = lettersOnly(request.text);
      ctx.postMessage({
        id: request.id,
        type: 'analysis',
        analysis: {
          length: request.text.length,
          bytes: sample.bytes.length,
          letters: letters.length,
          digits: (request.text.match(/\d/g) ?? []).length,
          printable: printableRatio(sample.bytes),
          indexOfCoincidence: indexOfCoincidence(letters),
          applicable: applicableOperations(sample, autoOperations).map((op) => op.id),
        },
      } satisfies WorkerResponse);
      return;
    }

    if (request.type === 'solve') {
      const started = Date.now();
      const findings = solve(fromText(request.text), request.options);
      const response: WorkerResponse = {
        id: request.id,
        type: 'solved',
        findings,
        elapsedMs: Date.now() - started,
      };
      ctx.postMessage(response);
      return;
    }

    const operation = getOperation(request.opId);
    if (!operation) throw new Error(`unknown operation "${request.opId}"`);

    const input = fromText(request.text);
    const findings: Finding[] = operation.run(input, request.params).map((result) => {
      const measured = fitness(result.output);
      return {
        steps: [
          {
            opId: operation.id,
            label: operation.label,
            detail: result.detail,
            params: result.params,
          },
        ],
        output: result.output,
        score: measured.score,
        confidence: result.prior ?? 1,
        segmented: measured.segmented,
      };
    });

    ctx.postMessage({ id: request.id, type: 'ran', findings } satisfies WorkerResponse);
  } catch (error) {
    ctx.postMessage({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
});

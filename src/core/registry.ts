import { classicalOperations } from './operations/classical';
import { encodingOperations } from './operations/encodings';
import { modernOperations } from './operations/modern';
import type { Operation, Sample } from './types';

/** Every operation the engine knows about. */
export const operations: Operation[] = [
  ...encodingOperations,
  ...classicalOperations,
  ...modernOperations,
];

const byId = new Map(operations.map((op) => [op.id, op]));

export function getOperation(id: string): Operation | undefined {
  return byId.get(id);
}

/**
 * Operations the automatic solver may try.
 *
 * Anything needing a secret is excluded: without the key there is nothing to
 * search, and running it would only produce noise.
 */
export const autoOperations: Operation[] = operations.filter((op) => !op.requiresKey);

/** Operations whose structural pre-check passes for this input. */
export function applicableOperations(sample: Sample, list = operations): Operation[] {
  return list.filter((op) => {
    try {
      return op.applicable ? op.applicable(sample) : true;
    } catch {
      return false;
    }
  });
}

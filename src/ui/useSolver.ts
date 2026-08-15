import { useCallback, useEffect, useRef } from 'react';
import type { Finding, ParamValues, SolveOptions } from '../core';
import type {
  InputAnalysis,
  OperationMeta,
  WorkerRequest,
  WorkerResponse,
} from './solver.worker';

/**
 * `Omit` over a union collapses it to the properties the members share, which
 * would erase the discriminated shape of a request. Distributing over the union
 * first keeps each variant intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

export interface SolveOutcome {
  findings: Finding[];
  elapsedMs: number;
}

/**
 * Owns the solver worker and turns its message protocol into promises.
 *
 * The worker holds the entire engine — including the ~200 KB language model —
 * so the UI bundle stays free of it. Requests are correlated by id so several
 * can be outstanding at once and a slow automatic solve never resolves into the
 * slot of a quick analysis.
 */
export function useSolver() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  useEffect(() => {
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = pending.current.get(message.id);
      if (!entry) return;
      pending.current.delete(message.id);
      if (message.type === 'error') entry.reject(new Error(message.message));
      else entry.resolve(message);
    });
    workerRef.current = worker;

    const inFlight = pending.current;
    return () => {
      worker.terminate();
      workerRef.current = null;
      for (const entry of inFlight.values()) {
        entry.reject(new Error('solver stopped'));
      }
      inFlight.clear();
    };
  }, []);

  const send = useCallback(
    (request: DistributiveOmit<WorkerRequest, 'id'>): Promise<WorkerResponse> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error('solver is still starting up'));
      const id = nextId.current++;
      return new Promise<WorkerResponse>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        worker.postMessage({ ...request, id } as WorkerRequest);
      });
    },
    [],
  );

  const solveText = useCallback(
    async (text: string, options?: SolveOptions): Promise<SolveOutcome> => {
      const response = await send({ type: 'solve', text, options });
      if (response.type !== 'solved') throw new Error('unexpected solver response');
      return { findings: response.findings, elapsedMs: response.elapsedMs };
    },
    [send],
  );

  const runOperation = useCallback(
    async (opId: string, text: string, params?: ParamValues): Promise<Finding[]> => {
      const response = await send({ type: 'run', opId, text, params });
      if (response.type !== 'ran') throw new Error('unexpected solver response');
      return response.findings;
    },
    [send],
  );

  const getCatalog = useCallback(async (): Promise<OperationMeta[]> => {
    const response = await send({ type: 'catalog' });
    if (response.type !== 'catalog') throw new Error('unexpected solver response');
    return response.operations;
  }, [send]);

  const analyse = useCallback(
    async (text: string): Promise<InputAnalysis> => {
      const response = await send({ type: 'analyse', text });
      if (response.type !== 'analysis') throw new Error('unexpected solver response');
      return response.analysis;
    },
    [send],
  );

  return { solveText, runOperation, getCatalog, analyse };
}

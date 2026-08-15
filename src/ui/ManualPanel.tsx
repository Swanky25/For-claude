import { useMemo, useState } from 'react';
import type { Finding, ParamValues } from '../core';
import { ResultList } from './Results';
import type { OperationMeta } from './solver.worker';

const CATEGORY_LABELS: Record<string, string> = {
  encoding: 'Encodings',
  classical: 'Classical ciphers',
  modern: 'Modern crypto',
  utility: 'Utilities',
};

/**
 * Drive a single operation by hand.
 *
 * The automatic solver deliberately skips anything that needs a secret, so this
 * is the only route to AES, DES, 3DES and RC4 — and it is also how you override
 * the solver when you already know the shift or the keyword.
 */
export function ManualPanel({
  input,
  catalog,
  onRun,
  onUseAsInput,
}: {
  input: string;
  catalog: OperationMeta[];
  onRun: (opId: string, text: string, params: ParamValues) => Promise<Finding[]>;
  onUseAsInput: (text: string) => void;
}) {
  const [opId, setOpId] = useState<string | null>(null);
  const [params, setParams] = useState<ParamValues>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const groups = new Map<string, OperationMeta[]>();
    for (const op of catalog) {
      const list = groups.get(op.category) ?? [];
      list.push(op);
      groups.set(op.category, list);
    }
    return groups;
  }, [catalog]);

  if (catalog.length === 0) {
    return <p className="empty">Loading operations…</p>;
  }

  const operation = catalog.find((op) => op.id === opId) ?? catalog[0];

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const results = await onRun(operation.id, input, params);
      setFindings(results);
      if (results.length === 0) {
        setError(
          operation.requiresKey
            ? 'No output. Check the key, mode and ciphertext format — a wrong key usually fails the padding check.'
            : 'This operation produced no result for the current input.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor="operation">Operation</label>
        <select
          id="operation"
          value={operation.id}
          onChange={(event) => {
            setOpId(event.target.value);
            setParams({});
            setFindings([]);
            setError(null);
          }}
        >
          {[...grouped.entries()].map(([category, ops]) => (
            <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
              {ops.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <p className="op-description">{operation.description}</p>

      {operation.params?.map((spec) => (
        <div className="field" key={spec.name}>
          <label htmlFor={`param-${spec.name}`}>{spec.label}</label>
          {spec.type === 'select' ? (
            <select
              id={`param-${spec.name}`}
              value={String(params[spec.name] ?? spec.default ?? spec.options?.[0] ?? '')}
              onChange={(event) => setParams({ ...params, [spec.name]: event.target.value })}
            >
              {spec.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`param-${spec.name}`}
              type={spec.type === 'number' ? 'number' : 'text'}
              placeholder={spec.placeholder}
              value={String(params[spec.name] ?? '')}
              onChange={(event) => setParams({ ...params, [spec.name]: event.target.value })}
            />
          )}
        </div>
      ))}

      <div className="controls">
        <button type="button" className="primary" onClick={apply} disabled={busy || !input}>
          {busy ? 'Working…' : 'Apply'}
        </button>
        {operation.requiresKey && (
          <span className="op-description" style={{ margin: 0 }}>
            Needs a key — excluded from automatic solving.
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {findings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <ResultList findings={findings} onUseAsInput={onUseAsInput} />
        </div>
      )}
    </>
  );
}

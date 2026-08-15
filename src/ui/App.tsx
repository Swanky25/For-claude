import { useCallback, useEffect, useState } from 'react';
import type { Finding } from '../core';
import { Analysis } from './Analysis';
import { ManualPanel } from './ManualPanel';
import { ResultList } from './Results';
import { examples } from './examples';
import type { InputAnalysis, OperationMeta } from './solver.worker';
import { useSolver } from './useSolver';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; elapsedMs: number; count: number }
  | { kind: 'error'; message: string };

export function App() {
  const { solveText, runOperation, getCatalog, analyse } = useSolver();
  const [input, setInput] = useState('');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [deep, setDeep] = useState(false);
  const [catalog, setCatalog] = useState<OperationMeta[]>([]);
  const [analysis, setAnalysis] = useState<InputAnalysis | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, [getCatalog]);

  // Analysis is cheap but crosses a thread boundary, so debounce it rather than
  // firing a message on every keystroke.
  useEffect(() => {
    if (!input) {
      setAnalysis(null);
      return;
    }
    const timer = setTimeout(() => {
      analyse(input)
        .then(setAnalysis)
        .catch(() => setAnalysis(null));
    }, 150);
    return () => clearTimeout(timer);
  }, [input, analyse]);

  const decipher = useCallback(async () => {
    if (!input.trim()) return;
    setStatus({ kind: 'working' });
    try {
      const { findings: results, elapsedMs } = await solveText(input, {
        maxDepth: deep ? 4 : 3,
        beamWidth: deep ? 10 : 6,
        timeBudgetMs: deep ? 15000 : 5000,
      });
      setFindings(results);
      setStatus({ kind: 'done', elapsedMs, count: results.length });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, [input, deep, solveText]);

  const useAsInput = useCallback((text: string) => {
    setInput(text);
    setFindings([]);
    setStatus({ kind: 'idle' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <h1>Universal Decipher</h1>
        <span className="tagline">
          Detects and peels away encodings and ciphers until something reads like English.
        </span>
      </header>

      <div className="layout">
        <div>
          <section className="panel">
            <h2>Input</h2>
            <textarea
              value={input}
              spellCheck={false}
              placeholder="Paste ciphertext, an encoded blob, a token — anything."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') decipher();
              }}
            />
            <div className="controls">
              <button
                type="button"
                className="primary"
                onClick={decipher}
                disabled={status.kind === 'working' || !input.trim()}
              >
                {status.kind === 'working' ? 'Deciphering…' : 'Decipher'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput('');
                  setFindings([]);
                  setStatus({ kind: 'idle' });
                }}
                disabled={!input}
              >
                Clear
              </button>
              <label style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                <input
                  type="checkbox"
                  checked={deep}
                  style={{ width: 'auto', marginRight: 6 }}
                  onChange={(event) => setDeep(event.target.checked)}
                />
                deeper search (slower)
              </label>
              {status.kind === 'done' && (
                <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
                  {status.count} candidates in {status.elapsedMs} ms
                </span>
              )}
            </div>

            <div className="examples">
              {examples.map((example) => (
                <button
                  type="button"
                  key={example.label}
                  onClick={() => {
                    setInput(example.text);
                    setFindings([]);
                    setStatus({ kind: 'idle' });
                  }}
                >
                  {example.label}
                </button>
              ))}
            </div>
            {status.kind === 'error' && <p className="error">{status.message}</p>}
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <h2>Analysis</h2>
            <Analysis analysis={analysis} catalog={catalog} />
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <h2>Manual operation</h2>
            <ManualPanel
              input={input}
              catalog={catalog}
              onRun={runOperation}
              onUseAsInput={useAsInput}
            />
          </section>
        </div>

        <div>
          <section className="panel">
            <h2>Candidates, best first</h2>
            {status.kind === 'working' ? (
              <p className="empty">Searching decode chains…</p>
            ) : (
              <ResultList findings={findings} onUseAsInput={useAsInput} />
            )}
          </section>
        </div>
      </div>

      <footer>
        Everything runs locally in your browser — nothing is uploaded. Hashes are one-way and
        properly keyed modern encryption cannot be broken without the key.
      </footer>
    </div>
  );
}

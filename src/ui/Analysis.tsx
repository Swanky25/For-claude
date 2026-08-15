import type { InputAnalysis, OperationMeta } from './solver.worker';

/**
 * What the index of coincidence implies about the cipher family.
 *
 * English sits near 0.066. A monoalphabetic cipher — Caesar, Atbash,
 * substitution — permutes letters without changing how often they collide, so
 * it preserves that value. Polyalphabetic ciphers flatten it toward the 0.038
 * of uniformly random letters.
 */
function interpretIC(ic: number, letters: number): string {
  if (letters < 20) return 'too little text';
  if (ic >= 0.06) return 'monoalphabetic or plain';
  if (ic >= 0.05) return 'probably monoalphabetic';
  if (ic >= 0.042) return 'possibly polyalphabetic';
  return 'polyalphabetic or not letters';
}

export function Analysis({
  analysis,
  catalog,
}: {
  analysis: InputAnalysis | null;
  catalog: OperationMeta[];
}) {
  if (!analysis || analysis.length === 0) {
    return <p className="empty">Statistics appear once there is input.</p>;
  }

  const labelFor = (id: string) => catalog.find((op) => op.id === id);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">Length</div>
          <div className="value">{analysis.length}</div>
          <div className="note">{analysis.bytes} bytes</div>
        </div>
        <div className="stat">
          <div className="label">Letters</div>
          <div className="value">{analysis.letters}</div>
          <div className="note">{analysis.digits} digits</div>
        </div>
        <div className="stat">
          <div className="label">Printable</div>
          <div className="value">{Math.round(analysis.printable * 100)}%</div>
          <div className="note">{analysis.printable > 0.95 ? 'text' : 'binary content'}</div>
        </div>
        <div className="stat">
          <div className="label">Index of coincidence</div>
          <div className="value">{analysis.indexOfCoincidence.toFixed(4)}</div>
          <div className="note">{interpretIC(analysis.indexOfCoincidence, analysis.letters)}</div>
        </div>
      </div>

      <div className="tags">
        {analysis.applicable.length === 0 ? (
          <span className="tag">no automatic decoder matches this shape</span>
        ) : (
          analysis.applicable.map((id) => {
            const op = labelFor(id);
            return (
              <span className="tag" key={id} title={op?.description}>
                {op?.label ?? id}
              </span>
            );
          })
        )}
      </div>
      <p className="notice">
        Tags show which decoders the input's <em>shape</em> allows — not what it actually is. The
        solver tries them all and ranks the results by how much like English the output looks.
      </p>
    </>
  );
}

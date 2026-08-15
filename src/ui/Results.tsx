import { useState } from 'react';
import type { Finding } from '../core';

/** "Base64 → Caesar (shift 13)". Kept local so the UI imports no engine code. */
function describeChain(finding: Finding): string {
  return finding.steps
    .map((step) => (step.detail ? `${step.label} (${step.detail})` : step.label))
    .join(' → ');
}

function confidenceColour(value: number): string {
  if (value >= 0.6) return 'var(--good)';
  if (value >= 0.35) return 'var(--warn)';
  return 'var(--bad)';
}

function Meter({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="confidence" title={`confidence ${pct}%`}>
      <div className="meter">
        <span style={{ width: `${pct}%`, background: confidenceColour(value) }} />
      </div>
      {pct}%
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

const PREVIEW_LIMIT = 1200;

export function ResultCard({
  finding,
  isTop,
  onUseAsInput,
}: {
  finding: Finding;
  isTop: boolean;
  onUseAsInput: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = finding.output.text;
  const truncated = !expanded && text.length > PREVIEW_LIMIT;
  const shown = truncated ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;

  return (
    <div className={isTop ? 'result top' : 'result'}>
      <div className="result-head">
        <div className="chain">
          {finding.steps.length === 0 ? (
            <span className="muted">no transformation — input already looks like plain text</span>
          ) : (
            describeChain(finding)
          )}
        </div>
        <Meter value={finding.confidence} />
      </div>

      <pre className="output">{shown || <span className="muted">(empty)</span>}</pre>

      {finding.segmented && (
        <div className="segmented">
          <strong>with spacing restored</strong>
          {finding.segmented.length > 400
            ? `${finding.segmented.slice(0, 400)}…`
            : finding.segmented}
        </div>
      )}

      <div className="result-actions">
        <CopyButton text={text} />
        <button type="button" className="ghost" onClick={() => onUseAsInput(text)}>
          use as input
        </button>
        {text.length > PREVIEW_LIMIT && (
          <button type="button" className="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'show less' : `show all ${text.length} chars`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Candidates shown before the rest are folded away. */
const ALWAYS_SHOWN = 3;

export function ResultList({
  findings,
  onUseAsInput,
}: {
  findings: Finding[];
  onUseAsInput: (text: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (findings.length === 0) {
    return <p className="empty">Nothing yet — paste something and press Decipher.</p>;
  }

  // The solver ranks exhaustively, but once it has a confident winner the tail
  // is failed guesses. Keep them reachable without making them the first thing
  // you read.
  const visible = showAll ? findings : findings.slice(0, ALWAYS_SHOWN);
  const hidden = findings.length - visible.length;

  return (
    <>
      {visible.map((finding, index) => (
        <ResultCard
          key={`${finding.steps.map((s) => s.opId).join('>')}-${index}`}
          finding={finding}
          isTop={index === 0}
          onUseAsInput={onUseAsInput}
        />
      ))}
      {hidden > 0 && (
        <button type="button" className="ghost" onClick={() => setShowAll(true)}>
          show {hidden} lower-confidence candidate{hidden === 1 ? '' : 's'}
        </button>
      )}
      {showAll && findings.length > ALWAYS_SHOWN && (
        <button type="button" className="ghost" onClick={() => setShowAll(false)}>
          collapse
        </button>
      )}
    </>
  );
}

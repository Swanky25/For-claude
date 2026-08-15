import { describe, expect, it } from 'vitest';
import { bytesToBase64, fromText, lettersOnly } from '../src/core/bytes';
import { describeChain, solve } from '../src/core/magic';
import { shiftText } from '../src/core/operations/classical';

const PLAIN = `It was a bright cold day in April and the clocks were striking
thirteen. Winston Smith slipped quickly through the glass doors of Victory
Mansions though not quickly enough to prevent a swirl of gritty dust from
entering along with him.`;

const SHORT = 'Meet me at the old bridge at midnight and bring the documents.';

const encode = (text: string) => bytesToBase64(new TextEncoder().encode(text));
const toHex = (text: string) =>
  [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The winning finding, or a helpful failure message. */
function best(input: string, options = {}) {
  const results = solve(fromText(input), options);
  expect(results.length).toBeGreaterThan(0);
  return results[0];
}

describe('single-layer solving', () => {
  it('recognises plain text as already decoded', () => {
    const top = best(PLAIN);
    expect(top.steps).toHaveLength(0);
    expect(top.output.text).toBe(PLAIN);
  });

  it('solves Base64', () => {
    const top = best(encode(SHORT));
    expect(top.output.text).toBe(SHORT);
    expect(describeChain(top)).toBe('Base64');
  });

  it('solves hex', () => {
    const top = best(toHex(SHORT));
    expect(top.output.text).toBe(SHORT);
    expect(describeChain(top)).toContain('Hex');
  });

  it('solves ROT13', () => {
    const top = best(shiftText(SHORT, 13));
    expect(top.output.text).toBe(SHORT);
    expect(describeChain(top)).toContain('shift 13');
  });

  it('solves Morse', () => {
    const morse = '.... . .-.. .-.. --- / - .... . .-. . / -- -.-- / ..-. .-. .. . -. -..';
    const top = best(morse);
    expect(top.output.text).toBe('HELLO THERE MY FRIEND');
  });

  it('solves binary', () => {
    const bits = [...new TextEncoder().encode(SHORT)]
      .map((b) => b.toString(2).padStart(8, '0'))
      .join('');
    expect(best(bits).output.text).toBe(SHORT);
  });
});

describe('multi-layer solving', () => {
  it('peels Base64 wrapped around ROT13', () => {
    const top = best(encode(shiftText(SHORT, 13)));
    expect(top.output.text).toBe(SHORT);
    const chain = describeChain(top);
    expect(chain).toContain('Base64');
    expect(chain).toContain('shift 13');
  });

  it('peels Base64 wrapped around hex', () => {
    const top = best(encode(toHex(SHORT)));
    expect(top.output.text).toBe(SHORT);
  });

  it('peels three layers: Base64 of Base64 of ROT13', () => {
    const top = best(encode(encode(shiftText(SHORT, 13))), { maxDepth: 4 });
    expect(top.output.text).toBe(SHORT);
    expect(top.steps.length).toBe(3);
  });

  it('peels a Vigenere inside Base64', () => {
    const encrypt = (text: string, key: string) => {
      let out = '';
      let j = 0;
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        const base = code >= 65 && code <= 90 ? 65 : code >= 97 && code <= 122 ? 97 : 0;
        if (!base) {
          out += ch;
          continue;
        }
        out += String.fromCharCode(
          ((code - base + (key.charCodeAt(j % key.length) - 65)) % 26) + base,
        );
        j++;
      }
      return out;
    };
    const top = best(encode(encrypt(PLAIN, 'LEMON')), { maxDepth: 3 });
    expect(top.output.text).toBe(PLAIN);
    expect(describeChain(top)).toContain('LEMON');
  });
});

describe('ranking behaviour', () => {
  it('ranks the true decoding above the alternatives', () => {
    const results = solve(fromText(encode(SHORT)));
    expect(results[0].output.text).toBe(SHORT);
    expect(results[0].confidence).toBeGreaterThan(results[1].confidence);
  });

  it('gives plaintext a clearly higher score than any garbage candidate', () => {
    const results = solve(fromText(encode(SHORT)));
    const winner = results[0];
    const others = results.slice(1);
    expect(winner.score).toBeGreaterThan(0.5);
    for (const other of others) {
      expect(other.score).toBeLessThan(winner.score);
    }
  });

  it('reports a segmentation for unspaced plaintext', () => {
    const top = best(shiftText(lettersOnly(SHORT), 5));
    // Segmentation scores words independently, so genuinely ambiguous joins
    // ("me at" vs "meat") can go either way. What matters is that the bulk of
    // the phrase comes back readable.
    expect(top.segmented).toContain('the old bridge at midnight');
    expect(top.segmented).toContain('bring the documents');
  });

  it('stays within its time budget on stubborn input', () => {
    const started = Date.now();
    solve(fromText('QZXJVKWBFPGYHMUCTNRSLDOAIE'.repeat(12)), { timeBudgetMs: 1500 });
    expect(Date.now() - started).toBeLessThan(6000);
  });

  it('respects an operation allow-list', () => {
    const results = solve(fromText(encode(SHORT)), { only: ['base64'] });
    const used = new Set(results.flatMap((r) => r.steps.map((s) => s.opId)));
    expect([...used]).toEqual(['base64']);
  });
});

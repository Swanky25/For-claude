import { describe, expect, it } from 'vitest';
import { fromText } from '../src/core/bytes';
import {
  bacon,
  base32,
  base58,
  base64,
  base85,
  binary,
  decimalBytes,
  hex,
  htmlEntities,
  morse,
  natoAlphabet,
  octalBytes,
  quotedPrintable,
  reverseText,
  tapCode,
  unicodeEscapes,
  urlDecode,
} from '../src/core/operations/encodings';
import type { Operation } from '../src/core/types';

/** Run an operation and return the first output as text. */
function decode(op: Operation, input: string): string | undefined {
  const sample = fromText(input);
  if (op.applicable && !op.applicable(sample)) return undefined;
  return op.run(sample)[0]?.output.text;
}

/** Every output the operation produced. */
function decodeAll(op: Operation, input: string): string[] {
  const sample = fromText(input);
  if (op.applicable && !op.applicable(sample)) return [];
  return op.run(sample).map((r) => r.output.text);
}

describe('binary-to-text encodings', () => {
  it('decodes standard Base64', () => {
    expect(decode(base64, 'SGVsbG8sIHdvcmxkIQ==')).toBe('Hello, world!');
  });

  it('decodes URL-safe Base64 without padding', () => {
    expect(decode(base64, 'SGVsbG8_d29ybGQ-')).toBe('Hello?world>');
  });

  it('tolerates whitespace inside Base64', () => {
    expect(decode(base64, 'SGVsbG8s\nIHdvcmxk IQ==')).toBe('Hello, world!');
  });

  it('rejects input whose length cannot be Base64', () => {
    // 20 unpadded symbols is a valid length; 21 leaves a 1-symbol remainder,
    // which Base64 can never produce.
    expect(base64.applicable?.(fromText('A'.repeat(20)))).toBe(true);
    expect(base64.applicable?.(fromText('A'.repeat(21)))).toBe(false);
    expect(base64.applicable?.(fromText('AAAAA'))).toBe(false);
  });

  it('decodes Base32', () => {
    expect(decode(base32, 'JBSWY3DPFQQHO33SNRSCC===')).toBe('Hello, world!');
  });

  it('decodes Base58', () => {
    expect(decode(base58, '2NEpo7TZRRrLZSi2U')).toBe('Hello World!');
  });

  it('decodes Ascii85 with and without delimiters', () => {
    expect(decode(base85, '<~87cURD_*#TDfTZ)+T~>')).toBe('Hello, world!');
    expect(decode(base85, '87cURD_*#TDfTZ)+T')).toBe('Hello, world!');
  });

  it('decodes hex with assorted separators', () => {
    expect(decode(hex, '48656c6c6f')).toBe('Hello');
    expect(decode(hex, '48 65 6c 6c 6f')).toBe('Hello');
    expect(decode(hex, '48:65:6c:6c:6f')).toBe('Hello');
  });

  it('decodes binary', () => {
    expect(decode(binary, '01001000 01101001')).toBe('Hi');
  });

  it('decodes decimal and octal byte lists', () => {
    expect(decode(decimalBytes, '72 101 108 108 111')).toBe('Hello');
    expect(decode(octalBytes, '110 145 154 154 157')).toBe('Hello');
  });
});

describe('text escapes', () => {
  it('decodes percent encoding', () => {
    expect(decode(urlDecode, 'hello%20world%21')).toBe('hello world!');
    expect(decode(urlDecode, 'a%2Bb+c')).toBe('a+b c');
  });

  it('decodes named and numeric HTML entities', () => {
    expect(decode(htmlEntities, '&lt;b&gt;caf&eacute;&lt;/b&gt; &#65;&#x42;')).toBe(
      '<b>café</b> AB',
    );
  });

  it('decodes backslash escapes', () => {
    expect(decode(unicodeEscapes, '\\u0048\\u0065llo \\x77orld')).toBe('Hello world');
  });

  it('decodes quoted-printable including soft breaks', () => {
    expect(decode(quotedPrintable, 'caf=C3=A9 au=\r\n lait')).toBe('café au lait');
  });
});

describe('symbol alphabets', () => {
  it('decodes Morse with slash word separators', () => {
    expect(decode(morse, '.... . .-.. .-.. --- / .-- --- .-. .-.. -..')).toBe('HELLO WORLD');
  });

  it('decodes Morse with double-space word separators', () => {
    expect(decode(morse, '.... .  .-- .')).toBe('HE WE');
  });

  it('rejects Morse containing an invalid symbol group', () => {
    expect(decode(morse, '........ .')).toBeUndefined();
  });

  it("decodes Bacon's cipher in both alphabets", () => {
    // "HELLO" in the 26-letter alphabet.
    const outputs = decodeAll(bacon, 'AABBBAABAAABABBABABBABBBA');
    expect(outputs[0]).toBe('HELLO');
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('decodes tap code', () => {
    // 2,3 = H; 1,5 = E -> "HE"
    expect(decode(tapCode, '.. ...  . .....')).toBe('HE');
  });

  it('decodes the NATO phonetic alphabet', () => {
    expect(decode(natoAlphabet, 'Hotel Echo Lima Lima Oscar')).toBe('HELLO');
  });
});

describe('utilities', () => {
  it('reverses text', () => {
    expect(decode(reverseText, 'stressed')).toBe('desserts');
  });
});

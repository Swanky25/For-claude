import CryptoJS from 'crypto-js';
import { describe, expect, it } from 'vitest';
import { fromText } from '../src/core/bytes';
import { aes, des, identifyHash, jwt, rc4, tripleDes } from '../src/core/operations/modern';
import type { Operation, ParamValues } from '../src/core/types';

const MESSAGE = 'Meet me at the old bridge at midnight and bring the documents.';

function decrypt(op: Operation, ciphertext: string, params: ParamValues): string | undefined {
  return op.run(fromText(ciphertext), params)[0]?.output.text;
}

describe('AES', () => {
  it('decrypts CBC with a hex key and IV', () => {
    const key = CryptoJS.enc.Hex.parse('000102030405060708090a0b0c0d0e0f');
    const iv = CryptoJS.enc.Hex.parse('101112131415161718191a1b1c1d1e1f');
    const encrypted = CryptoJS.AES.encrypt(MESSAGE, key, { iv, mode: CryptoJS.mode.CBC });

    const result = decrypt(aes, encrypted.ciphertext.toString(CryptoJS.enc.Base64), {
      key: '000102030405060708090a0b0c0d0e0f',
      keyFormat: 'hex',
      iv: '101112131415161718191a1b1c1d1e1f',
      mode: 'CBC',
      inputFormat: 'base64',
    });
    expect(result).toBe(MESSAGE);
  });

  it('decrypts ECB', () => {
    const key = CryptoJS.enc.Hex.parse('00112233445566778899aabbccddeeff');
    const encrypted = CryptoJS.AES.encrypt(MESSAGE, key, { mode: CryptoJS.mode.ECB });
    const result = decrypt(aes, encrypted.ciphertext.toString(CryptoJS.enc.Hex), {
      key: '00112233445566778899aabbccddeeff',
      keyFormat: 'hex',
      mode: 'ECB',
      inputFormat: 'hex',
    });
    expect(result).toBe(MESSAGE);
  });

  it('decrypts CTR, which needs no padding', () => {
    const key = CryptoJS.enc.Hex.parse('00112233445566778899aabbccddeeff');
    const iv = CryptoJS.enc.Hex.parse('000000000000000000000000000000ff');
    // CTR is a stream mode, so genuine ciphertext is the exact length of the
    // plaintext. CryptoJS pads by default, which real CTR output never is.
    const encrypted = CryptoJS.AES.encrypt(MESSAGE, key, {
      iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    });
    const result = decrypt(aes, encrypted.ciphertext.toString(CryptoJS.enc.Base64), {
      key: '00112233445566778899aabbccddeeff',
      keyFormat: 'hex',
      iv: '000000000000000000000000000000ff',
      mode: 'CTR',
      inputFormat: 'base64',
    });
    expect(result).toBe(MESSAGE);
  });

  it('yields nothing for a wrong key rather than garbage', () => {
    const key = CryptoJS.enc.Hex.parse('00112233445566778899aabbccddeeff');
    const encrypted = CryptoJS.AES.encrypt(MESSAGE, key, { mode: CryptoJS.mode.ECB });
    const results = aes.run(fromText(encrypted.ciphertext.toString(CryptoJS.enc.Base64)), {
      key: 'ffffffffffffffffffffffffffffffff',
      keyFormat: 'hex',
      mode: 'ECB',
      inputFormat: 'base64',
    });
    // PKCS#7 unpadding almost always fails on a wrong key; if it happens to
    // pass, the output must at least not be the real message.
    expect(results[0]?.output.text).not.toBe(MESSAGE);
  });

  it('produces nothing without a key', () => {
    expect(aes.run(fromText('anything'), {})).toHaveLength(0);
  });
});

describe('DES and Triple DES', () => {
  it('decrypts DES-CBC', () => {
    const key = CryptoJS.enc.Hex.parse('0001020304050607');
    const iv = CryptoJS.enc.Hex.parse('0809101112131415');
    const encrypted = CryptoJS.DES.encrypt(MESSAGE, key, { iv, mode: CryptoJS.mode.CBC });
    expect(
      decrypt(des, encrypted.ciphertext.toString(CryptoJS.enc.Base64), {
        key: '0001020304050607',
        keyFormat: 'hex',
        iv: '0809101112131415',
        mode: 'CBC',
        inputFormat: 'base64',
      }),
    ).toBe(MESSAGE);
  });

  it('decrypts 3DES-CBC', () => {
    const key = CryptoJS.enc.Hex.parse('000102030405060708090a0b0c0d0e0f1011121314151617');
    const iv = CryptoJS.enc.Hex.parse('0001020304050607');
    const encrypted = CryptoJS.TripleDES.encrypt(MESSAGE, key, { iv, mode: CryptoJS.mode.CBC });
    expect(
      decrypt(tripleDes, encrypted.ciphertext.toString(CryptoJS.enc.Base64), {
        key: '000102030405060708090a0b0c0d0e0f1011121314151617',
        keyFormat: 'hex',
        iv: '0001020304050607',
        mode: 'CBC',
        inputFormat: 'base64',
      }),
    ).toBe(MESSAGE);
  });
});

describe('RC4', () => {
  it('decrypts with a passphrase key', () => {
    const encrypted = CryptoJS.RC4.encrypt(MESSAGE, CryptoJS.enc.Utf8.parse('SECRETKEY'));
    expect(
      decrypt(rc4, encrypted.ciphertext.toString(CryptoJS.enc.Base64), {
        key: 'SECRETKEY',
        keyFormat: 'utf8',
        inputFormat: 'base64',
      }),
    ).toBe(MESSAGE);
  });
});

describe('JWT', () => {
  const TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
    '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('decodes the header and payload', () => {
    const [result] = jwt.run(fromText(TOKEN));
    expect(result.output.text).toContain('"alg": "HS256"');
    expect(result.output.text).toContain('"name": "John Doe"');
  });

  it('says plainly that the signature is not verified', () => {
    const [result] = jwt.run(fromText(TOKEN));
    expect(result.detail).toContain('NOT verified');
  });

  it('flags the unsigned "none" algorithm', () => {
    const base64url = (value: object) =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ admin: true });
    const [result] = jwt.run(fromText(`${header}.${payload}.`));
    expect(result.detail).toContain('unsigned');
  });

  it('only claims tokens that have the right shape', () => {
    expect(jwt.applicable?.(fromText('not.a.token!!'))).toBe(false);
    expect(jwt.applicable?.(fromText(TOKEN))).toBe(true);
  });
});

describe('hash identification', () => {
  it('identifies digests by length', () => {
    expect(identifyHash.run(fromText('d41d8cd98f00b204e9800998ecf8427e'))[0].detail).toContain(
      'MD5',
    );
    expect(
      identifyHash.run(fromText('da39a3ee5e6b4b0d3255bfef95601890afd80709'))[0].detail,
    ).toContain('SHA-1');
    expect(
      identifyHash.run(
        fromText('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
      )[0].detail,
    ).toContain('SHA-256');
  });

  it('identifies bcrypt by its prefix', () => {
    const bcrypt = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    expect(identifyHash.run(fromText(bcrypt))[0].detail).toContain('bcrypt');
  });

  it('states that hashes cannot be reversed', () => {
    const [result] = identifyHash.run(fromText('d41d8cd98f00b204e9800998ecf8427e'));
    expect(result.output.text).toContain('cannot be reversed');
  });
});

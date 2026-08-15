# Universal Decipher

Paste an encoded blob or a piece of ciphertext and it works out what was done to
it — peeling away nested layers of encoding and classical ciphers until
something reads like English, then showing you the chain it followed.

Everything runs client-side. No input leaves the browser.

```bash
npm install
npm run dev       # development server
npm test          # 75 unit tests
npm run build     # typecheck + production bundle
```

## What "universal" honestly means

The name is aspirational in one direction and precise in the other, and the
distinction matters more than anything else in this README:

- **Encodings and pre-modern ciphers can always be undone.** There is no secret
  involved — only a format or a small keyspace — so a program can detect and
  reverse them. That is what this tool does, and it does it without being told
  which scheme was used.
- **Correctly used modern encryption cannot be broken here, or anywhere.**
  AES-256 with a real key is not "slow to crack", it is out of reach of any
  amount of hardware. The modern ciphers below decrypt only when *you* supply
  the key. Nothing in this repository attacks them, because nothing can.
- **Hashes are one-way.** `Identify hash` tells you what a digest probably is.
  It cannot tell you what was hashed, and it does not try to guess.

So: a universal *decoder*, yes. A universal *decryptor*, no — and any tool
claiming otherwise is either doing key recovery by other means (weak passwords,
keys left in memory, implementation bugs) or misrepresenting itself.

## What it handles

**Encodings** — Base64 (standard, URL-safe, unpadded), Base32 (standard and
extended-hex), Base58 (Bitcoin and Ripple alphabets), Ascii85/Base85, hex,
binary, decimal and octal byte lists, percent-encoding, HTML entities,
backslash escapes, quoted-printable, Morse, Baconian (24- and 26-letter), tap
code, the NATO phonetic alphabet, and reversal.

**Classical ciphers, solved without a key** — Caesar/ROT-N, Atbash, ROT47,
affine, Vigenère, arbitrary monoalphabetic substitution, rail fence, columnar
transposition, single-byte XOR and repeating-key XOR.

**Modern crypto, with a key you provide** — AES (CBC/ECB/CTR/CFB/OFB), DES,
Triple DES, RC4. Plus JWT decoding and hash identification as inspection
helpers.

Not supported: AES-GCM (the engine is synchronous and Web Crypto is not), and
compressed streams such as gzip/deflate, for the same reason.

## How it decides what is right

Every candidate decoding is scored on how much it looks like English, and the
quality of that judgement is what makes the whole thing work.

The scorer is built from an 8.9-million-letter corpus of English literature,
compiled into quantised n-gram log-probability tables by
`scripts/build-model.mjs`. Scoring blends three signals:

1. **Quadgram probability**, with trigram backoff for the 82% of quadgram slots
   the corpus never fills. Held-out English measures about −4.2 per position
   against random letters at −7.8, which is the spread the 0..1 normalisation is
   calibrated against.
2. **Dictionary coverage** over a 22,800-word vocabulary. A literary corpus has
   excellent letter statistics but dated vocabulary, so the word list merges a
   modern frequency list with generated regular inflections, each validated
   against a full dictionary.
3. **Word segmentation probability.** Classical ciphertext is traditionally sent
   without spaces, so plaintext is recovered unspaced. Dynamic programming over
   Zipf-estimated word probabilities restores the spacing — and the probability
   of the best split is itself a scoring signal. It has to be: two transposition
   candidates routinely tie on coverage (`it was` and `si twas` both spell out
   completely) and separate only on which words are *likely*.

## How the search works

`solve()` is a beam search over the operation registry. Three details do most of
the work:

- **Intermediate layers are not supposed to look like English.** The Base64
  inside another Base64 scores terribly, so ranking the frontier purely on
  englishness discards the real chain. A structural decode that yields clean
  printable output earns a bonus that keeps it in the beam on its own merits.
- **Letter ciphers are gated on the shape of their input.** A substitution
  solver has 26! degrees of freedom, so given *any* letter sequence it will find
  a mapping that scores as convincing English — including on Base64. The letter
  ciphers therefore require input that is overwhelmingly alphabetic, and
  substitution additionally requires an index of coincidence near English's
  0.066, which is the statistical signature of a monoalphabetic cipher.
- **The search stops when it has won.** Once a result reads as English it is not
  transformed again; otherwise the winner gets buried under slightly-corrupted
  twins of itself produced by applying more ciphers to the answer.

## Layout

```
src/core/            engine, independent of any UI
  scoring/           language model and fitness scoring
  operations/        codecs, encodings, classical ciphers, modern crypto
  magic.ts           beam search over decode chains
  registry.ts        the operation catalogue
src/ui/              React app; holds no engine code
  solver.worker.ts   the engine runs here, off the main thread
scripts/
  build-model.mjs    regenerates the language model from a corpus
  smoke.mjs          browser end-to-end check
tests/               75 unit tests
```

The UI thread deliberately imports only *types* from `src/core`. The engine and
its ~200 KB language model live entirely in the worker, which keeps the initial
bundle at about 50 KB gzipped and stops a long substitution solve from freezing
the page.

## Regenerating the language model

`src/core/scoring/model.generated.ts` is committed, so the corpus is not needed
to build or run the app. To rebuild it:

```bash
npm run build:model -- <corpusDir> --freq <ranked.txt> --dict <words.txt>
```

The committed model was built from the NLTK Gutenberg corpus, the
`google-10000-english` frequency list, and the `dwyl/english-words` dictionary;
exact URLs are in the header of `scripts/build-model.mjs`.

## Browser check

`npm test` covers the engine. The worker, the catalogue and the UI wiring are
exercised against a real browser:

```bash
npm run build && npx vite preview --port 4173 &
node scripts/smoke.mjs http://localhost:4173
```

Set `CHROMIUM_PATH` if your Playwright build does not match the installed
browsers.

## Intended use

Puzzles, CTFs, forensics, and the everyday job of working out what format a
piece of data is in. Use it on material you own or are authorised to examine.

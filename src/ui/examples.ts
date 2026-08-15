/**
 * Sample inputs, precomputed as literals.
 *
 * Deliberately no imports: the UI thread must not pull the engine (and its
 * language model) into its bundle just to render a row of demo buttons.
 * Regenerate these by encoding the plaintexts below if they ever change.
 *
 *   short: "Meet me at the old bridge at midnight and bring the documents."
 *   long:  "The quick brown fox jumps over the lazy dog while the committee
 *           reviews the quarterly figures and agrees that the new distribution
 *           centre has improved delivery times across the whole region."
 */

export interface Example {
  label: string;
  text: string;
}

export const examples: Example[] = [
  {
    label: 'Base64',
    text: 'TWVldCBtZSBhdCB0aGUgb2xkIGJyaWRnZSBhdCBtaWRuaWdodCBhbmQgYnJpbmcgdGhlIGRvY3VtZW50cy4=',
  },
  {
    label: 'ROT13',
    text: 'Zrrg zr ng gur byq oevqtr ng zvqavtug naq oevat gur qbphzragf.',
  },
  {
    label: 'Base64 + ROT13',
    text: 'WnJyZyB6ciBuZyBndXIgYnlxIG9ldnF0ciBuZyB6dnFhdnR1ZyBuYXEgb2V2YXQgZ3VyIHFicGh6cmFnZi4=',
  },
  {
    label: 'Vigenère',
    text:
      'Elq ehtgw pezaz tbi ngacd shse elq znkc pct hluzr elq qbxquhgpi dsitiig gsi ' +
      'cincxqfyj juuhcie oao esfrpw fvne xts apa pwfevuphemab pprffr see wzavajro ' +
      'hqzvgidm gtqqg nnvagf elq kuzpq frrmab.',
  },
  {
    label: 'Substitution',
    text:
      'Qda ntfbh eolvk slw gtjmp luao qda izyx rlc vdfia qda bljjfqqaa oaufavp qda ' +
      'ntzoqaoix sfctoap zkr zcoaap qdzq qda kav rfpqofetqflk bakqoa dzp fjmoluar ' +
      'raifuaox qfjap zbolpp qda vdlia oacflk.',
  },
  {
    label: 'Morse',
    text: '.... . .-.. .-.. --- / - .... . .-. . / -- -.-- / ..-. .-. .. . -. -..',
  },
  {
    label: 'Hex',
    text:
      '4d 65 65 74 20 6d 65 20 61 74 20 74 68 65 20 6f 6c 64 20 62 72 69 64 67 65 20 ' +
      '61 74 20 6d 69 64 6e 69 67 68 74 20 61 6e 64 20 62 72 69 6e 67 20 74 68 65 20 ' +
      '64 6f 63 75 6d 65 6e 74 73 2e',
  },
  {
    label: 'Nested (Base64 ×2 + ROT13)',
    text:
      'V25KeVp5QjZjaUJ1WnlCbmRYSWdZbmx4SUc5bGRuRjBjaUJ1WnlCNmRuRmhkblIxWnlCdVlYRWdiMlYy' +
      'WVhRZ1ozVnlJSEZpY0doNmNtRm5aaTQ9',
  },
];

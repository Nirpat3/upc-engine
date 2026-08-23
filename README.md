# UPC Engine

Identify, normalize, and reformat UPC-A / UPC-E barcodes to match whatever
shape a specific POS/scanner is configured to expect — and reverse that
transform going the other direction. Built for the US retail reality where
the *same* barcode has to be re-shaped per scanner/POS profile because each
one is independently configured (leading digit stripped or not, check digit
stripped or not, UPC-E expanded to UPC-A or not, zero-padded to a fixed
width, etc.).

See `DEFINE.md` for the problem statement and acceptance criteria, and
`RESEARCH.md` for the researched catalog of scanner-configurable variables
this engine models.

## Install / run

```
npm install     # no runtime deps; installs nothing but locks node_modules
npm test        # node --test — the actual gate, not a self-attestation
```

## Library

```js
import { identify, toCanonical, applyProfile, reverseProfile, convertBatch } from './src/index.mjs';
import { getProfile, listProfiles } from './src/profiles.mjs';

identify('123456');                 // { format: 'UPC_E_6', digits: '123456' }
toCanonical('36000291452');         // { format: 'UPC_A_12', canonical: '036000291452', ... }

const profile = getProfile('upc_a_no_check_digit');
applyProfile('036000291452', profile);   // '03600029145'
reverseProfile('03600029145', profile);  // '036000291452'

convertBatch(['036000291452', 'garbage'], { toProfile: 'upc_e_full' });
// [{ ok: true, ... }, { ok: false, error: '...', code: 'NOT_NUMERIC' }]
```

## CLI

```
upc-engine identify <code>
upc-engine to-canonical <code>
upc-engine convert <code> <profile>
upc-engine reverse <code> <profile>
upc-engine translate <code> <fromProfile> <toProfile>
upc-engine batch-convert --to <profile> [--from <profile>]   # codes as JSON array on stdin
upc-engine batch-identify                                     # codes as JSON array on stdin
upc-engine list-profiles
```

All output is JSON so it's scriptable. `batch-convert`/`batch-identify` exit
1 if any item in the batch failed, so callers can detect partial failure
without parsing every result.

## Profiles

`profiles/catalog.json` is the declarative source of scanner-config
combinations (built-ins: raw UPC-A, strip leading/check digit, EAN-13
wrap, zero-padded width, full/partial UPC-E, symbology-prefixed EAN-13).
Add a new POS/scanner by adding a JSON entry — no code change needed —
using the primitives in `src/pipeline.mjs`'s `Profile` typedef:
`expandToUpcA`, `compressToUpcE`, `stripLeadingDigit`, `stripCheckDigit`,
`prependZeroForEan13`, `padWidth`, `truncateToWidth`, `symbologyPrefix`,
`onNotCompressible`.

## Known v1 limitations

- `stripLeadingDigit` reversal assumes number system `0` when reconstructing
  (documented in `RESEARCH.md`); this is correct for the vast majority of US
  UPC-A retail codes but is a stated assumption, not a guarantee.
- Reverse-translating a *lenient-fallback* UPC-E-profile output (i.e. a code
  that wasn't actually compressible, so the profile emitted full UPC-A
  instead) is not attempted automatically — see the round-trip test in
  `test/pipeline.test.mjs` for the exact boundary.
- Bookland/ISBN and EAN-2/EAN-5 supplement handling are represented in the
  research/design but not yet implemented as pipeline primitives (out of
  scope for v1 per `DEFINE.md`).

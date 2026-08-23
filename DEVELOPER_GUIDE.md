# Developer Guide - UPC Engine

Practical "how do I actually use this" doc. See DEFINE.md for problem
statement/acceptance criteria and RESEARCH.md for the researched scanner
variable catalog.

## Install

```
git clone <this repo>
cd upc-engine
npm install     # zero runtime dependencies -- this locks node_modules, installs nothing external
npm test        # node --test, the real gate (67 tests as of this writing)
```

Requires Node >= 18 (uses native `node --test`, ESM). No build step.

Optional: if you want the Supabase-backed database (see "Database" below),
copy `.env.example` to `.env` and fill in your project's URL + service-role
key. Skip this entirely and every non-`db-*` command works with zero setup.

## Architecture (verified call graph)

```
raw input string
      |
      v
  identify()          <- src/core.mjs: classifies by digit length/shape
      |                  (UPC_A_12/11, UPC_E_6/7/8, EAN_13, GTIN_14)
      v
  toCanonical()        <- src/core.mjs: single source of truth.
      |                  US/Canada shapes -> UPC-A-12 (check digit recomputed,
      |                  NEVER trusted from input). Everything else with a
      |                  non-zero leading digit -> EAN-13 (also recomputed).
      v
   +--+-----------------+------------------+
   |                    |                  |
   v                    v                  v
applyProfile()    decomposeAny()      recordUpc()
(src/pipeline.mjs) (src/decompose.mjs) (src/db.mjs, optional)
   |                    |                  |
   v                    v                  v
device-specific    structural fields   Supabase row
output (11/12/13/  (number system /    (canonical, brand,
14 digit shape,    GS1 country prefix, decomposition,
UPC-E, EAN-13      company prefix,     source profile)
w/ symbology       item reference,
prefix, etc.)      check-digit validity)
```

`reverseProfile()` and `convertToProfile()` run the pipeline stage in
reverse: device-shaped code -> canonical UPC-A. `detectProfileFromPairs`/
`detectProfileFromDatabase` (src/detect.mjs) answer "which profile is this
scanner actually using" empirically instead of you having to know its
config menu. `setActiveProfile`/`getActiveProfile` (src/session.mjs)
persist that answer per system/lane so you don't re-detect every call.

## Running batch UPC mapping

The batch commands take a JSON array on stdin and return a JSON array on
stdout, order-preserving and index-tagged, with per-item error isolation:
one bad code does NOT abort the batch.

### 1. Mixed-format mapping (most common case: dedupe/normalize a product list)

Omit `--from` and the engine auto-detects each input's format via
`toCanonical()` before applying the target profile. Real verified output:

```
$ cat products.json
["036000291452","07310001","688267528606","garbage","073100003271"]

$ node bin/upc-engine.mjs batch-convert --to upc_a_as_ean13 < products.json
[
  {"ok": true,  "index": 0, "input": "036000291452", "canonical": "036000291452", "output": "0036000291452"},
  {"ok": true,  "index": 1, "input": "07310001",     "canonical": "073000001001", "output": "0073000001001"},
  {"ok": true,  "index": 2, "input": "688267528606", "canonical": "688267528606", "output": "0688267528606"},
  {"ok": false, "index": 3, "input": "garbage",       "error": "\"garbage\" is not numeric-only", "code": "NOT_NUMERIC"},
  {"ok": true,  "index": 4, "input": "073100003271", "canonical": "073100003271", "output": "0073100003271"}
]
```
(exit code 1 signals "at least one item failed" -- check `ok` per item, don't
treat exit 1 as "the whole batch failed".)

### 2. Device A -> Device B translation (both `--from` AND `--to` given)

`--from <profile>` means "every input in this batch is ALREADY in that
device's specific shape" -- it is NOT auto-detect. Feeding a UPC-E code to
`--from raw_upc_a_full` (which expects exactly 12 digits already) correctly
fails with `BAD_LENGTH`, verified live:

```
$ echo '["036000291452","07310001"]' | \
    node bin/upc-engine.mjs batch-convert --from raw_upc_a_full --to upc_a_no_leading_no_check
[
  {"ok": true,  "index": 0, "output": "3600029145"},
  {"ok": false, "index": 1, "error": "Could not reconstruct 12-digit UPC-A from \"07310001\"", "code": "BAD_LENGTH"}
]
```

Use `--from` only when you KNOW every item in the batch came from the same
device/profile (e.g. an export from one specific POS lane). For a mixed
bag of formats, omit `--from` (case 1 above).

### 3. Batch identify (classify without converting)

```
$ node bin/upc-engine.mjs batch-identify < products.json
```
Returns `{ok, index, input, format, digits}` per item -- useful for a first
pass over an unfamiliar data export to see what formats are actually present
before deciding which profile(s) to apply.

### Common real-world gotcha: leading zeros dropped by spreadsheets/exports

If a UPC-E code that should be 8 digits shows up as 7 (or a UPC-A that
should be 12 shows up as 11), the #1 real-world cause is NOT a different
scanner profile -- it's a spreadsheet, CSV export, or database column that
stored the code as a NUMBER instead of TEXT, silently dropping the leading
`0` (which has no numeric value). `identify()` will tell you the shape it
actually received (`UPC_E_7` instead of `UPC_E_8`, `UPC_A_11` instead of
`UPC_A_12`) -- if you see that pattern across an entire export column, check
the source's column type before assuming a scanner-config difference.

## Mapping a whole product catalog to a specific POS's format

```
node bin/upc-engine.mjs batch-convert --to <target-profile> < your-catalog.json > mapped.json
```
Pick `<target-profile>` from `upc-engine list-profiles`, or run
`detect-from-pairs`/`detect-from-database` first if you don't know which
profile a given POS actually uses (see README.md "Auto-detection").

## CLI command reference

Run `upc-engine` with no arguments for the full, current usage list (kept
in sync in `bin/upc-engine.mjs`'s `default` case -- that's the source of
truth, this doc summarizes it):

- `identify <code>` / `to-canonical <code>` -- single-item inspection
- `convert <code> <profile>` / `reverse <code> <profile>` -- single-item transform
- `translate <code> <fromProfile> <toProfile>` -- device A -> device B, one item
- `batch-convert [--from P] --to P` / `batch-identify` -- array in, array out (stdin/stdout)
- `list-profiles` -- enumerate the built-in scanner-profile catalog
- `detect-from-pairs` / `detect-from-database --known <file>` -- figure out which profile a scanner uses
- `set-active-profile` / `get-active-profile` / `list-active-profiles` / `clear-active-profile` -- persist a resolved profile per system/lane
- `decompose <code> [prefixLen]` -- structural breakdown (routes UPC-A vs EAN-13 automatically)
- `number-systems` -- print the US/Canada number-system-digit meaning table
- `gs1-country <code>` -- which GS1 Member Organization/country issued this code
- `db-status` / `db-record` / `db-get` / `db-list` -- optional Supabase persistence (see README.md)

## Library usage (no CLI)

```js
import { identify, toCanonical, applyProfile, decomposeAny, lookupGs1Country } from './src/index.mjs';

const canonical = toCanonical('07310001');       // { format: 'UPC_A_12', canonical: '073000001001', ... }
const forScanner = applyProfile(canonical.canonical, getProfile('upc_a_as_ean13'));
const structure = decomposeAny(canonical, { companyPrefixLength: 6 });
```

## Testing

```
npm test              # full suite, node --test (67 tests as of this writing)
node --check <file>   # syntax check a single file before committing
```

Every behavior claimed in this doc was verified by actually running the
CLI and capturing its real output -- not written from memory of the code.
If you find a mismatch between this doc and actual behavior, that is a bug
in one of the two; file it as such.

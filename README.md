# UPC Engine

Identify, normalize, and reformat UPC-A / UPC-E barcodes to match whatever
shape a specific POS/scanner is configured to expect — and reverse that
transform going the other direction. Built for the US and Canada retail
reality where the *same* barcode has to be re-shaped per scanner/POS
profile because each one is independently configured (leading digit
stripped or not, check digit stripped or not, UPC-E expanded to UPC-A or
not, zero-padded to a fixed width, etc.).

**Regional scope:** UPC-A/UPC-E (the 12-digit / compressed-6-digit format
this engine specializes in) is a US and Canada convention, verified
against GS1's own country-prefix table (GS1 US: 000-139, GS1 Canada:
754-755, both UPC-A compatible). Mexico, Central America, and South
America use standard EAN-13 with their own GS1 country prefixes -- the
check-digit math is the same GS1 algorithm and canonicalizes/validates
correctly here, but UPC-E compression and the UPC number-system-digit
semantics table are North-American-specific and don't apply to those
codes. See DEFINE.md "Regional scope" for the full prefix breakdown.

See `DEFINE.md` for the problem statement and acceptance criteria, and
`RESEARCH.md` for the researched catalog of scanner-configurable variables
this engine models.

**Persistence is opt-in.** Identify, convert, decompose, detect, and
profile management all work standalone with zero setup and zero external
dependency. If you also want a durable record of every UPC that runs
through the engine (structured by brand, prefix, decomposition — see "UPC
database" below), copy `.env.example` to `.env` and configure a Supabase
project. Skip that step entirely and the engine still works fully; only
the `db-*` commands need it, and they fail with a clear message (not
silently) if it's missing.

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

## Auto-detection & "lock it in" (`src/detect.mjs`, `src/session.mjs`)

Two complementary ways to figure out which built-in profile a given
POS/scanner is actually configured with, without you having to know its
vendor menu settings up front:

- **Pair-based** (`detectProfileFromPairs`) — you know the canonical UPC for
  an item AND the raw code the scanner emitted for it (e.g. from a manual
  test scan against a known SKU). Give it 2+ `{canonical, scanned}` pairs
  across different UPC shapes (one UPC-E-compressible, one not) and it tests
  every profile in the catalog, returning the single profile that produces
  every observed output — or, if genuinely ambiguous (some profiles are
  identical by definition, e.g. `raw_upc_a_full` / `upc_e_expand_to_upc_a`),
  the full candidate set instead of a silent guess.
- **Database-lookup** (`detectProfileFromDatabase`) — you only have raw
  scanned codes and the set of canonical UPCs already known to exist in the
  system (no direct pairing). It reverses each scanned code under every
  profile and scores which profile's reversed result actually exists in the
  known set; more sample codes narrow the candidate set the same way.

Once resolved, `setActiveProfile(systemId, profileName)` persists the
binding (JSON file store by default, swappable via `storePath`) so later
`convert`/`convertBatch` calls for that system/lane/store don't need to
re-detect — `getActiveProfile(systemId)` reads it back, `listActiveProfiles`
enumerates all bound systems, `clearActiveProfile` un-binds one.

CLI:

```
upc-engine detect-from-pairs                       # [{canonical,scanned}] as JSON on stdin
upc-engine detect-from-database --known upcs.json  # scanned codes as JSON on stdin
upc-engine set-active-profile <systemId> <profile>
upc-engine get-active-profile <systemId>
upc-engine list-active-profiles
upc-engine clear-active-profile <systemId>
```

## Structural decomposition (`src/decompose.mjs`)

Breaks a canonical UPC-A into its actual GS1 parts: number system digit
(with its real-world meaning — e.g. `2` = variable-weight/store-scale item,
`4` = store-internal use, both explicitly flagged as NOT globally unique),
the 10-digit body, and the check digit (revalidated, never trusted from
input). If you supply a `companyPrefixLength` (6-10, matching how GS1
actually issues prefixes per-company), it further splits the body into
`companyPrefix` and `itemReference`.

**Important honesty note** (see `RESEARCH.md`): GS1 does not publish a
fixed universal prefix-length table — a company's prefix length depends on
how many items GS1 assigned them room for, and is only truly knowable by
looking up that specific prefix. This module never guesses a length
silently; without one, you get the guaranteed-correct fields only.

`createBrandProfile({ companyPrefix, brandName, companyPrefixLength })`
builds a durable record so a resolved prefix length doesn't need
rediscovering — meant to be persisted via the DB layer below.

```
upc-engine decompose <code> [companyPrefixLength]
upc-engine number-systems
```

## UPC database (`src/db.mjs`, Supabase)

Every UPC that runs through the engine can be recorded — canonical form,
decomposition, brand/product metadata, which scanner profile it was
decoded from — building a real data structure over time instead of
one-shot conversions. Talks directly to Supabase's PostgREST REST API via
`fetch` (no SDK dependency added to the project). Configure via env vars:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # or SUPABASE_KEY
```

Run `db/schema.sql` in the Supabase SQL editor once to create the
`upc_records` and `brand_profiles` tables (with an atomic seen-count
trigger, indexes on brand/prefix, and a check-digit format constraint).

Without those env vars every DB function throws a clear
`DB_NOT_CONFIGURED` error at call time — the rest of the engine (identify,
convert, detect, decompose) has zero dependency on Supabase and keeps
working standalone.

```
upc-engine db-status
upc-engine db-record <code> [--brand X] [--product Y] [--profile Z] [--prefix-len N]
upc-engine db-get <canonicalUpcA12>
upc-engine db-list [--brand X] [--prefix Y]
```

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

<!-- mirror-automation-test 2026-08-23T17:22:08Z -->

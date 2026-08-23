# UPC Engine — Define (problem statement + acceptance criteria)

## Problem

US and Canadian retail POS scanners are configured (by the scanner vendor's
programming barcode/menu) to expect UPC-A / UPC-E in specific transmitted
shapes. The same physical barcode can be scanned correctly by one POS and
rejected/misread by another, because each scanner's config independently
controls:

- whether the leading "number system" digit is transmitted
- whether the trailing check digit is transmitted
- whether UPC-E is expanded to UPC-A (or vice versa, compressed)
- whether the code is zero-padded to a wider width (e.g. UPC-A -> EAN-13)
- (see RESEARCH.md for the full researched variable catalog)

### Regional scope (verified against GS1's own country-prefix table)

"UPC-A"/"UPC-E" as a distinct 12-digit / compressed-6-digit symbology is a
**US and Canada** convention — GS1 US administers prefixes `000–139`, and
GS1 Canada is assigned prefixes `754–755`. Both are UPC-A compatible: a
Canadian GS1 prefix decodes with the exact same number-system-digit +
company-prefix + item-reference + check-digit structure this engine
implements, so `core.mjs`/`pipeline.mjs`/`decompose.mjs` apply unchanged.

Everywhere else in the Americas — Mexico (750), Central America/Caribbean
(740–746), and South America (Colombia 770-771, Venezuela 759, Ecuador 786,
Peru 775, Brazil 789-790, Argentina 778-779, Chile 780, Bolivia 777,
Uruguay 773, Paraguay 784) — uses standard **EAN-13** with a GS1
country-member 3-digit prefix, not the UPC-A/UPC-E 12/6-digit shorthand.
The check-digit algorithm is the same GS1 algorithm (this engine's
`computeCheckDigit` already handles 13-digit EAN via `toCanonical`'s
EAN-13-with-leading-zero unwrap for the US/Canada 0-prefix case), but the
UPC-E *compression* feature and the "number system digit" semantics table
in `decompose.mjs` are specific to the North American UPC-A numbering
convention and do not apply to a Latin American EAN-13 code with a
non-zero 3-digit GS1 prefix.

**Practical implication:** this engine's scanner-profile catalog (leading
digit strip, UPC-E compress/expand, etc.) targets US/Canada POS hardware
behavior. A Latin American retailer's EAN-13 codes will canonicalize and
check-digit-validate correctly, but will never be "UPC-E compressible"
(compression simply doesn't apply outside the North American numbering
space) and `decompose.mjs`'s `NUMBER_SYSTEM_MEANINGS` table does not
describe their leading digits.

We need an engine that:
1. Identifies the format of any input barcode string (UPC-A/UPC-E/EAN-13,
   with or without check digit, with or without leading zeros/padding).
2. Normalizes it to a canonical form (full 12-digit UPC-A with valid check
   digit) — this is the source of truth stored in the system.
3. Given a named "scanner profile" (the receiving POS/scanner's configured
   rules), formats the canonical UPC into exactly what that scanner expects
   ("outbound": canonical -> device format), for insertion into that system.
4. Given a code coming *from* a system/scanner in some profile-specific
   shape, reverses the transform back to canonical / or to another target
   profile ("inbound": device format -> canonical, or device A -> device B).
5. Supports multiple UPCs in one call when "multiple selection" is enabled
   (batch array in, batch array out, order-preserving, per-item error
   isolation — one bad UPC does not fail the whole batch).

## Acceptance criteria (must be executable as tests)

- [ ] `identify(code)` correctly classifies: UPC-A-12 (w/ check digit),
      UPC-A-11 (no check digit), UPC-E-6, UPC-E-7 (with number system),
      UPC-E-8 (number system + check digit), EAN-13, GTIN-14, and rejects
      invalid digit counts / non-digit input with a typed error, not a throw
      that crashes a batch.
- [ ] `toCanonical(code)` returns a valid 12-digit UPC-A with a *recomputed*
      correct check digit (never trusts a caller-supplied check digit).
- [ ] `expandUpcE(upcE6)` and `compressUpcA(upcA12)` are exact inverses for
      every compressible UPC-A in the standard's 4 case patterns (0-2, 3, 4,
      5-9 terminal digit rules), verified by round-trip property tests.
- [ ] `applyProfile(canonicalUpc12, profileName)` produces the documented
      output for every built-in profile in `profiles/catalog.json`.
- [ ] `reverseProfile(deviceCode, profileName)` recovers the canonical UPC-A
      for every built-in profile (round trip: canonical -> profile -> back
      == canonical).
- [ ] Batch mode: `convertBatch([codes], {from, to})` returns one result per
      input, preserving order and index, with `{ok:false, error}` entries for
      bad inputs instead of aborting the batch.
- [ ] CLI exposes identify / to-canonical / convert / batch-convert / list
      profiles, all runnable from the terminal and scriptable (JSON out).
- [ ] `npm test` is green and is the actual gate (not agent self-attestation).

## Out of scope (v1)

- GUI. CLI + library only in v1; a thin web/API wrapper can follow once the
  core engine is proven.
- UPC-E compression/expansion and the scanner-profile catalog
  (`profiles/catalog.json`) remain US/Canada-specific: they model UPC-A/
  UPC-E POS hardware behavior that does not exist for EAN-13-format codes.
  Latin American EAN-13 identification, canonicalization, check-digit
  validation, and structural decomposition (country/region, company
  prefix/item reference) ARE implemented (`src/gs1-country.mjs`,
  `decomposeEan13`) as of the "Add Latin American EAN-13 support" change.
- Non-GS1 symbologies beyond EAN-13/GTIN-14 passthrough (Code128, QR, etc.)
- Live integration into any specific POS (RapidRMS etc.) — that is a follow-on
  once this engine has a stable contract.

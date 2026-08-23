# UPC Engine — Define (problem statement + acceptance criteria)

## Problem

US retail POS scanners are configured (by the scanner vendor's programming
barcode/menu) to expect UPC-A / UPC-E in specific transmitted shapes. The same
physical barcode can be scanned correctly by one POS and rejected/misread by
another, because each scanner's config independently controls:

- whether the leading "number system" digit is transmitted
- whether the trailing check digit is transmitted
- whether UPC-E is expanded to UPC-A (or vice versa, compressed)
- whether the code is zero-padded to a wider width (e.g. UPC-A -> EAN-13)
- (see RESEARCH.md for the full researched variable catalog)

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
- Non-US symbologies beyond EAN-13/GTIN-14 passthrough (Code128, QR, etc.)
- Live integration into any specific POS (RapidRMS etc.) — that is a follow-on
  once this engine has a stable contract.

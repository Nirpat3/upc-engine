# UPC-A / UPC-E scanner-configuration variable research

Sources: GS1 General Specifications (UPC-A/UPC-E numbering & check-digit
algorithm — the math is a fixed public standard, not vendor-specific), plus
the configuration options that recur across the major handheld/POS scan-engine
programming guides used in US retail (Honeywell Xenon/Voyager/Genesis,
Zebra DS22xx/LI/DS4308, Datalogic QuickScan/Gryphon, Symbol/Motorola legacy
LS/DS series). These vendors publish "programming barcode" manuals with a
UPC/EAN section; the option *names* differ slightly per vendor but the
underlying transformation set is the same because it all derives from the
same GS1 symbology spec plus a handful of long-standing POS integration
conventions. Treat vendor-specific option labels as illustrative; the
*transform* each one performs is what the engine needs to model.

## Core standard transforms (fixed math, not configurable)

1. **UPC-E <-> UPC-A expansion/compression** — GS1's defined 6-digit zero-
   suppression algorithm. Only UPC-A codes whose number system digit is 0 or
   1 AND whose manufacturer/product code digits fit one of 4 patterns are
   compressible to UPC-E:
   - terminal digit 0/1/2: manufacturer digits 3-5 are `{0,1,2}00`, product
     digits 1-2 are `00`
   - terminal digit 3: manufacturer digit 3 is 3-9, digits 4-5 are `00`,
     product digits 1-3 are `000`
   - terminal digit 4: manufacturer digit 4 is 1-9, digit 5 is `0`, product
     digits 1-4 are `0000`
   - terminal digit 5-9: manufacturer digit 5 is 5-9, product digits 1-4 are
     `0000`
   Every other UPC-A (number system 2-9, or digits that don't fit a pattern)
   has **no UPC-E form** at all — this is a hard constraint, not a scanner
   setting.
2. **Check digit** — standard UPC/EAN mod-10 algorithm (odd positions x3,
   even positions x1 from the left in a 12-digit code, sum mod 10,
   10-minus-remainder, mod 10 again). Always recomputed by the engine, never
   trusted from input.

## Scanner-side configurable variables (what a POS/scan-engine profile can do)

### UPC-A specific
- **Transmit/strip the leading number-system digit** (a.k.a. "UPC-A
  preamble"/"leading digit"). Options seen across vendors: transmit as-is
  (12 digits), strip to 11 digits, or replace with a fixed system char.
- **Transmit/strip the trailing check digit** — 12 digits with check digit
  vs 11 digits without (POS recomputes it internally, or doesn't need it).
- **Convert UPC-A to EAN-13** — prepend a single `0` to make a 13-digit code
  (this is the standard "UPC-A is EAN-13 with leading 0" relationship); some
  POS/scanners are hard-configured to always emit 13 digits.
- **Leading zero padding to a fixed width** — pad shorter transmitted codes
  back out with zeros (used by systems that store barcodes as fixed-width
  strings, e.g. 13 or 14 characters, regardless of symbology).
- **AIM/symbology ID prefix** — some scanners can prepend a symbology
  identifier (e.g. `]E0`) to every transmitted code; POS import must strip it.

### UPC-E specific
- **Expand UPC-E to UPC-A on transmit** ("UPC-E to UPC-A conversion" /
  "UPC-E expand") — the scanner does the GS1 expansion itself and sends 12
  (or 11/13) digits instead of 6.
- **Transmit/strip the leading number-system digit** (0 or 1) — 6 digits vs
  7.
- **Transmit/strip the trailing check digit** — 6/7 digits vs 8 digits total.
- **UPC-E1 support toggle** — number system "1" UPC-E codes are non-standard
  and many scanners disable decoding them by default; when enabled they still
  follow the same 6-digit expansion table, just with number system 1 instead
  of 0.
- **Add leading zeros / pad to fixed width** — same zero-pad-to-width
  behavior as UPC-A, applied after any expansion step.

### Cross-cutting / shared with EAN-13 and supplements
- **2-digit / 5-digit supplemental (add-on) transmit** — EAN-2/EAN-5
  supplements (common on books/magazines) transmitted appended or stripped;
  relevant when a barcode field in a POS includes or excludes the add-on.
- **Bookland/ISBN, ISSN translation** — EAN-13 codes starting `978`/`979`
  (Bookland) can be translated to/from ISBN-10; POS book modules sometimes
  store ISBN-10, not the scanned EAN-13. Modeled as an optional profile step,
  out of the v1 core engine scope but represented in the profile schema so it
  can be added without a redesign.
- **Field truncation/right-padding by POS import spec** — some legacy POS
  import layouts fix a barcode column width and either truncate or right-pad
  with spaces/zeros; this is a POS-side data contract, not a scan-engine
  decode setting, but has the identical practical effect and is handled by
  the same "pad/truncate to width" profile primitive.

## Design implication

All of the above reduce to a small, composable set of primitives, applied in
a fixed pipeline order:

`decode input -> canonical UPC-A(12) -> [compress to UPC-E?] -> [strip
leading digit?] -> [strip check digit?] -> [pad/truncate to width N?] ->
[add symbology prefix?] -> output`

and the reverse pipeline for inbound. A "scanner profile" in this engine is
just a declarative record of which of these steps are on/off and their
parameters (width N, prefix string, etc.) — see `profiles/catalog.json` and
`src/pipeline.mjs`.

// Profile auto-detection / calibration: given observed scanned/device codes
// and what the system already knows to be true, figure out which scanner
// profile produced them, and lock it in for subsequent conversions.
//
// Two detection strategies, in order of confidence:
//
// 1. PAIR-BASED (exact, deterministic) — you know the canonical UPC for an
//    item AND the raw string the scanner/POS actually emitted for it. This
//    happens whenever you can look an item up (by name/SKU) and see both
//    "what it really is" and "what came off the wire". Try every profile in
//    the catalog; a profile is a candidate only if applyProfile(canonical,
//    profile) matches the observed scan for EVERY pair supplied. With >=2
//    pairs across different UPC shapes (e.g. one compressible-to-UPC-E code
//    and one not), the candidate set almost always collapses to exactly one
//    profile — that's what "capture which format matched, set it true" means
//    in practice.
//
// 2. DATABASE-LOOKUP (probabilistic, single sample) — you only have a raw
//    scanned code and a set/lookup of canonical UPCs already known to exist
//    in the system (no direct pairing). Try reversing the scanned code under
//    every profile; a profile is a candidate if its reversed-to-canonical
//    result exists in the known set. This can be ambiguous (multiple
//    profiles may coincidentally reconstruct a UPC that happens to be in the
//    DB), so it reports ALL matching candidates with a confidence signal
//    rather than silently picking one. Feeding in more sample codes narrows
//    the candidate set the same way pair-based detection does.

import { listProfiles, getProfile } from './profiles.mjs';
import { applyProfile, reverseProfile } from './pipeline.mjs';
import { toCanonical } from './core.mjs';

/**
 * @param {{canonical: string, scanned: string}[]} pairs - known-truth UPC and what the scanner emitted for it
 * @returns {{ resolved: boolean, profile: string|null, candidates: string[], detail: object[] }}
 */
export function detectProfileFromPairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('detectProfileFromPairs requires a non-empty array of {canonical, scanned} pairs');
  }
  const normalizedPairs = pairs.map((p) => {
    const canonicalResult = toCanonical(p.canonical);
    if (canonicalResult.format !== 'UPC_A_12' || !canonicalResult.canonical) {
      throw new Error(`Pair canonical "${p.canonical}" is not UPC-A representable`);
    }
    return { canonical: canonicalResult.canonical, scanned: String(p.scanned) };
  });

  const profiles = listProfiles();
  const detail = [];
  const candidates = [];

  for (const { name } of profiles) {
    const profile = getProfile(name);
    let matchesAll = true;
    const perPair = [];
    for (const pair of normalizedPairs) {
      let produced;
      try {
        produced = applyProfile(pair.canonical, profile);
      } catch (err) {
        produced = null;
      }
      const matched = produced === pair.scanned;
      perPair.push({ canonical: pair.canonical, scanned: pair.scanned, produced, matched });
      if (!matched) matchesAll = false;
    }
    detail.push({ profile: name, matchesAll, pairs: perPair });
    if (matchesAll) candidates.push(name);
  }

  return {
    resolved: candidates.length === 1,
    profile: candidates.length === 1 ? candidates[0] : null,
    candidates,
    detail,
    samplesUsed: normalizedPairs.length,
  };
}

/**
 * @param {string[]} scannedCodes - raw codes observed coming off a scanner/POS, truth unknown
 * @param {Set<string>|string[]} knownCanonicalUpcs - the set of canonical UPC-A(12) values already known to exist in "the system" (e.g. product master)
 * @returns {{ resolved: boolean, profile: string|null, candidates: object[] }}
 */
export function detectProfileFromDatabase(scannedCodes, knownCanonicalUpcs) {
  if (!Array.isArray(scannedCodes) || scannedCodes.length === 0) {
    throw new Error('detectProfileFromDatabase requires a non-empty array of scanned codes');
  }
  const known = knownCanonicalUpcs instanceof Set ? knownCanonicalUpcs : new Set(knownCanonicalUpcs);
  const profiles = listProfiles();

  // score[name] = number of scannedCodes this profile successfully reverses
  // to a canonical UPC that's actually in the known set.
  const scoreByProfile = new Map();
  for (const { name } of profiles) scoreByProfile.set(name, 0);

  for (const scanned of scannedCodes) {
    for (const { name } of profiles) {
      const profile = getProfile(name);
      let canonical;
      try {
        canonical = reverseProfile(scanned, profile);
      } catch {
        continue;
      }
      if (known.has(canonical)) {
        scoreByProfile.set(name, scoreByProfile.get(name) + 1);
      }
    }
  }

  const maxScore = Math.max(...scoreByProfile.values());
  const candidates = [...scoreByProfile.entries()]
    .filter(([, score]) => score === maxScore && maxScore > 0)
    .map(([name, score]) => ({ profile: name, matchedSamples: score, totalSamples: scannedCodes.length }));

  return {
    resolved: candidates.length === 1 && maxScore === scannedCodes.length,
    profile: candidates.length === 1 ? candidates[0].profile : null,
    candidates,
    samplesUsed: scannedCodes.length,
  };
}

// Active-profile registry: once a scanner/POS ("system") has been
// identified via detect.mjs, persist that binding so later conversions for
// that system don't need to re-detect every time. This is the "capture
// which format matched and trigger that format true for moving forward"
// behavior — a lightweight JSON-file store, swappable for a real DB later
// (the interface is deliberately narrow: get/set/list/clear by systemId).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getProfile } from './profiles.mjs';
import { UpcError } from './core.mjs';

const DEFAULT_STORE_PATH = path.join(process.cwd(), '.upc-engine', 'active-profiles.json');

function load(storePath) {
  if (!existsSync(storePath)) return {};
  return JSON.parse(readFileSync(storePath, 'utf8'));
}

function save(storePath, data) {
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Bind a systemId (a POS instance / store / lane / scanner serial — whatever
 * granularity "a system" means for the caller) to a resolved profile name.
 * Validates the profile exists before persisting so a bad detect() result
 * can never silently brick downstream conversions.
 */
export function setActiveProfile(systemId, profileName, opts = {}) {
  const storePath = opts.storePath || DEFAULT_STORE_PATH;
  getProfile(profileName); // throws UpcError if unknown — fail fast
  const data = load(storePath);
  data[systemId] = {
    profile: profileName,
    setAt: new Date().toISOString(),
    detectedFrom: opts.detectedFrom || null, // e.g. {method:'pairs', samplesUsed:3}
  };
  save(storePath, data);
  return data[systemId];
}

export function getActiveProfile(systemId, opts = {}) {
  const storePath = opts.storePath || DEFAULT_STORE_PATH;
  const data = load(storePath);
  const entry = data[systemId];
  if (!entry) {
    throw new UpcError(`No active profile set for system "${systemId}"`, 'NO_ACTIVE_PROFILE');
  }
  return entry;
}

export function listActiveProfiles(opts = {}) {
  const storePath = opts.storePath || DEFAULT_STORE_PATH;
  return load(storePath);
}

export function clearActiveProfile(systemId, opts = {}) {
  const storePath = opts.storePath || DEFAULT_STORE_PATH;
  const data = load(storePath);
  delete data[systemId];
  save(storePath, data);
}

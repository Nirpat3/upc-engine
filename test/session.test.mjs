import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  setActiveProfile,
  getActiveProfile,
  listActiveProfiles,
  clearActiveProfile,
} from '../src/session.mjs';
import { UpcError } from '../src/core.mjs';

function withTempStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'upc-engine-session-'));
  const storePath = path.join(dir, 'active-profiles.json');
  try {
    return fn({ storePath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('setActiveProfile persists and getActiveProfile reads it back', () => {
  withTempStore((opts) => {
    setActiveProfile('pos-lane-1', 'upc_a_no_check_digit', { ...opts, detectedFrom: { method: 'pairs', samplesUsed: 2 } });
    const entry = getActiveProfile('pos-lane-1', opts);
    assert.equal(entry.profile, 'upc_a_no_check_digit');
    assert.equal(entry.detectedFrom.method, 'pairs');
    assert.ok(entry.setAt);
  });
});

test('setActiveProfile rejects an unknown profile name (fail fast, never persists garbage)', () => {
  withTempStore((opts) => {
    assert.throws(() => setActiveProfile('pos-lane-1', 'not-a-real-profile', opts), UpcError);
    assert.throws(() => getActiveProfile('pos-lane-1', opts), UpcError);
  });
});

test('listActiveProfiles returns all bound systems; clearActiveProfile removes one', () => {
  withTempStore((opts) => {
    setActiveProfile('pos-lane-1', 'raw_upc_a_full', opts);
    setActiveProfile('pos-lane-2', 'upc_e_full', opts);
    const all = listActiveProfiles(opts);
    assert.equal(Object.keys(all).length, 2);
    clearActiveProfile('pos-lane-1', opts);
    const afterClear = listActiveProfiles(opts);
    assert.equal(Object.keys(afterClear).length, 1);
    assert.ok(afterClear['pos-lane-2']);
  });
});

test('getActiveProfile on an unbound systemId throws a typed error, not undefined', () => {
  withTempStore((opts) => {
    assert.throws(() => getActiveProfile('never-set', opts), UpcError);
  });
});

#!/usr/bin/env node
// UPC Engine CLI. All output JSON so it's scriptable; exit code 1 on any
// item-level failure in batch mode so callers can detect partial failure.
import { identify, toCanonical } from '../src/core.mjs';
import { applyProfile, reverseProfile, convertToProfile } from '../src/pipeline.mjs';
import { convertBatch, identifyBatch } from '../src/batch.mjs';
import { listProfiles, getProfile } from '../src/profiles.mjs';
import { detectProfileFromPairs, detectProfileFromDatabase } from '../src/detect.mjs';
import { setActiveProfile, getActiveProfile, listActiveProfiles, clearActiveProfile } from '../src/session.mjs';

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

const [, , cmd, ...args] = process.argv;

try {
  switch (cmd) {
    case 'identify': {
      const [code] = args;
      if (!code) fail('usage: upc-engine identify <code>');
      out(identify(code));
      break;
    }
    case 'to-canonical': {
      const [code] = args;
      if (!code) fail('usage: upc-engine to-canonical <code>');
      out(toCanonical(code));
      break;
    }
    case 'convert': {
      const [code, profileName] = args;
      if (!code || !profileName) fail('usage: upc-engine convert <code> <profile>');
      const profile = getProfile(profileName);
      const output = convertToProfile(code, profile);
      out({ input: code, profile: profileName, output });
      break;
    }
    case 'reverse': {
      const [code, profileName] = args;
      if (!code || !profileName) fail('usage: upc-engine reverse <code> <profile>');
      const profile = getProfile(profileName);
      const canonical = reverseProfile(code, profile);
      out({ input: code, profile: profileName, canonical });
      break;
    }
    case 'translate': {
      const [code, fromProfileName, toProfileName] = args;
      if (!code || !fromProfileName || !toProfileName) {
        fail('usage: upc-engine translate <code> <fromProfile> <toProfile>');
      }
      const fromProfile = getProfile(fromProfileName);
      const toProfile = getProfile(toProfileName);
      const canonical = reverseProfile(code, fromProfile);
      const output = applyProfile(canonical, toProfile);
      out({ input: code, from: fromProfileName, to: toProfileName, canonical, output });
      break;
    }
    case 'batch-convert': {
      // reads JSON array of codes from stdin; --to/--from profile flags
      const toIdx = args.indexOf('--to');
      const fromIdx = args.indexOf('--from');
      const toProfile = toIdx >= 0 ? args[toIdx + 1] : undefined;
      const fromProfile = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
      const stdin = await readStdin();
      const codes = JSON.parse(stdin);
      const results = convertBatch(codes, { toProfile, fromProfile });
      out(results);
      if (results.some((r) => !r.ok)) process.exitCode = 1;
      break;
    }
    case 'batch-identify': {
      const stdin = await readStdin();
      const codes = JSON.parse(stdin);
      const results = identifyBatch(codes);
      out(results);
      if (results.some((r) => !r.ok)) process.exitCode = 1;
      break;
    }
    case 'list-profiles': {
      out(listProfiles());
      break;
    }
    case 'detect-from-pairs': {
      // stdin: JSON array of {canonical, scanned}
      const stdin = await readStdin();
      const pairs = JSON.parse(stdin);
      const result = detectProfileFromPairs(pairs);
      out(result);
      if (!result.resolved) process.exitCode = 1;
      break;
    }
    case 'detect-from-database': {
      // args: --known <path-to-json-array-of-canonical-upcs>; stdin: JSON array of scanned codes
      const knownIdx = args.indexOf('--known');
      if (knownIdx < 0) fail('usage: upc-engine detect-from-database --known <file.json>  (scanned codes as JSON array on stdin)');
      const { readFileSync } = await import('node:fs');
      const known = JSON.parse(readFileSync(args[knownIdx + 1], 'utf8'));
      const stdin = await readStdin();
      const scannedCodes = JSON.parse(stdin);
      const result = detectProfileFromDatabase(scannedCodes, known);
      out(result);
      if (!result.resolved) process.exitCode = 1;
      break;
    }
    case 'set-active-profile': {
      const [systemId, profileName] = args;
      if (!systemId || !profileName) fail('usage: upc-engine set-active-profile <systemId> <profile>');
      out(setActiveProfile(systemId, profileName));
      break;
    }
    case 'get-active-profile': {
      const [systemId] = args;
      if (!systemId) fail('usage: upc-engine get-active-profile <systemId>');
      out(getActiveProfile(systemId));
      break;
    }
    case 'list-active-profiles': {
      out(listActiveProfiles());
      break;
    }
    case 'clear-active-profile': {
      const [systemId] = args;
      if (!systemId) fail('usage: upc-engine clear-active-profile <systemId>');
      clearActiveProfile(systemId);
      out({ cleared: systemId });
      break;
    }
    default:
      out({
        usage: [
          'upc-engine identify <code>',
          'upc-engine to-canonical <code>',
          'upc-engine convert <code> <profile>',
          'upc-engine reverse <code> <profile>',
          'upc-engine translate <code> <fromProfile> <toProfile>',
          'upc-engine batch-convert --to <profile> [--from <profile>]  (codes as JSON array on stdin)',
          'upc-engine batch-identify  (codes as JSON array on stdin)',
          'upc-engine list-profiles',
          'upc-engine detect-from-pairs  ([{canonical,scanned}] as JSON array on stdin)',
          'upc-engine detect-from-database --known <file.json>  (scanned codes as JSON array on stdin)',
          'upc-engine set-active-profile <systemId> <profile>',
          'upc-engine get-active-profile <systemId>',
          'upc-engine list-active-profiles',
          'upc-engine clear-active-profile <systemId>',
        ],
      });
  }
} catch (err) {
  fail(err?.message ?? String(err));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

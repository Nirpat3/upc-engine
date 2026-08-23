#!/usr/bin/env node
// UPC Engine CLI. All output JSON so it's scriptable; exit code 1 on any
// item-level failure in batch mode so callers can detect partial failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Optional .env loader: if a .env file exists next to package.json and the
// corresponding env var isn't already set in the real environment, load it.
// Purely additive/opt-in -- absence of .env changes nothing (see README
// "Persistence is opt-in"). Real env vars always win over .env contents.
function loadDotEnvIfPresent() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvIfPresent();

import { identify, toCanonical } from '../src/core.mjs';
import { applyProfile, reverseProfile, convertToProfile } from '../src/pipeline.mjs';
import { convertBatch, identifyBatch } from '../src/batch.mjs';
import { listProfiles, getProfile } from '../src/profiles.mjs';
import { detectProfileFromPairs, detectProfileFromDatabase } from '../src/detect.mjs';
import { setActiveProfile, getActiveProfile, listActiveProfiles, clearActiveProfile } from '../src/session.mjs';
import { decomposeUpcA, decomposeEan13, decomposeAny, createBrandProfile, NUMBER_SYSTEM_MEANINGS } from '../src/decompose.mjs';
import { recordUpc, getUpcRecord, listUpcRecords, isDbConfigured } from '../src/db.mjs';
import { lookupGs1Country, isLatinAmericanGs1 } from '../src/gs1-country.mjs';

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

const [, , cmd, ...args] = process.argv;

try {
  await (async () => {
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
    case 'decompose': {
      const [code, prefixLenArg] = args;
      if (!code) fail('usage: upc-engine decompose <code> [companyPrefixLength]');
      const canonicalResult = toCanonical(code);
      if (!canonicalResult.canonical) fail(`"${code}" did not canonicalize (format: ${canonicalResult.format})`);
      const opts = prefixLenArg ? { companyPrefixLength: Number(prefixLenArg) } : {};
      out(decomposeAny(canonicalResult, opts));
      break;
    }
    case 'gs1-country': {
      const [code] = args;
      if (!code) fail('usage: upc-engine gs1-country <code>');
      const info = lookupGs1Country(code);
      out(info ?? { prefix: null, country: null, region: null, upcACompatible: null, note: 'No known GS1 prefix range matched this code.' });
      break;
    }

    case 'number-systems': {
      out(NUMBER_SYSTEM_MEANINGS);
      break;
    }
    case 'db-status': {
      const configured = isDbConfigured();
      out({
        configured,
        message: configured
          ? 'Supabase configured — db-record/db-get/db-list are live.'
          : 'Supabase NOT configured (optional). The engine works fully without it. To enable persistence: copy .env.example to .env, fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, run db/schema.sql once in the Supabase SQL editor, then re-run db-status.',
      });
      break;
    }
    case 'db-record': {
      // upc-engine db-record <code> [--brand X] [--product Y] [--profile Z] [--prefix-len N]
      const [code, ...rest] = args;
      if (!code) fail('usage: upc-engine db-record <code> [--brand X] [--product Y] [--profile Z] [--prefix-len N]');
      const { canonical, format } = toCanonical(code);
      if (format !== 'UPC_A_12' || !canonical) fail(`"${code}" is not UPC-A representable`);
      const getFlag = (name) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : undefined;
      };
      try {
        const result = await recordUpc(canonical, {
          brandName: getFlag('brand'),
          productName: getFlag('product'),
          sourceProfile: getFlag('profile'),
          rawInput: code,
          companyPrefixLength: getFlag('prefix-len') ? Number(getFlag('prefix-len')) : undefined,
        });
        out(result);
      } catch (e) {
        fail(e.message);
      }
      break;
    }
    case 'db-get': {
      const [code] = args;
      if (!code) fail('usage: upc-engine db-get <canonicalUpcA12>');
      try {
        out(await getUpcRecord(code));
      } catch (e) {
        fail(e.message);
      }
      break;
    }
    case 'db-list': {
      const brandIdx = args.indexOf('--brand');
      const prefixIdx = args.indexOf('--prefix');
      try {
        out(await listUpcRecords({
          brandName: brandIdx >= 0 ? args[brandIdx + 1] : undefined,
          companyPrefix: prefixIdx >= 0 ? args[prefixIdx + 1] : undefined,
        }));
      } catch (e) {
        fail(e.message);
      }
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
          'upc-engine decompose <code> [companyPrefixLength]',
          'upc-engine number-systems',
          'upc-engine gs1-country <code>',
          'upc-engine db-status',
          'upc-engine db-record <code> [--brand X] [--product Y] [--profile Z] [--prefix-len N]',
          'upc-engine db-get <canonicalUpcA12>',
          'upc-engine db-list [--brand X] [--prefix Y]',
        ],
      });
  }
  })();
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

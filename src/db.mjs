// Supabase-backed UPC database: every UPC that runs through the engine can
// be recorded here with full structure -- canonical form, decomposition,
// detected/active scanner profile, and free-form brand/product metadata.
//
// Design goals:
//   - Zero hard dependency: if SUPABASE_URL / SUPABASE_KEY are not set, every
//     function throws a clear, typed error at call time -- never at import
//     time -- so the rest of the engine (core/pipeline/detect/CLI) keeps
//     working with zero network/config requirement.
//   - No SDK dependency: talks to Supabase's PostgREST API directly via
//     fetch, so this module adds no new npm packages to the project.
//   - Upsert-first: recording the same UPC twice updates it, never duplicates.
//
// Expected Supabase table (see db/schema.sql for the exact DDL):
//   upc_records(
//     upc_a           text primary key,        -- canonical 12-digit UPC-A
//     number_system   text not null,
//     company_prefix  text,
//     item_reference  text,
//     check_digit     text not null,
//     brand_name      text,
//     product_name    text,
//     source_profile  text,                     -- which scanner profile the input was decoded from
//     raw_input       text,                      -- the exact string the engine received
//     metadata        jsonb,                     -- free-form: category, notes, whatever the caller wants
//     first_seen_at   timestamptz not null default now(),
//     last_seen_at    timestamptz not null default now(),
//     seen_count      integer not null default 1
//   );

import { UpcError } from './core.mjs';
import { decomposeUpcA } from './decompose.mjs';

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new UpcError(
      'Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) env vars.',
      'DB_NOT_CONFIGURED'
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function restRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const { url, key } = getConfig();
  const res = await fetch(`${url}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UpcError(`Supabase request failed (${res.status}): ${text || res.statusText}`, 'DB_REQUEST_FAILED');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Record (upsert) a UPC that ran through the engine. Idempotent: calling
 * again for the same upc_a updates last_seen_at/seen_count and any newly
 * supplied fields, rather than creating a duplicate row.
 * @param {string} canonicalUpcA - 12-digit canonical UPC-A.
 * @param {object} [meta]
 * @param {string} [meta.brandName]
 * @param {string} [meta.productName]
 * @param {string} [meta.sourceProfile] - name of the scanner profile the input was decoded from.
 * @param {string} [meta.rawInput] - the exact raw string the engine received.
 * @param {number} [meta.companyPrefixLength] - passed through to decomposeUpcA.
 * @param {object} [meta.metadata] - free-form JSON, merged shallowly server-side is NOT done;
 *   caller should pass the full desired object each time.
 */
export async function recordUpc(canonicalUpcA, meta = {}) {
  const decomposed = decomposeUpcA(canonicalUpcA, { companyPrefixLength: meta.companyPrefixLength });

  const row = {
    upc_a: canonicalUpcA,
    number_system: decomposed.numberSystem,
    company_prefix: decomposed.companyPrefix,
    item_reference: decomposed.itemReference,
    check_digit: decomposed.checkDigit,
    brand_name: meta.brandName ?? null,
    product_name: meta.productName ?? null,
    source_profile: meta.sourceProfile ?? null,
    raw_input: meta.rawInput ?? canonicalUpcA,
    metadata: meta.metadata ?? null,
    last_seen_at: new Date().toISOString(),
  };

  // Upsert via PostgREST: on conflict (upc_a) merge. seen_count increment is
  // done via a Postgres function/trigger recommended in db/schema.sql because
  // PostgREST upsert can't do "seen_count = seen_count + 1" atomically from
  // the client; if the trigger isn't installed, seen_count just won't increment
  // (non-fatal -- everything else still records correctly).
  const result = await restRequest('/upc_records?on_conflict=upc_a', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: row,
  });
  return Array.isArray(result) ? result[0] : result;
}

/** Fetch a single UPC record by canonical UPC-A. Returns null if not found. */
export async function getUpcRecord(canonicalUpcA) {
  const result = await restRequest(`/upc_records?upc_a=eq.${encodeURIComponent(canonicalUpcA)}&limit=1`);
  return Array.isArray(result) && result.length > 0 ? result[0] : null;
}

/** List UPC records, optionally filtered by brand name (exact match) or company prefix. */
export async function listUpcRecords({ brandName, companyPrefix, limit = 100, offset = 0 } = {}) {
  const filters = [];
  if (brandName) filters.push(`brand_name=eq.${encodeURIComponent(brandName)}`);
  if (companyPrefix) filters.push(`company_prefix=eq.${encodeURIComponent(companyPrefix)}`);
  filters.push(`limit=${limit}`, `offset=${offset}`, 'order=last_seen_at.desc');
  return restRequest(`/upc_records?${filters.join('&')}`);
}

/** Delete a UPC record (rare -- mostly for test/data cleanup). */
export async function deleteUpcRecord(canonicalUpcA) {
  await restRequest(`/upc_records?upc_a=eq.${encodeURIComponent(canonicalUpcA)}`, { method: 'DELETE' });
  return { deleted: canonicalUpcA };
}

/** True if SUPABASE_URL/KEY env vars are present (does not verify they're valid). */
export function isDbConfigured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY));
}

// Profile catalog loader: built-in JSON catalog + optional user overrides.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UpcError } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '..', 'profiles', 'catalog.json');

let _catalog = null;

export function loadCatalog(customPath) {
  const p = customPath || CATALOG_PATH;
  if (!existsSync(p)) {
    throw new UpcError(`Profile catalog not found at ${p}`, 'CATALOG_MISSING');
  }
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

export function listProfiles(customPath) {
  const catalog = customPath ? loadCatalog(customPath) : (_catalog ??= loadCatalog());
  return Object.entries(catalog).map(([name, def]) => ({ name, description: def.description }));
}

export function getProfile(name, customPath) {
  const catalog = customPath ? loadCatalog(customPath) : (_catalog ??= loadCatalog());
  const profile = catalog[name];
  if (!profile) {
    throw new UpcError(`Unknown profile "${name}". Run "list profiles" to see options.`, 'UNKNOWN_PROFILE');
  }
  return profile;
}

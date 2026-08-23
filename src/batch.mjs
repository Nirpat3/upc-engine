// Batch layer: N-in, N-out, order-preserving, per-item error isolation.
import { toCanonical, identify, UpcError } from './core.mjs';
import { applyProfile, reverseProfile, convertToProfile } from './pipeline.mjs';
import { getProfile } from './profiles.mjs';

/**
 * @param {string[]} codes
 * @param {{toProfile?: string, fromProfile?: string}} opts
 *   toProfile: canonicalize each code then format for this outbound profile.
 *   fromProfile: treat each code as already in this profile's device shape
 *     and reverse it to canonical (ign². toProfile with fromProfile both set
 *     reverses then re-applies, i.e. device-A -> device-B translation).
 * @returns {{ok: boolean, index: number, input: string, output?: string, error?: string, code?: string}[]}
 */
export function convertBatch(codes, opts = {}) {
  if (!Array.isArray(codes)) {
    throw new UpcError('convertBatch requires an array of codes', 'BAD_INPUT');
  }
  return codes.map((input, index) => {
    try {
      let canonical;
      if (opts.fromProfile) {
        const profile = getProfile(opts.fromProfile);
        canonical = reverseProfile(input, profile);
      } else {
        const result = toCanonical(input);
        if (result.format !== 'UPC_A_12' || !result.canonical) {
          throw new UpcError(`"${input}" is not UPC-A representable`, 'NON_UPC_A');
        }
        canonical = result.canonical;
      }

      let output = canonical;
      if (opts.toProfile) {
        const profile = getProfile(opts.toProfile);
        output = applyProfile(canonical, profile);
      }

      return { ok: true, index, input, canonical, output };
    } catch (err) {
      return {
        ok: false,
        index,
        input,
        error: err?.message ?? String(err),
        code: err?.code ?? 'UNKNOWN',
      };
    }
  });
}

export function identifyBatch(codes) {
  return codes.map((input, index) => {
    try {
      const { format, digits } = identify(input);
      return { ok: true, index, input, format, digits };
    } catch (err) {
      return { ok: false, index, input, error: err?.message ?? String(err), code: err?.code ?? 'UNKNOWN' };
    }
  });
}

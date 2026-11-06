/** Production-hardening helpers kept independent from the dashboard server. */
export const HARDENING_VERSION = '1.0';

export function clampLimit(value, { min = 1, max = 100, fallback = min } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function sanitizeError(error, { exposeMessage = false } = {}) {
  if (exposeMessage) return String(error?.message || error || 'Unknown error');
  return 'Interner Fehler. Details wurden im Server-Log erfasst.';
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /token|secret|password|api[-_]?key|authorization/i.test(key) ? '********' : redactSecrets(item);
  }
  return result;
}

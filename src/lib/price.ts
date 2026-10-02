/**
 * Parse a user-typed price. Handles thousands separators and decimal commas:
 *   "64,250" → 64250, "64,250.5" → 64250.5, "1.234,5" → 1234.5, "0,5" → 0.5, "0.000123" → 0.000123.
 * Returns null for empty or unparseable input.
 */
export function parsePrice(raw: string): number | null {
  let s = raw.trim().replace(/[\s_'’]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Whichever comes last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    // "64,250" / "1,234,567" → thousands; otherwise a decimal comma ("0,5", "1,25").
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (!/^\d*\.?\d+(e-?\d+)?$/i.test(s) && !/^\d+\.$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

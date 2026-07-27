import { AMOUNT_MIN, AMOUNT_MAX, MAX_TAGS_COUNT } from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// Sanitize
// ─────────────────────────────────────────────────────────────────────────────

/** Trim + collapse internal whitespace */
export const sanitize = (val: string): string => val.trim().replace(/\s+/g, ' ');

// ─────────────────────────────────────────────────────────────────────────────
// Amount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an error string or null.
 * Accepts empty string (returns null — field is optional until submit).
 */
export const validateAmount = (val: string): string | null => {
  if (!val) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(val.replace(/^0+(?=\d)/, ''))) {
    return 'Max 2 decimal places allowed.';
  }
  const num = Number(val);
  if (isNaN(num)) return 'Enter a valid number.';
  if (num < 0) return 'Amount cannot be negative.';
  if (num < AMOUNT_MIN) return 'Amount must be greater than ₹0.';
  if (num > AMOUNT_MAX) return `Amount cannot exceed ₹${AMOUNT_MAX.toLocaleString('en-IN')}.`;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Text fields
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic text validator.
 * @param value     Raw input value
 * @param max       Maximum character length
 * @param label     Field label used in error messages (e.g. "Name", "Category")
 * @param allowEmpty Whether an empty value is valid (default false)
 */
export const validateText = (
  value: string,
  max: number,
  label: string,
  allowEmpty = false,
): string | null => {
  if (!allowEmpty && !value.trim()) return `${label} cannot be empty.`;
  if (value.length > max) return `${label} must be ${max} characters or less.`;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case-insensitive + trimmed duplicate check.
 * Optionally excludes the item at `excludeIndex`.
 */
export const isDuplicate = (
  value: string,
  list: string[],
  excludeIndex?: number,
): boolean => {
  const normalized = sanitize(value).toLowerCase();
  return list.some(
    (item, idx) =>
      idx !== excludeIndex &&
      sanitize(item).toLowerCase() === normalized,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────

/** Parse comma-separated tag string into a clean array */
export const parseTags = (raw: string): string[] =>
  raw
    .split(',')
    .map((t) => sanitize(t))
    .filter(Boolean)
    .slice(0, MAX_TAGS_COUNT);

/** Returns error string or null */
export const validateTags = (raw: string): string | null => {
  const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length > MAX_TAGS_COUNT) return `Max ${MAX_TAGS_COUNT} tags allowed.`;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Counter helper
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when the counter should be shown (>= 80% of max) */
export const showCounter = (value: string, max: number): boolean =>
  value.length >= Math.floor(max * 0.8);

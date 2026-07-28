// ─────────────────────────────────────────────────────────────────────────────
// App-wide constants — change here, applies everywhere
// ─────────────────────────────────────────────────────────────────────────────

// Amount field
export const AMOUNT_MIN = 0.01;
export const AMOUNT_MAX = 9_999_999;

// People / trip setup
export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 20;
export const MAX_BUDGET_PER_PERSON = 10_000_000;

// Text field lengths
export const MAX_TRIP_NAME_LENGTH = 60;
export const MAX_PARTICIPANT_NAME_LENGTH = 30;
export const MAX_CATEGORY_NAME_LENGTH = 30;
export const MAX_NOTE_LENGTH = 100;
export const MAX_TAGS_INPUT_LENGTH = 100;
export const MAX_TAGS_COUNT = 10;
export const MAX_SETTLEMENT_NOTE_LENGTH = 150;
export const MAX_JOIN_TRIP_ID_LENGTH = 12;

// Counter thresholds — show counter when usage >= this fraction of max
export const COUNTER_THRESHOLD = 0.8;

// Default categories
export const DEFAULT_CATEGORIES = ['Food', 'Travel', 'Stay', 'Misc'] as const;

// Budget regex — digits with up to 2 decimal places
export const BUDGET_REGEX = /^\d*(?:\.\d{0,2})?$/;

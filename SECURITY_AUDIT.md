# TripSpend Security Audit — Current `main`

Date: 2026-07-28  
Baseline commit: `e7e89fc` (`origin/main`), plus the current uncommitted hardening changes  
Scope: complete checked-out application, Firestore rules, Android sharing configuration, server proxy, tests, and build configuration.

This is a static review plus the repository test/build commands. It is not a penetration test, production Firestore review, or dependency CVE scan. `npm audit` was not run because it would send dependency metadata to an external service.

## Executive summary

The AI Studio patch fixes several genuine issues: the Gemini key is no longer read from `VITE_*` client variables, deep-link IDs are constrained, file-size checks are centralized, transfer-key duplication is reduced, and the TypeScript errors from the previous audit were partly addressed.

The highest-impact access and build blockers have been fixed in this worktree. Residual risks remain around broad member-controlled nested state, local plaintext storage, provider timeout/cost controls, and the lack of a durable invite lifecycle. The most important remaining issues are:

1. Members can still update large nested business-state fields through one broad Firestore allowlist.
2. Local trip data remains plaintext in localStorage/IndexedDB by design.
3. AI provider calls still need durable quotas, cancellation, and production abuse monitoring.
4. New invite codes expire, but there is still no revocation or single-use limit, and legacy trips without invite metadata remain permissive.

## Severity summary

| ID | Severity | Status | Area |
|---|---|---|---|
| H-01 | High | Fixed | Firestore outsider reads |
| H-02 | High | Partially fixed | Firestore trip update authorization |
| H-03 | High | Partially fixed | Gemini proxy abuse / key protection |
| H-04 | High | Fixed | Sync fallback and duplicate canonical data |
| H-05 | High | Fixed | Android external storage exposure |
| H-06 | High | Fixed | Missing Firebase config breaks release build |
| M-01 | Medium | Partially fixed | Weak join-code security |
| M-02 | Medium | Partially fixed | Plaintext local sensitive data |
| M-03 | Medium | Partially fixed | Sensitive diagnostic logging remains |
| M-04 | Medium | Partially fixed | Cloud deletion/data consistency behavior |
| M-05 | Medium | Fixed | Untrusted AI response handling |
| M-06 | Medium | Partially fixed | Weak server request controls |
| M-07 | Medium | Partially fixed | Client-side file/OCR resource exhaustion |
| M-08 | Medium | Partially fixed | Missing schema validation at Firestore boundaries |
| L-01 | Low | Partially fixed | Test coverage does not match comments |
| L-02 | Low | Open | Complexity and duplicated state paths |
| L-03 | Low | Partially fixed | Production bundle and operational hygiene |

## High-risk findings

### H-01 — Any signed-in user can read arbitrary trip documents

Status: fixed in this worktree. `firestore.rules:61` now requires membership or creator access, `firestore.rules:63` restricts list results to members, and `tests/firestore-rules-emulator.ts` explicitly rejects outsider trip and subcollection reads. The join flow no longer performs a pre-read; it attempts the constrained self-join update directly.

Current rule at `firestore.rules:61`:

```text
allow get: if signedIn() && (isMemberFromResource() || resource.data.createdBy == uid());
```

The previously vulnerable branch was true for any normal trip document because collaborative trips have a `members` list. It did not check that the caller's UID was in that list. That branch has now been removed.

The list rule at `firestore.rules:63` evaluates membership from each returned resource, and the tests now reject outsider trip queries plus expense, settlement, and history reads.

Regression risk: this protection depends on all list callers using a membership-constrained query.

Follow-up: keep the explicit outsider read/list tests in CI and consider a separate invite-token document if the join flow needs a non-membership lookup in the future.

### H-02 — Trip update controls are improved but still trust client-controlled document fields

Evidence: `firestore.rules:64-72` now protects `createdBy` and `members`, which is good, but allows existing members to update:

```text
['name', 'setup', 'updatedAt', 'identityMap', 'memberRegistry',
 'participants', 'deletedExpenseMap', 'schemaVersion']
```

These fields contain most of the application's business state. A member can still rewrite setup, identities, the member registry, participant metadata, deleted-expense tombstones, or the schema marker. The rules now enforce top-level key counts, member/name bounds, map/list bounds, and basic types, but they still do not validate every nested key, ownership transition, or timestamp monotonicity.

Impact: an authorized member can corrupt or falsify shared trip state, hide expenses through tombstones, alter identity mappings, or create oversized documents. This is an integrity issue even though critical top-level fields are now immutable.

Follow-up: separate operations into narrow rules or callable/server-side mutations. Validate immutable identity fields, registry transitions, tombstones, timestamps, and nested schemas. Do not let a generic member update endpoint write all domain state.

### H-03 — Gemini key is server-side, but the proxy is an unauthenticated quota-exhaustion endpoint

Status: partially fixed. The route now requires a Firebase ID token, applies an in-memory UID/IP rate limit, caps JSON to 64 KB, validates fields and amount ranges, bounds output, and uses a timeout. Production still needs durable distributed rate limiting, provider cancellation, quotas, and monitoring.

Evidence: `server.ts:17-154` exposes `POST /api/categorize-expense` and now verifies Firebase ID tokens and applies local rate limiting. The server listens on all interfaces at `server.ts:88`.

Moving the key out of the browser and requiring a verified user prevents the original unauthenticated abuse path. A single server instance can still be exhausted, and the provider promise is raced rather than cancelled after timeout.

Follow-up: move rate limits/quotas to a shared store or gateway, cancel provider work when supported, and add spend alerts and concurrency limits.

### H-04 — Silent sync fallback and two canonical expense stores remain

Status: fixed in this worktree. `src/services/cloudTrip.ts:219-238` now returns `success: false` without writing embedded expense data when subcollection sync fails.

The old implementation caught a subcollection failure, wrote the complete expense payload into the parent document, and returned `success: true`. That fallback has now been removed.

The old normal/fallback split used `trips/{tripId}/expenses/{expenseId}` and `trips/{tripId}.data.expenses`; that fallback has been removed.

Follow-up: add an idempotent retry queue and targeted failure/retry tests.

### H-05 — Android FileProvider exposes the entire external storage root

Status: fixed in this worktree. `android/app/src/main/res/xml/file_paths.xml` no longer contains `external-path path="."`; exports use the app cache path.

The previous provider exposed arbitrary external storage with `external-path path="."`. That entry has now been removed; exports use the app cache path.

Follow-up: verify the generated Android manifest and sharing behavior on a device.

### H-06 — Missing Firebase configuration makes lint and production build fail

Status: fixed in this worktree. `src/lib/firebase.ts` now uses optional `VITE_FIREBASE_*` values directly, so a clean clone does not require an untracked JSON import.

The previous implementation imported a missing `../../firebase-applet-config.json`, causing clean-clone module-resolution failures. The import has now been removed and the app reads optional environment configuration directly.

Follow-up: keep clean-clone CI coverage and never commit real Firebase credentials.

## Medium-risk findings

### M-01 — Invite codes lack expiry and revocation

Status: partially fixed. `src/App.tsx`, `src/components/TripSwitcher.tsx`, and `src/hooks/collaborative/useTripMutations.ts` now use 12-digit codes generated from browser randomness. New trips carry an active flag and expiry timestamp, and `firestore.rules:44-49` rejects expired joins. There is still no revocation or bounded-use limit, while legacy trips without metadata remain joinable.

Follow-up: add creator-controlled revocation and bounded-use semantics, migrate legacy trips to explicit invite metadata, and avoid exposing whether a code exists through distinguishable responses.

### M-02 — Sensitive trip and settlement data is stored in plaintext browser storage

Status: partially fixed. Account-scoped shared-trip, join, sync-queue, settlement, and notification preference keys are cleared during sign-out, and member-operation queues are capped at 500 items. Local trip data remains plaintext for offline-first behavior.

Evidence: `localStorage` and IndexedDB are used in `src/App.tsx`, `src/hooks/useTripData.ts`, `src/hooks/collaborative/*`, `src/utils/offlineQueue.ts`, `src/utils/settlements.ts`, `src/utils/settlementHistory.ts`, and `src/hooks/useSmartReminders.ts`.

Expenses, participant identities, settlement history, offline operations, and pending join IDs may be readable by any same-origin script, browser extension, shared browser profile, or compromised device. There is no documented retention/clear-on-sign-out guarantee across all stores.

Follow-up: minimize persisted PII, add explicit retention/expiry for local trip records, and document that local backups are sensitive. Do not store authentication tokens in localStorage.

### M-03 — Sensitive diagnostic logging remains

Status: partially fixed. Payload-bearing logs in the main local persistence and expense-entry paths were removed or changed to development-only summaries. Error logs and diagnostics elsewhere still need a production logging policy.

Evidence: `src/hooks/useTripData.ts` and `src/screens/AddExpense.tsx` now use redacted development-only diagnostics for normal state transitions. `src/screens/Settlement.tsx` and other modules still contain error/warning diagnostics that need a production logging policy.

Even when full payloads are not printed, IDs, names, amounts, participant counts, and state transitions can enter browser logs, remote debugging, crash tooling, or support screenshots.

Follow-up: centralize logging behind a disabled-by-default redacted logger and remove provider/auth error payloads from production logs.

### M-04 — Cloud deletion and partial failures need durable completion semantics

Status: partially fixed. Cloud deletion now respects Firestore batch limits by deleting expense documents in chunks and deleting the parent only after child batches complete. It still has no durable retry job or progress record.

Evidence: `src/services/cloudTrip.ts:381-402` deletes child documents in chunks and then deletes the parent, but there is no durable retry/tombstone protocol or user-visible partial state.

Follow-up: use a server-side recursive delete or durable deletion job, make deletion idempotent, record progress, and test retries and large subcollections.

### M-05 — AI output is not constrained to the requested category set

Status: fixed in this worktree. `server.ts` falls back unless the model category exactly matches the supplied allowlist and bounds confidence/reasoning.

Evidence: the previous implementation accepted any string returned as `parsed.category`; the current implementation checks membership in `safeCategories` before returning it.

The prompt is not a security control. A model response or prompt-injected OCR text can still contain untrusted content, but the returned category is now constrained and reasoning is bounded.

Follow-up: keep treating OCR text as untrusted prompt content and add a schema-level response test.

### M-06 — Server request/resource controls are incomplete

Status: partially fixed. The endpoint now rejects unknown fields, limits JSON to 64 KB, caps OCR/categories/reasoning, bounds amounts, rate-limits UID/IP pairs, and times out provider waits.

Evidence: `server.ts:14-154` applies request and field validation, but has no distributed quota, concurrency limiter, or provider cancellation.

Impact: memory pressure, provider latency amplification, prompt-size abuse, and cost spikes.

Follow-up: add distributed quotas, concurrency limits, provider cancellation, and monitoring.

### M-07 — File-size protection does not cover all receipt-processing paths

Status: partially fixed. `blobToDataUrl`, canvas conversion, native exports, and OCR text now use shared byte/text bounds. Image pixel dimensions and OCR concurrency are still not centrally enforced.

Evidence: `src/utils/fileUtils.ts:1-20` caps `File` input at 10 MB, but `src/screens/AddExpense.tsx:54-73` still creates data URLs from canvas blobs, and `src/screens/Settings.tsx:61` independently reads a blob. Base64 expands data by roughly one third, and image dimensions/OCR work are not bounded here.

Follow-up: enforce pixel limits before decode, cancel/serialize OCR jobs, and apply server-side limits to any uploaded/forwarded content.

### M-08 — Firestore accepts broad unvalidated nested payloads

Status: partially fixed. `firestore.rules` now bounds top-level document keys, members, names, participant lists, identity/member maps, tombstones, and schema version type.

Evidence: `firestore.rules:64-72` allows `setup`, `identityMap`, `memberRegistry`, `participants`, and `deletedExpenseMap` updates, while `sanitizeForFirestore` in `src/services/cloudTrip.ts:32-43` only removes `undefined`; it is not a schema validator.

Malformed or attacker-crafted nested data can pass through with unexpected keys, deep structures, huge arrays, invalid dates, or inconsistent member references.

Follow-up: validate exact nested schemas and allowed transitions at the security boundary, not only in TypeScript/client helpers.

## Low-risk and quality findings

### L-01 — Security tests still need nested-state and invite-lifecycle coverage

`tests/firestore-rules-emulator.ts` now explicitly tests outsider trip, expense, settlement, and history reads, membership queries, expired joins, and settlement status transitions. Add tests for:

- member attempts to alter every allowed nested field maliciously;
- create with `paid` settlement status;
- oversized/malformed trip payloads.
- member attempts to inject unexpected nested registry/identity keys;
- revoked or over-use invite codes once those lifecycle controls exist.

### L-02 — High complexity and duplicated state paths increase security drift

The code graph reports these cognitive-complexity hotspots:

| Symbol | File | Cognitive complexity |
|---|---|---:|
| `useTripMutations` | `src/hooks/collaborative/useTripMutations.ts` | 133 |
| `useSmartReminders` | `src/hooks/useSmartReminders.ts` | 123 |
| `AddExpense` | `src/screens/AddExpense.tsx` | 112 |
| `App` | `src/App.tsx` | 99 |
| `Settings` | `src/screens/Settings.tsx` | 85 |
| `Settlement` | `src/screens/Settlement.tsx` | 70 |
| `Analytics` | `src/screens/Analytics.tsx` | 70 |
| `useTripData` | `src/hooks/useTripData.ts` | 62 |
| `calculateSettlement` | `src/utils/calculations.ts` | 57 |
| `SetupScreen` | `src/screens/SetupScreen.tsx` | 54 |

There are still parallel local/collaborative persistence paths, duplicated browser/native storage concerns, and multiple migration/identity layers. These make it easy for Firestore rules and client assumptions to drift.

### L-03 — Bundle and operational hygiene

The production build now completes, but emits a JavaScript chunk around 1.35 MB after minification. The dependency set includes OCR, PDF, animation, Firebase, and AI packages in the client. Use code splitting and inspect the final bundle before release. Add CI for clean-clone lint/build/rules tests and server startup/health checks.

## What the AI Studio patch fixed

- Removed the Gemini key from the Vite client configuration and moved calls behind a server endpoint.
- Added fixed-width numeric deep-link validation (now 12 digits).
- Added a shared 10 MB `File` limit and consolidated transfer-key formatting.
- Added field-level protection for `createdBy` and `members` on ordinary trip updates.
- Enforced pending-only settlement creation in the current rules/tests.
- Exported the previously missing symbols that caused earlier TypeScript errors.
- Added some negative Firestore tests.

These changes reduce risk but do not close the open findings above.

## Priority remediation plan

1. Remove the unconditional Firestore `get` branch and add real outsider read/list tests.
2. Protect `/api/categorize-expense` with Firebase-token auth, rate limits, quotas, timeouts, and strict schemas.
3. Remove the sync fallback and choose one canonical expense model.
4. Replace Android `external-path path="."` with an app-private export/cache path.
5. Fix the missing Firebase config using a clean-clone-safe build strategy.
6. Validate nested Firestore schemas and separate member operations from generic trip updates.
7. Clear/redact local persistence and production logs; add retention limits.
8. Add CI gates for `npm run lint`, `npm run build`, unit tests, Firestore rules tests, and server health.

## Verification after remediation

- `npm run lint` — passed.
- `npm run build` — passed; Vite still reports a large client chunk warning.
- `npm test` — passed, 26 property tests.
- `npm run test:rules` — passed, including outsider document/query denial tests.
- `git diff --check` — passed.

The remaining `Open` and `Partially fixed` statuses above are intentional residual risks, not unverified claims of completion.

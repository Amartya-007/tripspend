# Requirements Document

## Introduction

The Member Management feature redesigns how TripSpend tracks participants in a trip. Currently, participants are stored as plain strings in `TripSetup.participants[]`, and all expense/settlement logic references them by name. This creates fragility: renaming a member breaks historical references, duplicate names cause logic errors, and there is no stable identity across collaborative sessions.

This feature introduces stable `memberId`-based identity for all participants, a soft-delete strategy for member removal, clear rules for name-based disambiguation, and safe behavior for all edge cases involving expenses, settlements, and offline/online sync.

The feature must work in both solo (offline/local) mode and collaborative (Firebase/Firestore) mode within the existing React + TypeScript stack.

---

## Glossary

- **Member**: A participant in a trip, identified by a stable `memberId` (UUID), with a mutable display `name`.
- **MemberRecord**: The data object `{ memberId: string, name: string, isActive: boolean, joinedAt: string, leftAt?: string, color?: string }` stored per trip.
- **MemberRegistry**: The authoritative map of `memberId → MemberRecord` for a trip, stored in `TripSetup.memberRegistry`.
- **identityMap**: The existing Firestore field mapping Firebase `uid → memberId` (updated from `uid → name`). Used only in collaborative mode.
- **Soft Delete**: Marking a member as `isActive: false` without removing their `MemberRecord` or any associated financial data.
- **Hard Delete**: Permanently removing a `MemberRecord`. Not permitted once a member has any expense or settlement association.
- **Active Member**: A `MemberRecord` where `isActive === true`.
- **Inactive Member**: A `MemberRecord` where `isActive === false` (has left or been removed).
- **Claimed Member**: A member whose `memberId` is referenced in `identityMap` by at least one Firebase `uid`.
- **Unclaimed Member**: A member with no `uid` mapping in `identityMap` (offline-only or not yet claimed).
- **Disambiguation Label**: A UI suffix (e.g., `#2`, avatar color, or join-date hint) shown when two members share the same display name.
- **Settlement Transfer**: An existing `{ from: memberId, to: memberId, amount: number }` record (migrated from name-based).
- **Pending Settlement**: A settlement transfer with `status: 'pending'` — no action taken by either party yet.
- **Paid Settlement**: A settlement transfer with `status: 'paid'` — sender has marked payment sent, awaiting receiver confirmation.
- **Completed Settlement**: A settlement transfer with `status: 'completed'` — receiver has confirmed receipt. This is the terminal state.
- **Settlement State Machine**: The valid transitions are `pending → paid` (sender acts) → `completed` (receiver acts). Reopen is `completed → pending` (receiver acts). The state `paid` is never a valid initial state for a new record.
- **TripSetup**: The existing trip configuration object, extended to include `memberRegistry`.
- **MemberManager**: The UI component and associated logic responsible for add/rename/remove operations.
- **OfflineQueue**: A local-first queue of member mutations applied when the device is offline, flushed on reconnect.
- **ConflictResolver**: The logic that merges concurrent member edits from multiple collaborators.

---

## Requirements

### Requirement 1: Stable Member Identity

**User Story:** As a trip organizer, I want each member to have a stable internal ID, so that renaming a member or having duplicate names never corrupts expense or settlement history.

#### Acceptance Criteria

1. THE MemberRegistry SHALL assign a UUID `memberId` to each member at creation time that never changes for the lifetime of the trip.
2. THE MemberRegistry SHALL store each member as `{ memberId, name, isActive, joinedAt, leftAt?, color? }`.
3. WHEN a member's `name` is updated, THE MemberRegistry SHALL preserve all existing expense and settlement references by `memberId` without modification.
4. THE MemberManager SHALL never use `name` as a lookup key for expense, settlement, or identity logic.
5. THE MemberRegistry SHALL allow two or more members to share the same `name` value without causing data integrity errors.
6. WHEN two members share the same `name`, THE MemberManager SHALL assign each a unique `memberId` and THE UI SHALL display a disambiguation label (color badge, avatar initial with suffix, or join-order indicator) to distinguish them.
7. THE MemberRegistry SHALL be stored in `TripSetup.memberRegistry` as a `Record<string, MemberRecord>` keyed by `memberId`.

---

### Requirement 2: Add Member

**User Story:** As a trip organizer, I want to add new members to a trip, so that expenses and settlements can be tracked for all participants.

#### Acceptance Criteria

1. WHEN a valid name is submitted, THE MemberManager SHALL create a new `MemberRecord` with a generated UUID `memberId`, `isActive: true`, and the current timestamp as `joinedAt`.
2. THE MemberManager SHALL accept names between 1 and 50 characters after trimming whitespace.
3. IF a submitted name is empty or exceeds 50 characters after trimming, THEN THE MemberManager SHALL reject the input and display a descriptive validation error.
4. THE MemberManager SHALL permit adding a member whose name is identical to an existing active member's name.
5. WHEN a member is added in collaborative mode, THE MemberManager SHALL write the new `MemberRecord` to Firestore and all collaborators SHALL receive the update within the real-time listener cycle.
6. WHEN a member is added in offline mode, THE MemberManager SHALL persist the new `MemberRecord` to local storage and add the operation to the OfflineQueue for later sync.

---

### Requirement 3: Rename Member

**User Story:** As a trip organizer, I want to rename a member, so that display names stay accurate without affecting any financial history.

#### Acceptance Criteria

1. WHEN a rename is submitted for a member, THE MemberManager SHALL update only the `name` field of that member's `MemberRecord`, leaving `memberId`, `isActive`, `joinedAt`, and all financial references unchanged.
2. THE MemberManager SHALL apply the same length and whitespace validation rules as member creation (1–50 characters after trim).
3. IF a rename targets a Claimed Member in collaborative mode, THEN THE MemberManager SHALL require that the renaming user is either the trip creator or the uid mapped to that `memberId` in `identityMap`.
4. WHEN a member is renamed, THE UI SHALL immediately reflect the new name in all views (expense list, settlement screen, analytics, member list) without requiring a page reload.
5. WHEN a member is renamed in collaborative mode, THE MemberManager SHALL propagate the name change to Firestore and all collaborators SHALL see the updated name within the real-time listener cycle.
6. WHEN a member is renamed in offline mode, THE MemberManager SHALL persist the rename to local storage and queue the operation for sync.

---

### Requirement 4: Remove Member (Soft Delete)

**User Story:** As a trip organizer, I want to remove a member from a trip, so that they no longer appear in active participant lists, while preserving all financial history.

#### Acceptance Criteria

1. WHEN a member is removed, THE MemberManager SHALL set `isActive: false` and record the current timestamp as `leftAt` on the `MemberRecord` — it SHALL NOT delete the record.
2. THE MemberManager SHALL retain all expense and settlement records that reference the removed member's `memberId`.
3. WHEN a member with a non-zero balance is removed, THE MemberManager SHALL display a warning showing the member's outstanding balance before confirming removal.
4. WHEN a member with pending settlement transfers is removed, THE MemberManager SHALL display the count and total amount of pending transfers before confirming removal.
5. IF a member is the sole participant in one or more expenses, THEN THE MemberManager SHALL warn the organizer that those expenses will remain linked to the inactive member — the expenses SHALL NOT be unassigned or modified; the member's `memberId` reference in those expenses SHALL be preserved exactly as-is so financial totals remain accurate.
6. THE MemberManager SHALL prevent removing the last remaining active member of a trip.
7. WHEN a Claimed Member is removed in collaborative mode, THE MemberManager SHALL require that the removing user is either the trip creator or the uid mapped to that `memberId` in `identityMap`.
8. WHEN a member is removed in collaborative mode, THE MemberManager SHALL write the `isActive: false` update to Firestore and all collaborators SHALL receive the update within the real-time listener cycle.

---

### Requirement 5: Member Recovery (Undo / Rejoin)

**User Story:** As a trip organizer, I want to recover an accidentally removed member or allow a previously removed member to rejoin, so that no data is permanently lost by mistake.

#### Acceptance Criteria

1. WHEN a member has been soft-deleted (`isActive: false`), THE MemberManager SHALL provide a restore action that sets `isActive: true` and clears `leftAt`.
2. WHEN a member is restored, THE MemberManager SHALL reinstate all their historical expense and settlement references without modification, because `memberId` references were never removed.
3. WHEN a previously removed member rejoins a collaborative trip, THE MemberManager SHALL reuse the existing `MemberRecord` and `memberId` rather than creating a new record.
4. IF a user attempts to rejoin a collaborative trip and their `uid` was previously mapped in `identityMap` to an inactive `memberId`, THEN THE MemberManager SHALL restore that member's `isActive` status and re-establish the identity mapping.

---

### Requirement 6: Settlement Behavior When a Member Leaves

**User Story:** As a trip participant, I want financial data to remain accurate and visible when a member leaves, so that outstanding debts are never silently lost or auto-settled.

#### Acceptance Criteria

1. WHEN a member with a non-zero balance leaves, THE Settlement module SHALL continue to display that member's balance and any associated pending transfers.
2. THE Settlement module SHALL never auto-settle or zero out a pending transfer because one of the parties has `isActive: false`.
3. WHEN the sender of a pending transfer has `isActive: false`, THE Settlement module SHALL allow the trip creator to mark that transfer as paid on behalf of the inactive sender — the trip creator SHALL be treated as a fallback authorized actor for the sender role.
4. WHEN the receiver of a pending transfer has `isActive: false`, THE Settlement module SHALL allow the trip creator to confirm receipt on behalf of the inactive receiver — the trip creator SHALL be treated as a fallback authorized actor for the receiver role.
5. TO enable Firestore rules to check member active status without iterating nested maps, EACH settlement document SHALL include denormalized boolean fields `fromMemberActive` and `toMemberActive` that are written by the client when creating or updating the settlement record and reflect the current `isActive` value of the respective members from `memberRegistry`.
6. THE Firestore security rules SHALL use `resource.data.fromMemberActive` and `resource.data.toMemberActive` directly to determine creator fallback eligibility — this avoids the need to read or iterate `memberRegistry` inside rules.
7. WHEN a member's `isActive` status changes, THE MemberManager SHALL update `fromMemberActive` / `toMemberActive` on all settlement documents that reference that member's `memberId`.
8. WHEN all transfers involving an inactive member reach `status: 'completed'`, THE Settlement module SHALL display the inactive member's balance as zero and mark their settlement as fully resolved.
9. THE Settlement module SHALL display inactive members with a visual indicator (e.g., greyed-out name, "left" badge) in the balances and transfers list.

---

### Requirement 7: Identity Mapping (uid → memberId)

**User Story:** As a collaborative trip participant, I want my Firebase account to be linked to my member record by ID, so that the app correctly identifies which actions belong to me regardless of my display name.

#### Acceptance Criteria

1. THE identityMap SHALL store mappings as `uid → memberId` (replacing the current `uid → name` mapping) in the Firestore trip document.
2. WHEN a user claims a participant slot, THE MemberManager SHALL write `identityMap[uid] = memberId` to Firestore.
3. THE MemberManager SHALL prevent a single `uid` from being mapped to more than one `memberId` within the same trip — the client SHALL check for an existing mapping before writing, and SHALL use a Firestore transaction to make the claim atomic; Firestore rules SHALL additionally reject any write to `identityMap[uid]` if that `uid` key already exists in the map.
4. THE MemberManager SHALL prevent a single `memberId` from being claimed by more than one `uid` within the same trip — because Firestore rules cannot efficiently scan an entire map for a value, the client SHALL use a Firestore transaction that reads the current `identityMap`, verifies no existing key maps to the requested `memberId`, and only then writes the new mapping atomically. Firestore rules SHALL enforce that the writing `uid` does not already have a mapping (1-uid-to-1-memberId in the forward direction).
5. IF a user's `uid` is not present in `identityMap`, THEN THE Settlement module SHALL treat that user as an observer with no send/receive permissions for that trip.
6. IF a user's `uid` maps to an inactive `memberId`, THEN THE MemberManager SHALL prompt the user to restore their membership or select a different unclaimed member slot.
7. WHEN a user's identity is resolved, THE Settlement module SHALL use `memberId` (not `name`) to determine `isSender` and `isReceiver` for all transfer permission checks.
8. THE Settlement module SHALL validate that the `fromUserId` on a settlement record matches the `uid` that maps to the transfer's `from` memberId in `identityMap` — a mismatch SHALL be treated as an unauthorized action and rejected.

---

### Requirement 8: Permissions in Collaborative Mode

**User Story:** As a trip creator, I want to control who can rename or remove members, so that collaborative trips remain consistent and no participant can unilaterally alter another's identity.

#### Acceptance Criteria

1. THE MemberManager SHALL allow any active trip member to add new members.
2. THE MemberManager SHALL allow a member to rename only their own claimed slot, unless the acting user is the trip creator.
3. THE MemberManager SHALL allow a member to remove (soft-delete) only their own claimed slot, unless the acting user is the trip creator.
4. THE MemberManager SHALL allow the trip creator to rename or remove any member.
5. IF a non-creator user attempts to rename or remove a member they do not own, THEN THE MemberManager SHALL reject the operation and display a permission error.
6. THE Firestore security rules SHALL enforce the same permission boundaries server-side, rejecting unauthorized writes to `memberRegistry` and `identityMap`.

---

### Requirement 9: Duplicate Name Disambiguation

**User Story:** As a trip participant, I want the UI to clearly distinguish between members who share the same name, so that I never assign an expense or settlement to the wrong person.

#### Acceptance Criteria

1. WHEN two or more active members share the same `name`, THE UI SHALL display a disambiguation label alongside each duplicate name in all member-selection dropdowns, expense forms, and settlement views.
2. THE disambiguation label SHALL be derived from a stable, non-name attribute: the member's assigned color, avatar initial with join-order suffix (e.g., "Alex #1", "Alex #2"), or both.
3. THE MemberManager SHALL never use `name` alone as a unique key in any dropdown, list, or form — it SHALL always pair the display name with `memberId` as the value.
4. WHEN a member is renamed such that their new name no longer duplicates any other active member, THE UI SHALL remove the disambiguation label for that member.
5. THE disambiguation label SHALL be consistent across all screens (expense entry, settlement, analytics, member list) within a single session.

---

### Requirement 10: Offline Mode and Sync

**User Story:** As a solo user or a user with intermittent connectivity, I want member changes made offline to sync correctly when I reconnect, so that no edits are lost or silently overwritten.

#### Acceptance Criteria

1. WHEN the device is offline, THE MemberManager SHALL apply member add, rename, and remove operations to local state and persist them to the OfflineQueue in local storage.
2. WHEN connectivity is restored, THE MemberManager SHALL flush the OfflineQueue to Firestore in the order operations were recorded.
3. WHEN two collaborators make conflicting renames to the same `memberId` while offline, THE ConflictResolver SHALL apply a last-write-wins strategy based on the operation's local timestamp, and THE UI SHALL display a non-blocking notification (e.g., "Rahul's name was updated by another member") so the user is aware their local edit was overridden.
4. WHEN two collaborators concurrently add members with the same name, THE ConflictResolver SHALL retain both records as distinct `MemberRecord` entries with separate `memberId` values.
5. WHILE in solo (local-only) mode with no Firebase connection, THE MemberManager SHALL operate entirely on local storage with no Firestore dependency.
6. WHEN a solo-mode trip is later shared (converted to collaborative), THE MemberManager SHALL migrate all existing name-based participant strings to `MemberRecord` entries, generating stable `memberId` values for each.
7. WHEN a sync conflict is resolved automatically (last-write-wins), THE UI SHALL show the winning value and the name of the member who made the winning change, giving the user enough context to manually correct it if needed.

---

### Requirement 12: Firestore Security Rule Enforcement for Settlements

**User Story:** As a system, I want Firestore security rules to enforce settlement state transitions correctly for all member states, so that no client-side bypass can corrupt financial data.

#### Acceptance Criteria

1. THE Firestore settlement rules SHALL define three distinct authorized actors for state transitions:
   - **Sender actor**: the `uid` whose `identityMap` entry maps to the transfer's `from` memberId.
   - **Receiver actor**: the `uid` whose `identityMap` entry maps to the transfer's `to` memberId.
   - **Creator fallback**: the trip's `createdBy` uid, authorized to act as either sender or receiver ONLY when the corresponding member is inactive, as indicated by `fromMemberActive: false` or `toMemberActive: false` on the settlement document itself.

2. THE Firestore rules SHALL read `fromMemberActive` and `toMemberActive` directly from the settlement document (not from `memberRegistry`) to determine creator fallback eligibility — this is the only practical approach since Firestore rules cannot safely iterate nested map structures.

3. THE Firestore rules SHALL enforce that `fromMemberActive` and `toMemberActive` can only change value when the settlement `status` field is also changing in the same write — arbitrary flipping of these flags without a status transition SHALL be rejected. Specifically: if `status` is unchanged, then `fromMemberActive` and `toMemberActive` must equal their previous values.

4. A settlement `create` operation SHALL only be permitted with `status: 'pending'` and `creatorOverride: false` — creating a record directly in `paid` or `completed` state SHALL be rejected. The `pending → paid` transition is the only valid first action after creation.

5. THE Firestore rules SHALL enforce a strict 7-path transition model. Each path checks BOTH `resource.data.status` (current state) AND `request.resource.data.status` (new state). The permitted paths are:
   - **Path 1 — Sender marks paid** (`pending → paid`): sender actor, `toUserId` remains null, `creatorOverride` must be false.
   - **Path 2 — Sender retracts** (`paid → pending`): sender actor, `toUserId` still null (receiver has not yet acted), `creatorOverride` must be false.
   - **Path 3 — Receiver first-time confirm** (`paid → completed`): receiver actor sets their `uid` as `toUserId` (was null), `creatorOverride` must be false.
   - **Path 4 — Receiver reopen** (`completed → pending`): receiver actor, `creatorOverride` must be false.
   - **Path 5 — Creator fallback: mark paid** (`pending → paid`): creator fallback, `fromMemberActive == false`, `creatorOverride` must be true.
   - **Path 6 — Creator fallback: confirm** (`paid → completed`): creator fallback, `toMemberActive == false`, `creatorOverride` must be true.
   - **Path 7 — Creator fallback: reopen** (`completed → pending`): creator fallback, `toMemberActive == false`, `creatorOverride` must be true.

6. ANY write that attempts a transition not covered by the 7 paths above SHALL be rejected. The following transitions are explicitly forbidden and have no valid path: `pending → completed`, `paid → pending` by receiver, `completed → paid` by anyone.

7. THE `creatorOverride` field SHALL only be settable to `true` by the trip creator (`createdBy == uid()`). All non-creator paths SHALL require `creatorOverride == false` in the incoming write — a non-creator cannot set `creatorOverride: true` because they will fail the creator identity check.

8. THE Firestore rules SHALL reject any settlement `create` where `fromUserId` does not equal `uid()` — a user cannot open a settlement record on behalf of another sender.

9. THE Firestore rules SHALL reject any `identityMap` write where the writing `uid` already has an existing key in `identityMap` — enforcing the 1-uid-to-1-memberId forward constraint at the database level. The reverse constraint (1-memberId-to-1-uid) SHALL be enforced by the client transaction described in Requirement 7 AC4.

10. THE settlement status field SHALL only accept values from the set `['pending', 'paid', 'completed']` — any write with an unlisted status value SHALL be rejected.

11. WHEN the trip creator acts as a fallback, THE settlement document SHALL record `creatorOverride: true` and a `creatorOverrideAt` timestamp so that the action is auditable. THE UI SHALL display a note (e.g., "Confirmed by trip creator") on settlements where `creatorOverride: true`.

### Requirement 11: Migration from Name-Based to ID-Based Model

**User Story:** As an existing TripSpend user, I want my current trip data to be automatically migrated to the new member ID model, so that I don't lose any historical expenses or settlements.

#### Acceptance Criteria

1. WHEN the app loads a trip that uses the legacy `participants: string[]` format, THE MemberManager SHALL automatically generate a `MemberRecord` for each participant string, assigning a freshly generated UUID as `memberId` — it SHALL NOT derive `memberId` from the participant's name or any other content-based hash, because duplicate names would produce collisions.
2. THE MemberManager SHALL store the `name → memberId` mapping produced during migration in the `memberRegistry` immediately, so that subsequent migration runs can look up the existing `memberId` by name rather than generating a new one — making the migration idempotent.
3. WHEN migrating legacy data, THE MemberManager SHALL update all expense `paidBy` and `participants` fields to reference the `memberId` values established in step 1.
4. WHEN migrating legacy data, THE MemberManager SHALL update all settlement `from` and `to` fields to reference the same `memberId` values.
5. THE migration SHALL be idempotent: if `memberRegistry` already exists and contains a record for a given name, THE MemberManager SHALL reuse the existing `memberId` rather than generating a new one.
6. WHEN migration is complete, THE MemberManager SHALL write the `memberRegistry` to the trip document and remove the legacy `participants` array.
7. IF migration fails for any reason, THEN THE MemberManager SHALL roll back all changes and preserve the original `participants` array, logging the error for diagnostics.

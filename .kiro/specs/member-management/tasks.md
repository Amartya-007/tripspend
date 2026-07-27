# Implementation Plan: Member Management

## Overview

Migrate TripSpend from a fragile name-string participant model to a stable UUID-based `MemberRecord` identity system. The implementation follows a strict dependency order: types → pure utilities → hooks → data layer updates → UI updates → integration wiring.

## Tasks

- [x] 1. Define core data model types
  - Add `MemberRecord` and `MemberRegistry` types to `src/utils/calculations.ts`
  - Extend `TripSetup` with optional `memberRegistry?: MemberRegistry` (keep `participants?` for migration detection)
  - Update `Expense` JSDoc to note `paidBy` and `participants[]` will store `memberId` after migration
  - Update `SettlementTransfer` to note `from`/`to` will store `memberId` after migration
  - _Requirements: 1.1, 1.2, 1.7_

- [x] 2. Implement `migrateLegacyParticipants` pure utility
  - [x] 2.1 Create `src/utils/migration.ts` with `migrateLegacyParticipants(data: TripData): TripData`
    - Check for existing `memberRegistry` → return data unchanged (idempotency)
    - Build index-based `name → MemberRecord` map from `participants[]`, generating a UUID per entry (duplicates get distinct UUIDs)
    - Rewrite all `expense.paidBy` and `expense.participants[]` to `memberId` values
    - Remove `participants[]` from `setup`, set `setup.memberRegistry`
    - Catch any exception, log it, and return original data unchanged (rollback guarantee)
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7_

  - [x] 2.2 Write property test: migration produces one registry entry per participant (Property 19)
    - **Property 19: Migration produces one registry entry per participant**
    - **Validates: Requirements 11.1**

  - [x] 2.3 Write property test: migration is idempotent (Property 20)
    - **Property 20: Migration is idempotent**
    - **Validates: Requirements 11.2, 11.5**

  - [x] 2.4 Write property test: migration reference validity (Property 21)
    - **Property 21: Migration reference validity — all expense/settlement references are valid memberIds**
    - **Validates: Requirements 11.3, 11.4**

  - [x] 2.5 Write property test: migration removes legacy participants array (Property 22)
    - **Property 22: Migration removes legacy participants array**
    - **Validates: Requirements 11.6**

  - [x] 2.6 Write property test: migration failure preserves original data (Property 23)
    - **Property 23: Migration failure preserves original data**
    - **Validates: Requirements 11.7**

- [x] 3. Implement `memberDisplay` utility
  - [x] 3.1 Create `src/utils/memberDisplay.ts` with `getDisplayName` and `buildDisplayNameMap`
    - `getDisplayName(memberId, registry, includeInactive?)`: returns `name` when unique among active members, `"name #N"` (1-indexed by `joinedAt` ascending) when duplicated
    - `buildDisplayNameMap(registry, includeInactive?)`: runs `getDisplayName` for all members and returns `Record<memberId, displayName>`
    - _Requirements: 1.6, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 3.2 Write property test: disambiguation labels are stable and distinct (Property 17)
    - **Property 17: Disambiguation labels are stable and distinct**
    - **Validates: Requirements 1.6, 9.1, 9.2, 9.5**

  - [x] 3.3 Write property test: disambiguation label removed after rename makes name unique (Property 18)
    - **Property 18: Disambiguation label removed after rename makes name unique**
    - **Validates: Requirements 9.4**

- [x] 4. Implement `offlineQueue` utility
  - Create `src/utils/offlineQueue.ts` with `enqueueOp`, `dequeueAll`, and `clearQueue`
  - Store queue per `tripId` in `localStorage` as a JSON array of `MemberOp` objects
  - `dequeueAll` returns ops sorted by `timestamp` ascending and clears the queue
  - _Requirements: 10.1, 10.2_

  - [x] 4.1 Write property test: offline queue flush preserves operation order (Property 24)
    - **Property 24: Offline queue flush preserves operation order**
    - **Validates: Requirements 10.2**

- [x] 5. Implement `useMemberRegistry` hook
  - [x] 5.1 Create `src/hooks/useMemberRegistry.ts` implementing `addMember`, `renameMember`, `removeMember`, `restoreMember`
    - `addMember`: generate UUID, create `MemberRecord` with `isActive: true` and `joinedAt: now`, call `saveSetup`
    - `renameMember`: validate 1–50 chars after trim, check `canRename` permission, update only `name` field
    - `removeMember`: check `canRemove` (blocks last active member), set `isActive: false` and `leftAt: now`
    - `restoreMember`: set `isActive: true`, clear `leftAt`
    - Expose `members`, `activeMembers`, `registry`, `getDisplayName`, `getMemberById`, `canRename`, `canRemove`, `isMigrated`
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.6, 5.1, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.2 Write property test: member ID stability through mutations (Property 1)
    - **Property 1: Member ID stability through mutations**
    - **Validates: Requirements 1.1, 1.3, 3.1**

  - [x] 5.3 Write property test: new member record shape (Property 2)
    - **Property 2: New member record shape**
    - **Validates: Requirements 1.2, 2.1**

  - [x] 5.4 Write property test: duplicate names produce distinct member IDs (Property 3)
    - **Property 3: Duplicate names produce distinct member IDs**
    - **Validates: Requirements 1.5, 2.4**

  - [x] 5.5 Write property test: rename preserves all fields except name (Property 4)
    - **Property 4: Rename preserves all fields except name**
    - **Validates: Requirements 1.3, 3.1**

  - [x] 5.6 Write property test: member lifecycle operations never modify expenses (Property 5)
    - **Property 5: Member lifecycle operations never modify expenses**
    - **Validates: Requirements 4.2, 5.2**

  - [x] 5.7 Write property test: name validation boundary (Property 6)
    - **Property 6: Name validation boundary**
    - **Validates: Requirements 2.2, 2.3, 3.2**

  - [x] 5.8 Write property test: soft-delete sets isActive false and records leftAt (Property 7)
    - **Property 7: Soft-delete sets isActive false and records leftAt**
    - **Validates: Requirements 4.1**

  - [x] 5.9 Write property test: last active member cannot be removed (Property 8)
    - **Property 8: Last active member cannot be removed**
    - **Validates: Requirements 4.6**

  - [x] 5.10 Write property test: remove-then-restore round trip (Property 9)
    - **Property 9: Remove-then-restore round trip**
    - **Validates: Requirements 5.1, 5.3**

  - [x] 5.11 Write property test: rename permission — non-owner non-creator is rejected (Property 12)
    - **Property 12: Rename permission — non-owner non-creator is rejected**
    - **Validates: Requirements 3.3, 4.7, 8.2, 8.3, 8.5**

  - [x] 5.12 Write property test: last-write-wins conflict resolution (Property 25)
    - **Property 25: Last-write-wins conflict resolution**
    - **Validates: Requirements 10.3**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update `useTripData` to trigger migration on load
  - In the IndexedDB hydration effect and the initial `useState` for `trips`, call `migrateLegacyParticipants` on each trip's data when `setup.participants` exists and `setup.memberRegistry` is absent
  - Persist the migrated data back to IndexedDB/localStorage immediately after migration
  - _Requirements: 11.1, 11.2, 11.5, 11.6_

- [x] 8. Update `useCollaborativeTripData` for `memberId`-based identity
  - [x] 8.1 Replace `claimParticipantIdentity` with `claimMemberIdentity(tripId, memberId)` using a Firestore transaction that enforces forward uniqueness (uid not already mapped) and reverse uniqueness (memberId not already claimed)
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 8.2 Derive `myMemberId` from `identityMap[userUid]` (replaces `myParticipantName`)
    - _Requirements: 7.1, 7.7_

  - [x] 8.3 In the Firestore snapshot handler, call `migrateLegacyParticipants` on trip data when `participants[]` exists and `memberRegistry` is absent, then write the migrated `setup` back to Firestore
    - _Requirements: 11.1, 11.5_

  - [x] 8.4 Write property test: identity map forward uniqueness (Property 13)
    - **Property 13: Identity map forward uniqueness**
    - **Validates: Requirements 7.3**

  - [x] 8.5 Write property test: identity map reverse uniqueness (Property 14)
    - **Property 14: Identity map reverse uniqueness**
    - **Validates: Requirements 7.4**

- [x] 9. Update `Settlement.tsx` for `memberId`-based identity
  - [x] 9.1 Replace `identitySet` / `myParticipantName` with `myMemberId = identityMap[userUid]`; update `isSender(from)` to `myMemberId === from` and `isReceiver(to)` to `myMemberId === to` (or `true` in non-collaborative mode)
    - _Requirements: 7.5, 7.7, 7.8_

  - [x] 9.2 Add `displayNames` map via `buildDisplayNameMap(data.setup?.memberRegistry ?? {}, true)` and replace all raw `transfer.from` / `transfer.to` / `person` renders with `displayNames[id] ?? id`
    - _Requirements: 9.1, 9.5_

  - [x] 9.3 Add inactive member visual indicator: grey out name and append "left" badge when `registry[memberId]?.isActive === false` in the balances list and transfer rows
    - _Requirements: 6.9_

  - [x] 9.4 Add creator fallback UI: when `isCreator && fromMemberActive === false`, show "Mark paid (on behalf)" button for pending transfers; when `isCreator && toMemberActive === false`, show "Confirm (on behalf)" button for paid transfers; set `creatorOverride: true` and `creatorOverrideAt` on those writes; display "Confirmed by trip creator" note on settlements where `creatorOverride === true`
    - _Requirements: 6.3, 6.4, 12.5, 12.11_

  - [x] 9.5 Include `fromMemberActive` and `toMemberActive` boolean fields (read from `memberRegistry`) when creating or updating settlement documents in Firestore
    - _Requirements: 6.5, 6.6_

  - [x] 9.6 Write property test: inactive members remain visible in settlement calculation (Property 10)
    - **Property 10: Inactive members remain visible in settlement calculation**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 9.7 Write property test: settlement documents include active-flag fields (Property 11)
    - **Property 11: Settlement documents include active-flag fields**
    - **Validates: Requirements 6.5**

  - [x] 9.8 Write property test: observer has no send/receive permissions (Property 15)
    - **Property 15: Observer has no send/receive permissions**
    - **Validates: Requirements 7.5**

  - [x] 9.9 Write property test: memberId-based identity distinguishes same-name members (Property 16)
    - **Property 16: memberId-based identity distinguishes same-name members**
    - **Validates: Requirements 7.7**

- [x] 10. Redesign `GroupMemberManager.tsx`
  - [x] 10.1 Rewrite component to accept updated props: `setup`, `onUpdate`, `isCollaborative`, `userUid`, `tripCreatorUid`, `identityMap`; remove legacy `claimedNames` prop
    - _Requirements: 8.1_

  - [x] 10.2 Render active members section: each row shows `getDisplayName` label, a lock icon for claimed members, rename (inline edit) and soft-delete buttons gated by `canRename`/`canRemove`
    - _Requirements: 1.6, 3.1, 4.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3_

  - [x] 10.3 Render collapsible inactive members section with a "Restore" button per member; show "left" badge and `leftAt` date
    - _Requirements: 5.1, 6.9_

  - [x] 10.4 Show balance warning dialog before confirming soft-delete: call `calculateSettlement` and display outstanding balance and pending transfer count if non-zero
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 10.5 In collaborative mode, after `removeMember`, batch-update `fromMemberActive`/`toMemberActive` on all open settlement documents referencing the removed `memberId` (Path 0 writes, chunked at 100 ops)
    - _Requirements: 6.7, 12.1, 12.2, 12.3_

  - [x] 10.6 Add member input: write new `MemberRecord` to `memberRegistry` via `useMemberRegistry.addMember`; in offline mode enqueue the op via `offlineQueue`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.1_

- [x] 11. Update `AddExpense.tsx` to use `memberId` values
  - Replace `getTripPeople(setup)` with `activeMembers` from `useMemberRegistry` (passed as prop or derived from `setup.memberRegistry`)
  - Pass `memberId` values (not display names) as `paidBy` and `participants[]` when constructing the `Expense` object
  - Update `PaidBySelect` and `SplitSelect` to display `getDisplayName(memberId)` labels while using `memberId` as the option value
  - _Requirements: 1.4, 9.3_

- [x] 12. Update `Analytics.tsx` to display names via `buildDisplayNameMap`
  - Derive `displayNames = buildDisplayNameMap(data.setup?.memberRegistry ?? {})` and replace all raw `p.name` / `exp.paidBy` renders with `displayNames[id] ?? id`
  - Update `personStats` computation to key by `memberId` (from `activeMembers`) rather than name strings from `getTripPeople`
  - _Requirements: 9.1, 9.5_

- [x] 13. Update `calculateSettlement` in `calculations.ts` to work with `memberId` keys
  - Replace `getTripPeople(setup)` with `Object.keys(setup.memberRegistry ?? {})` filtered to active members when `memberRegistry` is present; fall back to `getTripPeople` for legacy data
  - Ensure `balances` and `transfers` are keyed by `memberId` when registry is present
  - _Requirements: 6.1, 6.2, 11.3, 11.4_

- [x] 14. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Wire `useMemberRegistry` into `App.tsx` and update component props
  - Instantiate `useMemberRegistry` in `App.tsx` (or the appropriate layout component) using `saveSetup` from the active hook (`useTripData` or `useCollaborativeTripData`)
  - Pass updated props to `Settlement`: add `identityMap`, `tripCreatorUid`; remove `myParticipantName`
  - Pass updated props to `GroupMemberManager`: add `isCollaborative`, `userUid`, `tripCreatorUid`, `identityMap`; remove `claimedNames`
  - Pass `activeMembers` and `getDisplayName` (or `displayNames` map) down to `AddExpense` and `Analytics`
  - _Requirements: 2.5, 2.6, 7.1, 8.1_

- [x] 16. Verify Firestore rules logical structure
  - Confirm the `allow update` block in `firestore.rules` uses the correct nested grouping: `Path 0 || (active-flag-protection && (Path 1 || ... || Path 7))` — NOT `(Path 0 || active-flag-protection) (Path 1 || ...)` which would be two unconnected blocks
  - The active-flag protection must be `&&`-ed with the transition paths inside a single nested block so it only applies to transition writes, not as a standalone condition
  - Test with Firestore emulator: a write that satisfies only the active-flag condition but matches no transition path must be rejected
  - _Requirements: 12.3, 12.5_

- [x] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The migration is backward-compatible: trips without `memberRegistry` continue to work via the legacy `getTripPeople` fallback until migration runs
- Property tests validate universal correctness guarantees; unit tests validate specific examples and edge cases
- Checkpoints ensure incremental validation at natural break points

# Realtime Database Rules for TripSpend

This file contains a recommended, secure Realtime Database ruleset for TripSpend that supports:

- Personal backups (users/{uid}/trips/...)
- Collaborative shared trips (trips/{tripId})
- Invite codes / invite links (public_trips/{code}) that allow a user to join a trip by redeeming a code
- Member management: existing members may add/update/delete members and trip data
- Append-only immutable logs for auditing (logs cannot be updated or deleted once written)

Design notes (client responsibilities)

- When creating an invite the app should write an entry under `public_trips/{code}` with { tripId, createdBy, createdAt }
- To redeem an invite code, the client should write a member node under `trips/{tripId}/members/{uid}` with an object like:
  { addedAt: TIMESTAMP_MS, addedByInvite: "<code>" }
  The rules verify that `public_trips/<code>.tripId === tripId` and that auth.uid === uid
- Members are stored as objects at `trips/{tripId}/members/{uid}`. Existing members may add/remove other members.
- For auditing, the app must create log entries under `trips/{tripId}/logs/{logId}` with fields { ts, actor, action, details }. Rules enforce append-only behavior.

Rules JSON (paste into Firebase console → Realtime Database → Rules)

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "trips": {
          "$tripId": {
            "meta": {
              ".validate": "newData.hasChildren(['id','createdAt','updatedAtIso']) && newData.child('id').val() === $tripId && (!newData.child('createdBy').exists() || newData.child('createdBy').val() === auth.uid)"
            },
            "expenses": {
              "$expenseId": {
                ".write": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists()",
                ".validate": "newData.hasChildren(['id','amount','category','date','paidBy']) && newData.child('id').val() === $expenseId && newData.child('amount').isNumber() && newData.child('category').isString() && newData.child('date').isString() && newData.child('paidBy').isString()"
              }
            }
          }
        }
      }
    },

    "trips": {
      "$tripId": {
        "meta": {
          ".read": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists()",
          ".write": "auth != null && (
                // creation: only creator may create meta
                (!data.exists() && newData.child('createdBy').val() === auth.uid)
                ||
                // updates: only existing members may update meta
                (data.exists() && root.child('trips').child($tripId).child('members').child(auth.uid).exists())
              )",
          ".validate": "newData.hasChildren(['id','createdAt','updatedAtIso']) && newData.child('id').val() === $tripId"
        },

        // Members: members/$uid is an object with addedAt (number) and optional addedByInvite (string)
        "members": {
          "$memberUid": {
            ".read": "auth != null && (auth.uid === $memberUid || root.child('trips').child($tripId).child('members').child(auth.uid).exists())",
            ".write": "auth != null && (
                // existing member can add/update/delete members
                root.child('trips').child($tripId).child('members').child(auth.uid).exists()
                ||
                // a user may add themselves by redeeming an invite code: must include addedByInvite matching a public_trips entry
                (auth.uid === $memberUid && !data.exists() && newData.hasChild('addedByInvite') && root.child('public_trips').child(newData.child('addedByInvite').val()).child('tripId').val() === $tripId)
              )",
            ".validate": "newData.hasChild('addedAt') && newData.child('addedAt').isNumber()"
          }
        },

        // Expenses under shared trips. Only members may CRUD expenses.
        "expenses": {
          "$expenseId": {
            ".read": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists()",
            ".write": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists()",
            ".validate": "newData.hasChildren(['id','amount','category','date','paidBy']) && newData.child('id').val() === $expenseId && newData.child('amount').isNumber() && newData.child('category').isString() && newData.child('date').isString() && newData.child('paidBy').isString()"
          }
        },

        // Logs: append-only audit trail. Only members may append new log entries. No updates or deletes allowed.
        "logs": {
          "$logId": {
            ".read": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists()",
            ".write": "auth != null && root.child('trips').child($tripId).child('members').child(auth.uid).exists() && !data.exists() && newData.exists()",
            ".validate": "newData.hasChildren(['ts','actor','action']) && newData.child('ts').isNumber() && newData.child('actor').isString() && newData.child('action').isString()"
          }
        }
      }
    },

    // Public invites: mapping invite code -> tripId, createdBy, createdAt
    "public_trips": {
      "$code": {
        ".read": "true",
        ".write": "auth != null && ( !data.exists() ? newData.child('createdBy').val() === auth.uid : data.child('createdBy').val() === auth.uid )",
        ".validate": "newData.hasChildren(['tripId','createdBy','createdAt']) && newData.child('createdBy').isString() && newData.child('tripId').isString()"
      }
    }
  }
}
```

How the invite flow should work (client implementation notes)

- Trip creator creates a shared trip under `trips/{tripId}/meta` with `createdBy: auth.uid` and also writes `trips/{tripId}/members/{auth.uid}` with `{ addedAt: Date.now() }`.
- To create an invite, creator writes `public_trips/{code} = { tripId, createdBy: auth.uid, createdAt: Date.now() }`.
- To redeem an invite, the client (authenticated as the new user) writes `trips/{tripId}/members/{theirUid} = { addedAt: Date.now(), addedByInvite: '{code}' }`. The rules verify the code points to that trip.
- Once a user is a member, they may create/update/delete expenses and append log entries. Members may also add or remove other members (member management is permitted to existing members).

Audit log immutability

- Log entries are append-only: rules only allow creating a log child when it does not exist yet (`!data.exists() && newData.exists()`). Attempting to overwrite or delete a log entry will be rejected by the rules.
- Make sure the client always creates log entries with unique keys (e.g., push() IDs or a combined timestamp + random suffix) and includes `ts` (number), `actor` (user id or name), `action` (string), and optional `details` object.

Testing and deployment

- Paste the JSON into the Firebase console Rules editor and Publish.
- Use the Rules Playground to simulate:
  - Creator writes `trips/{tripId}/meta` and `public_trips/{code}` as auth.uid == creator
  - Non-member redeems by writing `trips/{tripId}/members/{theirUid}` including `addedByInvite`
  - A member adds an expense and a log entry
  - Attempt to delete or modify a log entry (should be rejected)

Caveats and edge cases

- The invite redemption requires the client to include `addedByInvite` on the new member node. This is a client-side convention enforced by rules; do not rely on client-only checks — rules verify the mapping in `public_trips`.
- If you want single-use invites, extend the flow: when redeeming, the client should write under `public_trips/{code}/redeemed/{theirUid}` and rules can restrict `public_trips/{code}` to be writable only by its creator unless already redeemed. Implementing single-use in rules alone is possible but requires careful race handling; server-side functions are more robust.
- For strict immutability of logs, ensure no client-side code tries to update or delete logs. If you need to support log corrections, implement a separate "log-annotations" path rather than mutating the original log entry.

Want me to commit this rules doc to the feat/realtime-db-migration branch and optionally add a JSON file realtime.rules.json to the repo? If yes, I'll commit the updated file now.
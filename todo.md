# TripSpend TODO Roadmap

Last reviewed: 2026-04-08

Status: [x] done, [~] partial, [ ] pending

## Core Enhancements (Existing)

### [ ] Add Recurring and Planned Expenses
- Let users set planned items (hotel per day, daily transport)
- Compare planned vs actual in real time

### [x] Add Trip Closing Report
- Generate PDF with totals, category breakdown, who paid, settlements
- Share via native share or download

### [x] Add Payment Proof in Settlements
- Screenshot upload and notes per settlement
- Persistent audit trail with timestamps

### [~] Add Split Modes per Expense
- [x] Equal split
- [x] Custom split (per participant)
- [ ] Percentage split
- [ ] Validation to ensure custom totals match

### [x] Add Member-Level Analytics
- Per person: total paid, share, net balance
- Top spender and most owed badges

### [x] Add Search and Filters in Expense List
- [x] Text search (notes, amount, tags)
- [x] Date range filter
- [x] Member filter
- [x] Category filter
- [x] Amount range (min/max)

### [ ] Add Cloud Sync and Restore
- Google sign-in
- Anonymous token backup
- Restore on new device

### [ ] Add Multi-Trip Support
- Create multiple trips
- Switch between trips
- Archive old trips

### [ ] Add Smart Reminders
- Daily expense reminders
- Pending settlement reminders

### [x] Add Onboarding and Empty-State Guidance
- 60-second onboarding carousel
- Actionable empty states with CTAs

---

## High Impact Additions (New)

### [x] Add Settlement History (Critical)
- From → To, amount, timestamp, notes, proof image
- Persistent audit trail in localStorage

### [x] Add Undo Settlement
- Undo button on settled transfers
- Confirmation dialog before marking settled

### [x] Add Debt Simplification (Core Logic Upgrade)
- Greedy algorithm minimizes number of transfers
- Debtor/creditor matching in calculateSettlement()

### [x] Add Balance Simplification Preview
- Net balances shown per person (to receive / to pay / even)
- Pending vs settled transfer counts

### [x] Add Per Person Net Summary
- Total paid, share, net balance per member
- Color-coded positive/negative indicators

### [x] Add Duplicate Expense Detection
- Same amount + same payer within 2 minutes → warning bottom sheet
- "Add Anyway" or "Cancel" options

### [ ] Add Quick Split Templates
- Save frequent split groups
- Reuse with one tap

### [x] Add Trip Summary Share Card
- Canvas-generated summary image
- Share via WhatsApp / native share

### [ ] Add Expense Edit History
- Track what changed and when
- Prevent disputes

### [x] Add Smart Category Suggestions (Local)
- Keyword map on note field
- "petrol/cab/uber" → Travel, "hotel/stay" → Stay, "food/lunch" → Food

### [x] Add Large Expense Alert
- Confirmation dialog when expense > daily budget per person
- Shows exact limit vs entered amount

### [x] Add Trip Timeline View
- Day-wise spending with D1/D2 labels
- Spike and low day badges
- Daily limit reference line

### [x] Add Budget Smart Alerts
- Overspend alert on Dashboard
- Projected deficit calculation
- Browser notification on overspend

### [ ] Add Dark Mode
- System-based theme
- Manual toggle

---

## Removed / Decided Against

### ~~Add Export to Excel / CSV~~
- JSON backup already covers data portability
- PDF closing report covers sharing use case

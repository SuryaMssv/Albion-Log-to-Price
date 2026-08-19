# Product Requirements Document
## Albion Guild Loot Valuation & Split Calculator

**Version:** 1.0  
**Date:** August 18, 2026  
**Status:** MVP Specification

---

## 1. Product Overview

### Product Name
**Albion Guild Loot Valuation & Split Calculator**

### Purpose
A lightweight web application for Albion Online guilds to paste or upload a guild chest log, calculate the current market value of all deposited items using Albion East market prices, and calculate an equal loot share for participating players.

### Primary Goal
Replace manual loot valuation with a simple workflow:

**Albion Chest Log → Parse Items → Fetch Current East Market Prices → Calculate Total Value → Divide by Participants → Show Individual Share**

The application does **not** need to automatically track who looted what.

---

## 2. Problem Statement

Guild gank groups often place loot into a common guild chest. Albion's chest log provides:

- Date
- Player
- Item
- Enchantment
- Quality
- Amount

However, the chest log itself does not provide a convenient current market valuation.

The guild needs a tool that can:

1. Read the chest log.
2. Correctly identify each Albion item, enchantment, and quality.
3. Retrieve current Albion East market prices.
4. Calculate the value of each item stack.
5. Calculate total loot value.
6. Divide the total equally among participants.
7. Produce a Discord-friendly result.

---

## 3. Target Users

### Primary Users
- Albion Online guild leaders
- Guild officers
- Loot managers
- Gank group organizers

### Typical Scenario
A 5–7 player gank group finishes a session.

1. Players deposit the loot into a designated guild chest.
2. An officer opens the chest log.
3. The officer copies the log.
4. The officer pastes/uploads it into the application.
5. The application calculates the current value.
6. The officer enters or selects the participants.
7. The application displays each player's share.

---

# 4. Input Specification

## 4.1 Supported Chest Log Format

The MVP must support Albion chest logs in the following CSV-like format:

```text
"Date" "Player" "Item" "Enchantment" "Quality" "Amount"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Fiend Cowl" "2" "4" "1"
"08/18/2026 11:49:51" "DemiG0Dz" "Adept's Bag" "1" "4" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Adept's Cape" "2" "3" "1"
"08/18/2026 11:49:50" "DemiG0Dz" "Journeyman's Riding Horse" "0" "1" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Dagger Pair" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Assassin Jacket" "2" "4" "1"
"08/18/2026 11:49:49" "DemiG0Dz" "Adept's Hellion Shoes" "2" "3" "1"
"08/18/2026 11:49:48" "DemiG0Dz" "Invisibility Potion" "0" "1" "2"
```

## 4.2 Required Fields

| Field | Required | Description |
|---|---|---|
| Date | Yes | Chest transaction timestamp |
| Player | Yes | Player associated with the transaction |
| Item | Yes | Albion displayed item name |
| Enchantment | Yes | Item enchantment level |
| Quality | Yes | Item quality level |
| Amount | Yes | Quantity moved |

## 4.3 Input Methods

MVP must support:

- Paste log text into a text area.
- Upload a `.txt` or `.csv` file.

Optional:

- Drag-and-drop file upload.
- Paste from clipboard button.

---

# 5. Functional Requirements

## FR-01 — Paste Chest Log

The user must be able to paste the copied Albion chest log into a text area.

### Acceptance Criteria
- Multi-line logs are supported.
- Quoted values are parsed correctly.
- Apostrophes in item names are preserved.
- Blank lines are ignored.

---

## FR-02 — Upload Chest Log

The user should be able to upload a `.txt` or `.csv` chest log.

### Acceptance Criteria
- File contents are parsed using the same parser as pasted text.
- Unsupported files generate a clear error.

---

## FR-03 — Parse Chest Log

The application must parse each valid row and extract:

- Item name
- Enchantment
- Quality
- Amount
- Player
- Timestamp

### Acceptance Criteria
- Every valid row becomes a structured record.
- Invalid rows are reported.
- Invalid rows are never silently discarded.

---

## FR-04 — Item Resolution

The application must resolve:

**Item Name + Enchantment + Quality**

to the correct Albion item identifier required by the market-price API.

The application should use Albion item metadata rather than relying on a large manually maintained hard-coded mapping.

### Example

```text
Adept's Fiend Cowl
Enchantment: 2
Quality: 4
        ↓
Correct Albion Item ID
        ↓
Market API
```

### Acceptance Criteria
- Correct item ID is generated for normal items.
- Correct enchantment is included.
- Correct quality is included.
- Unresolved items are explicitly shown to the user.

---

## FR-05 — Albion East Market Prices

The application must retrieve current market prices for the Albion Online East/Asia server.

### Preferred Data Source
**Albion Online Data Project (AODP)**

### Requirements
- Use East/Asia market data.
- Support multiple item IDs per API request where available.
- Record the price timestamp returned by the API when possible.

---

## FR-06 — Price Basis

### MVP Default
**Lowest current sell order**.

The UI must clearly identify the valuation method.

Example:

> Price basis: East — Lowest Sell Order

### Future Options
- Highest buy order
- Lowest sell order
- Average price
- Median price
- City-specific price
- Manual override

---

## FR-07 — Item Valuation

For every resolved item:

**Item Value = Current Market Price × Amount**

Example:

```text
Item price = 250,000
Amount = 3

Item value = 250,000 × 3
           = 750,000
```

---

## FR-08 — Total Loot Value

The application must calculate:

**Total Loot Value = Sum of all Item Values**

The result must be displayed prominently.

---

## FR-09 — Participant Count

The user must be able to enter the number of participants.

Example:

```text
Total Loot = 4,800,000
Participants = 5
```

---

## FR-10 — Equal Split

The application must calculate:

**Individual Share = Total Loot Value ÷ Number of Participants**

Example:

```text
4,800,000 ÷ 5 = 960,000
```

---

## FR-11 — Participant Names

### MVP
Support participant count.

### Preferred
Allow the user to enter participant names.

Example:

```text
Player 1
Player 2
Player 3
Player 4
Player 5
```

Future Discord integration may allow Discord mentions.

---

## FR-12 — Split Result

The application must display:

- Total loot value
- Number of participants
- Individual share
- Participant names if provided
- Each participant's share

---

## FR-13 — Item Breakdown

The application must display an item-by-item valuation table.

| Item | Enchant | Quality | Amount | Unit Price | Total |
|---|---:|---:|---:|---:|---:|
| Adept's Fiend Cowl | 2 | 4 | 1 | X | X |
| Adept's Bag | 1 | 4 | 1 | X | X |
| Adept's Cape | 2 | 3 | 1 | X | X |

The table should be sortable where practical.

---

## FR-14 — Duplicate Item Aggregation

If the same item with identical enchantment and quality appears multiple times, the application should aggregate quantities before requesting prices.

Example:

```text
T4 Item + Enchant 2 + Quality 4 × 1
T4 Item + Enchant 2 + Quality 4 × 3
```

becomes:

```text
T4 Item + Enchant 2 + Quality 4 × 4
```

This reduces API requests and simplifies the output.

---

## FR-15 — Unresolved Items

If an item cannot be mapped to an Albion item ID, display it under an **Unresolved Items** section.

The application must not silently exclude it.

Example:

```text
⚠ Unresolved Items
Adept's Unknown Item × 2

These items are excluded from the total until resolved.
```

---

## FR-16 — Missing Market Price

If an item is resolved but no current market price is available:

- Mark the item as unavailable.
- Do not silently assign a zero price.
- Clearly show it as excluded.
- Allow the user to retry the price lookup.
- Future versions may allow a manual price override.

---

## FR-17 — Copy Discord Result

Provide a button to copy a Discord-ready summary.

### Example

```text
⚔️ GANK LOOT SPLIT

💰 Total Loot: 4,800,000
👥 Participants: 5
🪙 Each Player: 960,000

Participants:
• Player1 — 960,000
• Player2 — 960,000
• Player3 — 960,000
• Player4 — 960,000
• Player5 — 960,000
```

---

# 6. Valuation Rules

## 6.1 Market Server

Default:

**Albion Online East / Asia**

The server should be clearly displayed in the UI.

---

## 6.2 Market Price

Default:

**Lowest current sell order**

This represents the approximate current market replacement value.

It is not necessarily the exact amount the guild will receive after selling items.

---

## 6.3 Market Tax

### MVP
Do not automatically subtract taxes or fees.

The calculator should initially return **gross market value**.

### Future Version
Optional deductions:

- Market tax
- Listing fee
- Repair costs
- Manual deductions

Example future calculation:

```text
Gross Loot Value
- Repair Cost
- Market Tax
- Other Fees
= Net Distributable Value
```

---

# 7. Loot Session Rules

The application assumes the guild uses this process:

1. All loot intended for splitting is placed into a designated common guild chest.
2. The chest log is copied after the loot session.
3. The loot manager pastes/uploads the log.
4. The application calculates market value.
5. The number or list of eligible participants is entered.
6. The equal share is calculated.
7. The guild distributes physical items from the chest according to the calculated value.

The application does **not** determine eligibility for a loot share.

---

# 8. User Interface Requirements

## 8.1 Main Screen

```text
┌─────────────────────────────────────────┐
│ ⚔️ ALBION GUILD LOOT CALCULATOR         │
├─────────────────────────────────────────┤
│                                         │
│ Paste Albion Chest Log                  │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │  Paste log here...                  │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Server:       [ Asia / East ▼ ]         │
│ Price Basis:  [ Lowest Sell ▼ ]         │
│ Participants: [ 5 ]                     │
│                                         │
│          [ CALCULATE VALUE ]            │
└─────────────────────────────────────────┘
```

---

## 8.2 Results Screen

```text
⚔️ GANK LOOT

💰 TOTAL MARKET VALUE
4,823,450 Silver

👥 PARTICIPANTS
5

🪙 EACH PLAYER
964,690 Silver
```

Then show the item breakdown.

---

## 8.3 Item Table

Columns:

- Item
- Enchantment
- Quality
- Quantity
- Unit Price
- Total Value
- Price Status

Example:

| Item | Enchant | Quality | Qty | Unit Price | Total |
|---|---:|---:|---:|---:|---:|
| Adept's Fiend Cowl | 2 | 4 | 1 | 850,000 | 850,000 |
| Adept's Bag | 1 | 4 | 1 | 120,000 | 120,000 |

---

## 8.4 Action Buttons

Required:

- **Calculate**
- **Copy Discord Result**
- **Clear**

Recommended:

- **Retry Prices**
- **Export CSV**
- **Recalculate**

---

# 9. Technical Architecture

## 9.1 Frontend

Recommended MVP:

- HTML
- CSS
- JavaScript

A framework such as React is optional.

The application should not require a heavy frontend framework unless needed for future features.

---

## 9.2 Backend

Recommended:

**Python + FastAPI**

Backend responsibilities:

1. Receive chest log.
2. Parse rows.
3. Validate rows.
4. Resolve item IDs.
5. Aggregate duplicates.
6. Query market API.
7. Calculate item values.
8. Calculate total.
9. Calculate split.
10. Return structured JSON.

---

## 9.3 Suggested Project Structure

```text
albion-loot-calculator/
│
├── backend/
│   ├── main.py
│   ├── parser.py
│   ├── item_resolver.py
│   ├── market.py
│   ├── calculator.py
│   └── models.py
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── data/
│   └── item_metadata.json
│
├── tests/
│   ├── test_parser.py
│   ├── test_resolver.py
│   └── test_calculator.py
│
├── requirements.txt
└── README.md
```

---

# 10. API Design

## POST `/api/calculate`

### Request

```json
{
  "log": "...raw Albion chest log...",
  "server": "east",
  "price_basis": "sell_min",
  "participants": 5,
  "participant_names": [
    "Player1",
    "Player2",
    "Player3",
    "Player4",
    "Player5"
  ]
}
```

### Response

```json
{
  "total_value": 4800000,
  "participants": 5,
  "share": 960000,
  "items": [],
  "unresolved_items": [],
  "missing_prices": [],
  "price_basis": "sell_min",
  "server": "east"
}
```

---

# 11. Processing Pipeline

```text
                Albion Chest Log
                       │
                       ▼
                Input Validation
                       │
                       ▼
                   CSV Parser
                       │
                       ▼
              Structured Item Rows
                       │
                       ▼
              Item ID Resolution
                       │
                       ▼
             Aggregate Duplicate Items
                       │
                       ▼
              East Market Price API
                       │
                       ▼
             Unit Price × Quantity
                       │
                       ▼
                Total Loot Value
                       │
                       ▼
                Participant Count
                       │
                       ▼
                 Equal Split Value
                       │
                       ▼
               Discord-ready Result
```

---

# 12. Item ID Resolution Strategy

The application must not assume that the displayed Albion item name directly equals the API item ID.

A metadata layer should resolve the displayed name into the correct internal item ID.

The resolver must account for:

- Tier
- Item type
- Enchantment
- Quality
- Special item variants
- Mounts
- Consumables

### Example Concept

```text
Adept's Fiend Cowl
Enchantment 2
Quality 4
       ↓
Base Item ID + Enchantment + Quality
       ↓
Correct API Item Identifier
```

The exact mapping should be validated against current Albion item metadata before production use.

---

# 13. Error Handling

## Invalid Log

Display:

> ❌ Could not parse the chest log. Please make sure the copied log includes the Date, Player, Item, Enchantment, Quality, and Amount columns.

## Partial Parse

Display:

> ⚠ 38 rows parsed successfully. 2 rows could not be parsed.

Allow the user to inspect the failed rows.

## Item Resolution Failure

Display:

> ⚠ Could not identify: Adept's Example Item, Enchantment 2, Quality 4

## Market API Failure

Display:

> ⚠ Market data is temporarily unavailable. Please retry.

## No Price

Display:

> ⚠ No current East sell order found for this item.

---

# 14. Rounding Rules

Albion uses whole silver values.

### Item Values
Round to the nearest whole silver.

### Individual Split
If the total is not perfectly divisible:

```text
Total = 1,000,001
Players = 3

Base share = 333,333
Remainder = 2
```

MVP should display:

```text
333,333 each
2 silver remainder
```

Future versions may support automatic remainder assignment.

---

# 15. Privacy & Data Handling

## MVP

The application should be stateless where practical.

- Do not require Albion account login.
- Do not require Discord login.
- Do not permanently store chest logs by default.
- Do not send logs to third parties except necessary market-price API requests.

If logs are uploaded to a backend, they should be processed and discarded unless the user explicitly enables session history.

---

# 16. Performance Requirements

### Target
For a normal chest log containing up to several hundred rows:

- Parsing: < 1 second
- Item resolution: < 1 second when metadata is cached
- Market lookup: dependent on external API
- Total calculation: < 1 second

Overall target:

**Under 5 seconds for a normal session**, excluding external API outages or rate limiting.

---

# 17. Mobile Requirements

The application must be usable on:

- Android Chrome
- Android Firefox
- iPhone Safari
- Desktop Chrome
- Desktop Firefox
- Desktop Safari

### Mobile UI Requirements

- Large paste area
- Large buttons
- No hover-only interactions
- Responsive tables
- Horizontal scrolling where necessary
- Copy-to-clipboard support

---

# 18. Security Requirements

- Validate uploaded file size.
- Limit request body size.
- Sanitize displayed player/item names.
- Do not execute uploaded content.
- Rate-limit public API endpoints if deployed publicly.
- Keep API credentials/server configuration out of frontend code if any are required.

---

# 19. Testing Requirements

## Parser Tests

Test:

- Normal rows
- Multiple rows
- Apostrophes
- Large quantities
- Enchantment 0
- Quality 1
- Quality 5
- Blank lines
- Invalid rows
- Missing fields

## Resolver Tests

Test:

- Normal armor
- Weapons
- Bags
- Capes
- Mounts
- Potions
- Enchanted items
- Different qualities

## Calculator Tests

Test:

```text
1000 / 5 = 200
```

```text
1001 / 5 = 200 remainder 1
```

```text
250000 × 4 = 1000000
```

## API Tests

Test:

- Successful price lookup
- Multiple item lookup
- Missing price
- API timeout
- API rate limit
- Invalid item ID

---

# 20. MVP Acceptance Criteria

The MVP is considered complete when a user can:

1. Paste the provided Albion chest log.
2. Successfully parse every valid row.
3. Correctly resolve item + enchantment + quality.
4. Retrieve current East market prices.
5. Calculate every item stack's value.
6. Calculate total chest value.
7. Enter the number of participants.
8. Calculate equal share.
9. See unresolved items.
10. See items with missing market prices.
11. Copy a clean Discord-ready result.
12. Use the application from a mobile browser.
13. Complete the normal workflow in under 60 seconds.

---

# 21. Example End-to-End Flow

### Step 1 — Guild Gank

Five players complete a gank.

### Step 2 — Deposit Loot

All loot goes into the designated guild chest.

### Step 3 — Copy Chest Log

Officer opens the chest log and copies it.

### Step 4 — Paste Into Calculator

```text
Paste Albion Chest Log
```

### Step 5 — Select Market

```text
Server: Asia / East
Price: Lowest Sell Order
```

### Step 6 — Enter Participants

```text
Participants: 5
```

### Step 7 — Calculate

The system resolves items and fetches current market values.

### Step 8 — Result

```text
⚔️ GANK LOOT SPLIT

💰 Total Market Value: 4,800,000
👥 Participants: 5
🪙 Each Player: 960,000
```

### Step 9 — Distribution

The officer distributes approximately 960,000 silver worth of physical items to each participant from the common chest.

---

# 22. Discord Output Specification

The copied result should be short and readable.

### Recommended Format

```text
⚔️ **GANK LOOT SPLIT**

💰 Total Value: **4,800,000**
👥 Participants: **5**
🪙 Each: **960,000**

**Participants**
• Player1 — 960,000
• Player2 — 960,000
• Player3 — 960,000
• Player4 — 960,000
• Player5 — 960,000

📊 Price: East Lowest Sell Order
```

Optional item breakdown should not be included in the default Discord message to keep it compact.

---

# 23. Future Features

## V2 — Participant Management

- Participant names
- Saved guild member list
- Discord mentions
- Role-based selection

## V2 — Weighted Splits

Support different shares:

```text
Normal participant = 1.0 share
Scout = 1.0 share
Caller = 1.0 share
Late joiner = 0.5 share
```

Formula:

```text
Value per share = Total Value ÷ Total Shares
Player payout = Value per share × Player Shares
```

## V2 — Manual Adjustments

Allow:

- Manual price override
- Repair deduction
- Market tax deduction
- Other expense deduction
- Bonus/penalty

## V2 — City Selection

Allow the user to choose:

- Caerleon
- Bridgewatch
- Fort Sterling
- Lymhurst
- Martlock
- Thetford
- Brecilien
- Other supported markets

## V3 — Discord Bot

Potential command:

```text
/split
```

The bot could request:

- Chest log
- Market/server
- Participants

and automatically post the result.

## V3 — Session History

Store:

- Session ID
- Date
- Guild
- Participants
- Chest log
- Items
- Market prices used
- Total value
- Individual shares

## V3 — Audit Trail

Allow officers to see:

```text
Gank #24
Date: 18 Aug 2026
Participants: 7
Total Value: 8.4M
Share: 1.2M
Calculated by: Officer
```

## V4 — Direct Albion Integration

If technically and policy-wise appropriate, explore automated retrieval of supported chest-log data without requiring manual copy/paste.

This must not automate gameplay or interact with the Albion client in a way prohibited by Albion's rules.

---

# 24. Product Principles

1. **Simple over clever.**
2. **No automatic loot tracking required.**
3. **The common chest is the source of truth.**
4. **Market prices must be transparent.**
5. **Unresolved items must never disappear silently.**
6. **Mobile users must have the same functionality as desktop users.**
7. **The tool should calculate value, not decide who deserves loot.**
8. **Every calculation should be understandable and auditable.**

---

# 25. Success Metric

The primary success metric is:

> A guild officer can go from an Albion chest log to a trustworthy total market valuation and equal player split in **under 60 seconds**.

Secondary metrics:

- <5% of normal logs require manual correction.
- No silent item omissions.
- Mobile users can complete the entire workflow.
- Discord result can be copied in one tap.

---

# 26. Reference Implementation Direction

A recommended implementation stack is:

```text
Frontend:
HTML + CSS + JavaScript

Backend:
Python + FastAPI

Market Data:
Albion Online Data Project (AODP)

Deployment:
Any lightweight web host/VPS

Storage:
None required for MVP
```

The existing open-source Albion loot-log tooling can be used as a reference for handling Albion loot-log formats, but the calculator's primary input is the **guild chest log CSV**, not an automatic loot logger.

---

# 27. Final MVP Definition

The product is ready for guild use when the following workflow works reliably:

```text
                GUILD CHEST
                     │
                     ▼
               CHEST LOG
                     │
                     ▼
             COPY / UPLOAD
                     │
                     ▼
          LOOT CALCULATOR WEBSITE
                     │
                     ▼
          PARSE ITEMS + QUANTITIES
                     │
                     ▼
          RESOLVE ITEM IDENTIFIERS
                     │
                     ▼
        EAST MARKET CURRENT PRICES
                     │
                     ▼
             TOTAL LOOT VALUE
                     │
                     ▼
              PARTICIPANT COUNT
                     │
                     ▼
               EQUAL SPLIT
                     │
                     ▼
            DISCORD-READY RESULT
```

**Core equation:**

```text
Item Value = Market Price × Quantity

Total Loot = Σ Item Value

Player Share = Total Loot ÷ Number of Participants
```

This is the complete MVP scope.

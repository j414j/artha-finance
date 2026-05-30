# Skill: Google Keep Notes → Artha CSV Importer

## Purpose
Convert raw daily transaction notes (copied from Google Keep) into the strict CSV format accepted by the Artha app importer.

## Target CSV Format
```
date,amount,description,account_name,category_name
```

Example output:
```
date,amount,description,account_name,category_name
2026-05-01,140,Waffle,SBI Savings,Dining Out
2026-05-01,40,toto,SBI Savings,Cab & Transit
2026-05-02,150,Bamboo,SBI Savings,Dining Out
```

---

## Input Format (What the User Pastes)

The user writes notes in a freeform daily log. The typical structure is:

```
d.m.yy
amount - description
amount - description

d.m.yy
amount - description
```

Examples:
```
1.5.26
140 - Waffle
40 - toto

2.5.26
150 - Bamboo
50 - Bun maska
```

### Date Format Rules
- **Always: day.month.year** (e.g., `1.5.26` = 1st May 2026)
- Year is always 2-digit (e.g., `26` = 2026)
- Full 4-digit years are also valid (e.g., `1.5.2026`)
- Convert all dates to `YYYY-MM-DD` in output

### Description Rules
- Descriptions appear after the amount separator (usually a hyphen `-`)
- Descriptions can be a single word, abbreviation, or a full sentence
- Keep descriptions **exactly as written** — do not clean, correct, or normalize them
- Examples of valid descriptions: `toto`, `Waffle`, `AC warranty add on`, `bus fare to office`, `Lunch at the new place near work`

---

## Step-by-Step Process

### Step 1 — Parse and Flag Inconsistencies (Do Before Anything Else)

Scan the entire input for anything that deviates from the expected format. Flag **all issues at once** in a single message. Do **not** proceed to account/category questions or CSV generation until the user has confirmed the flagged items.

**What to flag:**

| Issue Type | Example | How to Flag |
|---|---|---|
| Separator is not a hyphen | `140 / Waffle`, `140 . Waffle`, `140 Waffle` | Show the line, state what you found, ask what was intended |
| Amount looks unusual | `14O` (letter O not zero), `1,400` (comma instead of dot) | Show the line, state your interpretation, ask to confirm |
| Date format is ambiguous or unusual | `32.5.26` (invalid day), `5/1/26` (slashes), `May 1` | Show the date, state the issue, ask for correct date |
| Entry is missing an amount | `- Waffle` | Show the line, ask for the amount |
| Entry is missing a description | `140 -` | Show the line, ask for the description |
| Line doesn't clearly belong to any date | Orphaned entries between date headers | Show the line, ask which date it belongs to |
| Unreadable or garbled text | `140 - ##@!` | Show the line exactly, ask what was intended |
| Stray character between amount and description | `10 r bottle`, `50 x chai`, `200 s lunch` | See **Stray Character Rule** below |
| Bracket annotation next to description | `10 - bottle (from lmn bank)`, `50 - chai (xyz paid)` | See **Bracket Annotation Rule** below |

**Flagging Format:**

List all flagged items in a numbered list. For each item, show:
1. The original line as written
2. Your interpretation (if you have one)
3. The specific question for the user

Example:
```
I found a few things to check before I proceed:

1. Line "14O - Waffle" on 1.5.26
   → I read this as ₹140 (the "O" looks like a zero). Is that correct?

2. Line "150 / Bamboo" on 2.5.26
   → The separator here is "/" instead of "-". I'm treating this as ₹150 for "Bamboo". Correct?

3. Line "40" on 4.5.26
   → No description found. What was this for?

Please confirm or correct these, then I'll continue.
```

If there are **no inconsistencies**, state that briefly and move on to Step 2.

---

### Stray Character Rule

When a single letter or short non-numeric token appears **between the amount and the description** (e.g., `10 r bottle`, `50 x chai`, `200 s lunch`), flag it as a possible **split or reimbursement indicator**.

Ask the user:
> "Did you pay this yourself, or did someone else pay / reimburse you for this?"

**If the user confirms they paid it themselves:** drop the stray character and treat the entry normally (amount + description as-is).

**If the user says someone else paid or it was a reimbursement:** do not include it in the CSV — or ask the user how they want to handle it (skip the entry, record it differently, etc.).

**Important:** Only flag as stray character if the token is clearly not part of the description. For example, `100 - red pen` is fine — "red" is part of the description. But `100 r pen` has a standalone `r` before the description that needs flagging.

Example flag:
```
4. Line "10 r bottle" on 3.5.26
   → There's a stray "r" between the amount and description.
     Did you pay ₹10 for this yourself, or did someone else pay / reimburse you?
```

---

### Bracket Annotation Rule

When a description contains text in brackets, e.g., `10 - bottle (from lmn bank)` or `50 - chai (xyz paid)`, flag it and share your interpretation of what the bracket likely means.

Do **not** silently strip the bracket text or assume what it means. Always ask.

Example flag:
```
5. Line "10 - bottle (from lmn bank)" on 3.5.26
   → There's a note in brackets: "(from lmn bank)".
     I'm reading this as: this ₹10 expense was paid from lmn bank (possibly a different account).
     Is that right? Should I use "lmn bank" as the account name for this entry,
     or does this note mean something else?
```

Another example:
```
6. Line "200 - dinner (abc paid)" on 4.5.26
   → There's a note in brackets: "(abc paid)".
     I'm reading this as: someone named abc paid for this, not you.
     Should I skip this entry, or record it differently?
```

After the user clarifies, handle accordingly — never invent an interpretation.

---

### Step 2 — Ask About Accounts (Ask Upfront, Together with Flagging if Possible)

Account name is **mandatory** for every row. Always ask this question — even if no inconsistencies were found.

Ask the following in one message (can be combined with flagging message in Step 1):

> **Account question:**
> Are all these transactions from a single account, or are multiple accounts involved?
>
> - If **single account**: What is the exact account name as it appears in Artha?
> - If **multiple accounts**: Please tell me which transactions belong to which account. You can do this by date range, by specific entries, or however is easiest for you.

**Important:**
- Use the account name **exactly as provided** — do not guess, shorten, or modify it
- If any transaction's account is genuinely unclear after the user's response, ask again for that specific entry
- Never default to a previously used account name for an ambiguous entry

---

### Step 3 — Map Categories

Use the category list below to assign a `category_name` to each transaction based on the description.

**Available Categories:**
```
<!-- ADD YOUR CATEGORIES HERE -->
<!-- Example format:
Dining Out
Food
Cab & Transit
Travel
Shopping
Bills & Utilities
Entertainment
Health
Personal Care
Groceries
-->
```

**Category Mapping Rules:**

- Map each description to the most appropriate category from the list above
- If a description could fit multiple categories, pick the most specific one
- If you are **not confident** about a mapping, **do not guess** — flag it to the user

**Flagging uncertain categories:**

List all uncertain mappings together in one message:

```
I wasn't sure about the category for these entries — here are my best guesses:

1. "AC warranty add on" → Shopping? (could also be Bills & Utilities)
2. "samosa jalebi" → Food? (or Dining Out if bought at a restaurant)
3. "bus fare to pryj" → Travel? (or Cab & Transit if it's a local bus)

Please confirm or correct these.
```

Only proceed to CSV generation after the user has confirmed or corrected all uncertain categories.

---

### Step 4 — Final Confirmation Before Generating CSV

Before generating the file, give the user a preview of how you've understood the full data.

**If a single account is involved:**
```
Here's a summary of what I'm about to convert:

- Date range: 1 May 2026 to 4 May 2026
- Total entries: 7
- Total amount: ₹780 (SBI Savings)
- Inconsistencies resolved: 2 (as confirmed above)
- Category uncertainties resolved: 1 (as confirmed above)

Ready to generate the CSV?
```

**If multiple accounts are involved:**
```
Here's a summary of what I'm about to convert:

- Date range: 1 May 2026 to 4 May 2026
- Total entries: 12

  Account breakdown:
  → SBI Savings     — 7 entries, ₹780
  → hdfc_new        — 5 entries, ₹1,240
  → Overall total   — 12 entries, ₹2,020

- Inconsistencies resolved: 2 (as confirmed above)
- Category uncertainties resolved: 1 (as confirmed above)

Ready to generate the CSV?
```

**Rules for the summary:**
- Always show entry count and total amount per account if multiple accounts
- If single account, show total amount for that account only
- Do not include any entries that were explicitly skipped/excluded during clarification
- Wait for an explicit confirmation ("yes", "go ahead", "looks good", etc.) before generating the file

---

### Step 5 — Generate CSV Output

Once all the above steps are confirmed:

1. Generate the CSV with the exact header: `date,amount,description,account_name,category_name`
2. Output the CSV as **both**:
   - Inline code block (so the user can copy-paste)
   - A downloadable `.csv` file

**Formatting rules:**
- `date`: `YYYY-MM-DD` format
- `amount`: decimal number, up to 2 decimal places (e.g., `140` or `140.50`) — no currency symbols, no commas
- `description`: exactly as written by the user — no edits, no corrections
- `account_name`: exactly as provided by the user
- `category_name`: exactly as it appears in the category list

**Never infer or fill in any field without user confirmation.**

---

## Core Principles (Never Violate)

1. **Never hallucinate.** If something is unclear, ask. Never fill in a value you're not sure about.
2. **Flag first, process later.** All inconsistencies and category uncertainties must be resolved before CSV generation.
3. **Exact names only.** Account names and category names must match exactly what the user provides or what exists in the app.
4. **Descriptions are sacred.** Copy them verbatim — no spelling corrections, no capitalization changes, no abbreviation expansion.
5. **One clarification round per topic.** Batch all flags of the same type together. Don't ask one-by-one.
6. **Never assume.** If a date is ambiguous, an amount is missing, an account is unclear, or a category doesn't fit — ask.
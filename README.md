# Financial Overview

A local bank-account dashboard. Reads CSV exports from the workspace's `import/` folder and charts recorded daily closing balances for individual or combined accounts. Includes date filters, monthly gross cash flow, searchable transactions, categories, reusable categorization rules, transaction details, CSV download, and import reports.

This is the **user guide** for running the dashboard, importing bank statements, and managing categories. Developers: see the [developer guide](dashboard/README.md) for local setup, architecture, testing, and contributing changes.

![Overview](./screenshots/overview-1.png)

## Docker

From the repository root in WSL, with Docker available:

```sh
docker build -t financial-dashboard:latest ./dashboard
docker run -d --name financial-dashboard \
	--restart unless-stopped \
	-p 127.0.0.1:8765:3000 \
	-v financial-dashboard-imports:/app/import \
	-v financial-dashboard-data:/app/dashboard/data \
	financial-dashboard:latest
```

Open **http://127.0.0.1:8765**. Keep and back up both named volumes:

- **`financial-dashboard-imports`** stores uploaded bank CSV files.
- **`financial-dashboard-data`** stores category definitions, matching rules, manual category assignments, custom tags, and transaction tag assignments.

Reuse these volume names when replacing the container. Restarting the same container retains its files; a new container without explicit mounts gets fresh anonymous volumes. Existing imports and categories are not automatically copied into newly created named volumes, so preserve your old container and volumes until the data has been recovered or migrated.

Restart the existing container with `docker restart financial-dashboard`, or stop it with `docker stop financial-dashboard`. A new `docker run` needs a different container name or removal of the old container after preserving its data. Do not delete the named volumes or run volume-pruning commands unless you intend to delete the stored data.

Keep the `127.0.0.1` port binding: the dashboard has no login and is not intended for public or shared-network hosting. If port 8765 is occupied, change only that host-side port. For host-folder mounts or image maintenance, see [container development](dashboard/README.md#container-development).

## Language and Display

Choose **English** or **Nederlands** from the flag dropdown in the desktop header or beside the mobile privacy control. The choice is remembered in your browser. On the first visit, a Dutch browser selects Dutch; other browser languages fall back to English.

Dates, chart labels, counts, percentages, and displayed amounts follow the language. Currency selection remains independent, and amounts are never converted. Bank descriptions, merchant names, saved category names, and matching rules are not translated. Changing language keeps the current filters and unsaved edits.

Use the eye icon to hide displayed amounts. This masks the interface only, not the underlying data or downloaded CSV files.

## Imports

![imports](./screenshots/imports.png)

- Existing CSV files load automatically on opening the app.
- Add files to `./import/` and click the rescan icon, or upload/drop files in the Imports view. Uploaded files are validated before being saved to that same folder. Existing files are never overwritten.
- Import state is rebuilt from the source CSVs on refresh/rescan. No database or browser storage is required. To remove a source, move it out of `import/` and rescan.
- Supported format: Rabobank transaction CSV with the Dutch headers `IBAN/BBAN`, `Munt`, `Volgnr`, `Datum`, `Bedrag`, and `Saldo na trn`. Amounts use decimal commas, dates use `YYYY-MM-DD`, and UTF-8 / Windows-1252 are supported. Other banks' layouts require an additional format adapter.
- Overlapping exports are deduplicated by account, currency, and transaction sequence. Conflicting duplicates reject the entire affected file and appear in the import report. Malformed files do not prevent valid files from loading.
- Maximum file size: 20 MB. Literal unescaped quotes that the CSV parser can recover are reported as warnings; invalid dates, amounts, field counts, or unrecoverable quoting reject the file.

## Transaction Tags

Transactions can have multiple custom tags in addition to their category. Tags are managed directly in **Transactions**, without a separate tags page.

- Open **Manage tags** to create, rename, or delete tags. Names must be unique and contain 1-60 characters. Deleting a tag requires confirmation and removes it from all transactions, without deleting transactions or changing categories.
- Open a transaction's details to search for an existing tag, choose a suggestion, and use the plus button or Enter to add it. Assigned tags appear as chips; use a chip's remove button to unassign it. Creating a tag there also applies it to that transaction. Tags can also be added to internal transfers.
- Open **Filter tags** on Overview, Categories, a category's detail page, or Transactions and select one or more tags. **Any selected tag** matches transactions with at least one of them; **All selected tags** requires every selected tag. The selection is shared between these views and retained when drilling into transactions. Clear the selection to show transactions regardless of tags. In Transactions, tag filters also combine with search, direction, activity, and category filters.
- On Overview and category pages, tags filter external money in/out, net cash flow, spending charts and breakdowns, and transaction lists within the selected accounts, dates, and currency. Recorded closing balances, the balance-history chart, and sidebar account balances remain unchanged: they represent actual bank balances, not a balance reconstructed from tagged transactions. Closing the filter panel does not clear the selected tags; active tag chips remain visible.
- Inside **Manage tags**, choose a tag and **Add tag** or **Remove tag**, then **Apply to filtered transactions** to update all current matches, not just the visible page (up to 10,000 transactions per action). Existing unrelated tags remain unchanged.
- Assigned tags appear under transaction names. Downloaded transaction views include a **Tags** column with tag names separated by semicolons.

Tags and their assignments are saved alongside category metadata, separately from bank CSVs. They survive rescans, overlapping imports, and app/container restarts when the data volume is preserved. Back up `financial-dashboard-data` as well as your source imports. Tag names are user data and do not change when switching interface languages.

## Transaction Categories

![categories overview](./screenshots/categories-1.png)

Bank CSVs are read-only source exports. Categorizing a transaction never updates a CSV. Category definitions, rules, and manual assignments are stored separately in `dashboard/data/categories.json` (relative to the workspace root), which is created on the first save and excluded from Git.

- Open **Categories** to manage Groceries, Mortgage, Insurance, Subscriptions, or your own categories. Names and colors are editable.
- Assign an individual transaction from its category dropdown or details dialog. In **Transactions**, search/filter first, then open **Assign category** to assign all matching results, not just the visible page (up to 10,000 at once).
- Create a rule by matching counterparty/description text (case-insensitive contains) or a counterparty account (case-insensitive exact match), with an optional money-in/out restriction. The match preview covers all imported dates, accounts, and currencies. Rules affect existing and future matching transactions.
- The saved rules list is paginated: 10 rules per page by default, with 25 and 50 available. Filter the list by category or choose All categories. Counts and page ranges reflect the filtered rules; changing the filter or page size returns to page one. The list stays newest-first, and these display controls do not change matching priority or saved rules.
- The newest matching rule wins. Manual assignments, including explicitly choosing Uncategorized, take priority over rules. Choose **Use rules (clear override)** to remove a manual assignment.
- Open a transaction's details and choose **Create rule** to prefill a rule from that transaction. Review the match text and preview before saving; payment processors can represent several merchants.
- The spending breakdown shows external gross debits in the selected period, account selection, and currency. Click a category name or pie slice to open its detailed spending page. Refunds remain credits and are not netted against spending. Detected transfers between imported accounts are excluded from all spending and cash-flow reports. Category filtering does not alter recorded account balances.
- Category and merchant spending show a monthly average over the selected period. **1M**, **3M**, and **1Y** use 1, 3, and 12 months; **All time** and custom ranges count the calendar months touched, including partial months.
- Deleting a category removes its rules and makes its manual assignments Uncategorized. Deleting a rule affects automatic matches but leaves manual assignments alone. Deletions require confirmation.
- Category names are included in downloaded transaction views. The original bank export is never rewritten.

![categories2](./screenshots/categories-2.png)

Assignments use the stable account/currency/sequence transaction ID, so they survive app restarts, rescans, and overlapping exports. Back up **both** the source `import/` folder and `dashboard/data/`; the CSVs alone cannot restore your categories. Corrupt metadata is reported rather than silently overwritten. If another window saves first, rescan before retrying a stale update.

### Spending Charts and Category Details

![Overview](./screenshots/overview-2.png)

Overview and Categories include a spending pie chart, with each slice proportional to the category's gross debits. Zero-spend categories remain accessible in the category list but do not create slices. A period with no spending shows an empty state rather than a fabricated chart.

Overview also includes spending-by-category bars using the same intervals as cash flow: **1M** shows days, **3M** shows weeks, and **1Y** / **All time** show months. Custom ranges show days up to 31 days, weeks up to 93 days, and months for longer periods. Weeks run Monday through Sunday; boundary weeks include only the selected dates. Credits and refunds are shown separately from spending.

Each category's detail page shows total spent, credits, transaction count, monthly average, counterparty group count, and a merchant spending pie chart. Click a merchant slice or row, or choose a counterparty from the menu, to filter the paginated transaction list. The full category totals and pie remain unchanged while drilling into a merchant. **All categories** returns to the category list; **Open in transactions** opens the full transaction explorer filtered to that category. The selected accounts, date period, and currency apply throughout.

AH and Albert Heijn name variants are grouped as **Albert Heijn (AH)**, and ALDI locations as **ALDI**. Other counterparties are grouped by their case/whitespace-normalized name, ignoring common leading payment-terminal prefixes (`BCK*`, `CCV*`, `PAY.nl*`, `SumUp*`). Unnamed counterparties use the counterparty account when available, or **Unknown counterparty** otherwise. This is display-only grouping, not an additional categorization rule; the original transaction names remain available in the transaction list and details. Unknown brands are not automatically merged by bank account, since payment processors can represent unrelated merchants.

Pie charts use external spending only, not transaction counts or balances. Credits/refunds are displayed separately and never produce negative slices. Detected internal transfers are excluded from category/merchant totals, counts, and detail transaction lists, regardless of any existing category assignment. All monetary aggregation uses integer cents and one selected currency. These charts do not modify source CSVs, category assignments, or saved rules.

### Internal Transfers

The app detects internal transfers only when the transaction's account and its **different** counterparty account are both selected in the sidebar. Account identifiers are compared without whitespace and without case sensitivity. If either account is deselected, transfers to or from it count as external activity for the remaining selected accounts. Detection uses the complete date history of the selected accounts and currency, not just the visible period. No equal-amount/opposite-leg match is required, so a transfer can still be internal when the other selected account's entry falls outside the selected period or its export has incomplete coverage.

Same-account references are not treated as internal transfers: bank fees can reference the charged account itself. Merchant names, descriptions, and coincidentally equal amounts are never used to infer ownership. Transfers to accounts that have not been imported, or with a missing counterparty account, cannot be automatically identified and remain external activity.

Detected transfers between selected accounts are excluded from money in/out, net external cash flow, cash-flow and category spending bars, category spending pies, and merchant breakdowns. Changing the account selection updates this treatment in reports, history labels, filters, and exports. Closing balances, balance history, and the full transaction history still include every original transaction. Different currencies are reported separately without conversion.

Reports show the excluded transfer entry count and incoming/outgoing totals for the selected accounts and period. The count is **bank entries**, not matched transfer pairs: a transfer may contribute two entries when both legs are present. Choose **View transfers**, or use the **Activity** filter in Transactions, to review internal transfers, external activity, or all activity. Transfer entries are labeled in the table and details. They are excluded from bulk category assignment, and their existing assignments/rules are preserved rather than rewritten. Downloaded transaction views include an **Internal transfer** flag; the original CSVs are unchanged.

### Regex Filters

![transactions](./screenshots/transactions.png)

Transaction search has a **Use regular expression** icon toggle. Category rules have a **Match type** menu: choose **Regular expression (RE2)**. Plain text remains the default, and existing saved rules retain their original behavior.

Enter the pattern itself, without surrounding `/` delimiters or trailing flags. Matching is case-insensitive by default. For example, use this counterparty rule with **Money out** and **Groceries**:

```regex
^AH\s+(Bemmel|Opheusden)$
```

This matches either AH branch, without matching an unrelated name containing `AH`. To include older Albert Heijn names and other AH branches, use `^(AH\b|Albert Heijn\b)` instead. Check the live preview before saving.

Patterns support anchors, alternation, character classes, word boundaries, and quantifiers. Matching uses RE2 through `re2js`, avoiding catastrophic backtracking. Lookarounds and backreferences are not supported. Patterns are limited to 200 characters; regex escapes, capitalization, and leading/trailing whitespace are preserved. Invalid or unsupported patterns show an error, match nothing, and cannot be saved. Regex transaction searches apply independently to the same fields as text searches: counterparty, description, bank account, counterparty account, date, and amount. Search is temporary; only saved categorization rules persist, separately from the unchanged CSV exports.

## Balance Semantics

Balances come from `Saldo na trn`, not from an assumed zero opening balance. Transactions are ordered by booking date and numeric sequence; the final transaction per date defines the daily close. The previous known balance is carried forward across dates without activity. An account has no plotted balance before its first recorded transaction, and combined balance starts only when every selected account has a known balance. A historical closing balance uses the last known value on or before the selected end date. Gaps in the source exports cannot be reconstructed.

Different currencies are never summed or converted. Money in/out are external gross credits/debits after excluding detected transfers between imported accounts, not classified income/expenses. Sidebar balances show each account's latest recorded balance regardless of the selected period. Date presets are relative to the most recent transaction in the selected currency, not today's date.

The download button exports the filtered transaction view for analysis; it is not a Rabobank-format backup for reimport. Hide amounts masks displayed values, not the underlying locally loaded data or CSV downloads.

## Privacy

No analytics, external APIs, remote fonts, or cloud storage. Data and assets are served locally. Import endpoints reject cross-origin requests and file path traversal. Source CSVs remain unmodified by parsing. Back up and protect the `import/` folder as you would bank statements. The local app has no login and is not intended for hosting on a shared or public server.

## Developers

The [developer guide](dashboard/README.md) covers WSL setup, source layout, API and storage contracts, localization, tests, production builds, and Docker image maintenance. Use that guide when changing or extending the application; user-facing behavior and operating instructions belong here.

# Financial Overview Developer Guide

This guide covers development, implementation contracts, verification, and container maintenance. For screenshots, installation and everyday use, imports, categories, and persistent Docker volumes, see the [user guide](../README.md).

## Local Development

Requires Node.js 22.12+ (or a newer supported Node.js release) and npm inside WSL.

```sh
cd dashboard
npm ci
npm run dev
```

Run the commands above from the repository root in WSL. Vite binds to `127.0.0.1:5173` by default and selects another port if occupied. File watching uses polling for Windows-mounted paths. The development server serves both React and the local API; no database or separate backend process is required.

## Source Layout

- `src/App.jsx`: application state, filters, transaction browsing, imports, and language selection.
- `src/Categories.jsx`: category and merchant analytics, category editors, and rule management.
- `src/Tags.jsx`: inline tag management, any/all filters, bulk tag actions, and transaction tag editing/display.
- `src/finance.js`: CSV decoding/parsing, exact monetary calculations, deduplication, balances, transfer detection, and reporting intervals.
- `src/categories.js`: category resolution, rule matching/validation, and category/merchant aggregation.
- `src/i18n.js`, `src/localization.js`, `src/locales/nl.json`: language policy, React localization, and Dutch translations.
- `server/api.js`: import scanning/uploads and categorization persistence.
- `server/index.js`: production HTTP entry point serving built assets with the same API.
- `vite.config.js`: development and preview API integration.
- `tests/`: Node test-runner coverage for financial logic, categories, localization, API security, and production serving.

Always specify extensions when importing `categories.js` and `Categories.jsx`: extensionless imports can resolve incorrectly on case-insensitive filesystems.

## Container Development

The multi-stage `Dockerfile` uses Node.js 24 Alpine to build the frontend, then runs the built assets and existing API with a small production Node server (no Vite runtime). The final image runs as the unprivileged `node` user and has a health check. The build-context allowlist excludes bank CSVs, saved categories, local dependencies, and other workspace files.

Run these commands from the **repository root in WSL**, with Docker Desktop's WSL integration enabled (or a working Docker Engine):

```sh
docker build -t financial-dashboard:latest ./dashboard
mkdir -p import dashboard/data
docker run --rm --name financial-dashboard-dev \
	-p 127.0.0.1:8080:3000 \
	--mount "type=bind,source=$(pwd)/import,target=/app/import" \
	--mount "type=bind,source=$(pwd)/dashboard/data,target=/app/dashboard/data" \
	financial-dashboard:latest
```

Open **http://127.0.0.1:8080**. Both existing imports and saved categorization are reused. Uploads and category edits persist in the mounted host folders after stopping or replacing the container. Back up both folders; neither is included in the image. Both mounts must be writable by container UID/GID **1000:1000**; existing CSV contents are never rewritten, but uploads require write access to the import directory. On native Linux, adjust ownership or grant this UID access to those directories if needed; do not run the container as root to bypass permissions.

This bind-mount example is useful for developing against existing host data. Stop it with `docker stop financial-dashboard-dev`. Keep the `127.0.0.1` binding: there is no authentication, and the API deliberately rejects non-local hostnames and cross-origin requests. Network hosting requires a separate security design, not just disabling the host checks. User deployment with named volumes is documented in the [user guide](../README.md#docker).

Rebuild with `docker build --pull -t financial-dashboard:latest ./dashboard` to refresh the base image, and scan the resulting image before deployment. An earlier editor scan flagged four high-severity advisories for `node:24-alpine`; that is not a current clean security assessment. Alpine package updates were blocked in the original build environment by repository TLS certificate trust. Configure the appropriate trusted CA before using `apk` updates; never disable TLS verification.

Outside Docker, run `npm run build && npm start` to use the same production server on `127.0.0.1:3000`. `HOST` and `PORT` configure its listener; production assets are served only from `dist/`, and data directories retain their existing locations.

## API and Data Contracts

- `GET /api/data` rebuilds transaction state from source CSVs and returns import notices and categorization metadata.
- `POST /api/import` accepts an `application/octet-stream` CSV upload with a URL-encoded `X-File-Name` header. The limit is 20 MB. Validate before saving; never overwrite existing source exports.
- `POST /api/categories` accepts JSON commands with the current revision. Reject stale revisions rather than overwriting another window's changes.

Source exports live in the repository's `import/` directory. Categories, rules, and manual assignments live separately in `dashboard/data/categories.json`, which is gitignored. Transaction assignments use stable account/currency/sequence IDs. Category updates are serialized and saved using a temporary file and atomic rename. Corrupt metadata must be reported, not silently replaced.

Tags share that metadata file and revision mechanism. `tags` holds `{ id, name }` definitions; `transactionTags` maps stable transaction IDs to arrays of tag IDs. Both fields are optional when reading legacy files and are initialized on the next metadata update. Do not rewrite existing files just to add empty tag fields. Tag names are unique after normalization and limited to 60 characters; tag IDs and assignments are validated, including duplicate or unknown references.

The existing `POST /api/categories` endpoint also accepts `saveTag`, `deleteTag`, and `tagTransactions`. `saveTag` can include `transactionIds` to create-and-assign atomically. `tagTransactions` takes one `tagId`, an `operation` of `add` or `remove`, and 1-10,000 known transaction IDs. Add/remove is idempotent and preserves unrelated tags; deletion removes the tag's references and empty assignment entries. Tagging is independent of category resolution and is allowed on internal transfers.

`matchesTransactionTags` implements any/all matching over selected tag IDs. The shared `TagFilter` control is used on Overview, category views, and Transactions. `summarizePeriod` accepts an optional `includeTransaction` predicate: tag scoping is applied after account/date selection, while internal-transfer detection still uses the complete selected-account history. Charts, activity totals, category breakdowns, transfer summaries, and transaction lists all use that scoped period. Recorded balances and balance history must continue using the original transactions.

Transactions additionally applies its search, category, activity, and direction filters before pagination, export, and bulk actions. Ignore deleted tag filter IDs and reset pagination when the user changes tags or matching mode. Retain the shared tag selection when navigating from a category or overview report into Transactions. With no tags selected, reporting must match the unfiltered behavior. Exported tag names belong in the additional `Tags` column, never in the original bank CSV.

Amounts are integer cents. Parse Dutch decimal-comma amounts and UTF-8/Windows-1252 exports. Deduplicate overlapping exports by account, currency, and sequence. Conflicting duplicates reject the affected file. Recoverable quoting issues produce notices; malformed dates, amounts, field counts, and unrecoverable quoting reject the file.

Manual assignments, including explicit Uncategorized, override rules; the newest matching rule otherwise wins. Merchant display grouping must not alter source names, assignments, or rules, and must not merge unrelated merchants solely because they share a payment processor's account.

## Localization

Translations use **i18next** and **react-i18next**. English source phrases are translation keys, with Dutch translations in `src/locales/nl.json`. English falls back to the source phrase; English plural variants are declared in `src/i18n.js`. Components access `t` and the current locale through `useLocale` in `src/localization.js`. Use interpolation for dynamic values and `count` with `_one`/`_other` entries for plurals; never translate user-provided names or rule values.

To add another language, add its catalogue, register its resource bundle in `createI18n`, extend `supportedLanguages` and `localeFor`, and add an option and flag asset to `LanguageSelector`. Extend the locale tests as well, including the weekly date label in `formatChartPeriod`. Never translate or rewrite bank descriptions, saved category names, merchant names, or rule patterns. Locale changes affect display, not stored amounts, parsing, currency selection, or downloaded CSV column names. Translate notices at render time so open messages update when language changes.

### Spending Charts and Category Details

Category and merchant spending uses gross debits; refunds remain separate credits. Zero-spend categories must not produce slices or fabricated spending. Pass date/account/currency-scoped external transactions into category and merchant aggregation.

Overview also includes a stacked spending-by-category bar chart using the same time buckets and account/date/currency scope as cash flow. The **1M** preset uses daily intervals, **3M** uses weekly intervals, and **1Y** / **All time** use monthly intervals. Custom ranges use daily intervals up to 31 days inclusive, weekly intervals up to 93 days, and monthly intervals for longer periods. Both chart headings, axis labels, and tooltips reflect the interval.

Weeks run Monday through Sunday in UTC. Boundary weeks include only transactions inside the selected date range, and intervals with no transactions show zero values between active periods. Each colored segment represents one category's external debits, including an Uncategorized segment when needed. Hover a bar to see the category amounts and total money out. The stacks reconcile to cash flow's outgoing amounts; credits/refunds are not subtracted, and internal transfers remain excluded. Hiding amounts also masks the chart's axis and tooltip values.

Merchant drilldowns filter transaction rows without changing the full category totals or pie. Monthly averages use preset durations of 1/3/12 months, or inclusive calendar months for custom/All time ranges.

`merchantIdentity` groups AH/Albert Heijn and ALDI aliases. Other merchants use normalized names with common payment-terminal prefixes removed. Unnamed merchants use the counterparty account when available. Grouping is display-only; preserve original transaction data.

Pie charts use external spending only, not transaction counts or balances. Credits/refunds are displayed separately and never produce negative slices. Detected internal transfers are excluded from category/merchant totals, counts, and detail transaction lists, regardless of any existing category assignment. All monetary aggregation uses integer cents and one selected currency. These charts do not modify source CSVs, category assignments, or saved rules.

### Internal Transfers

The app detects internal transfers only when the transaction's account and its **different** counterparty account are both selected in the sidebar. Account identifiers are compared without whitespace and without case sensitivity. If either account is deselected, transfers to or from that account are included as external activity for the remaining selected accounts. Detection uses the complete date history of the selected account/currency IDs, not only the visible date period. No equal-amount/opposite-leg match is required, so a transfer can still be internal when the other selected account's entry falls outside the selected period or its export has incomplete coverage.

Same-account references are not treated as internal transfers: bank fees can reference the charged account itself. Merchant names, descriptions, and coincidentally equal amounts are never used to infer ownership. Transfers to accounts that have not been imported, or with a missing counterparty account, cannot be automatically identified and remain external activity.

Detected transfers between selected accounts are excluded from money in/out, net external cash flow, cash-flow and stacked spending bars, category spending pies, and merchant breakdowns. Changing the account selection updates this treatment everywhere, including history labels, filters, and exports. Closing balances, balance history, and the full transaction history still include every original transaction. Different currencies are still reported separately without conversion.

Use `summarizePeriod`'s `reportingTransactions` for external-spending analytics; retain original transactions for balances and history. Transfer counts represent bank entries, not matched pairs. Internal transfers are excluded from bulk category assignment; preserve their existing assignments and rules.

## Rules and Performance

Regex matching uses RE2 through `re2js`: case-insensitive, maximum 200 characters, no lookarounds or backreferences. Preserve regex escapes, capitalization, and whitespace; do not normalize patterns like plain text. Invalid patterns fail closed and cannot be saved.

Compiled filters cache results with a 4096-input bound. Per-rule matchers use a WeakMap and invalidate when matching inputs change. Preserve cache invalidation when editing rules. Account selection owns urgent checkbox state and uses a transition for report updates; preserve rapid toggles through the latest-selection reference. Reuse date formatters and include locale in formatter cache keys.

## Balance Semantics

Balances come from `Saldo na trn`, not from an assumed zero opening balance. Transactions are ordered by booking date and numeric sequence; the final transaction per date defines the daily close. The previous known balance is carried forward across dates without activity. An account has no plotted balance before its first recorded transaction, and combined balance starts only when every selected account has a known balance. A historical closing balance uses the last known value on or before the selected end date. Gaps in the source exports cannot be reconstructed.

Different currencies are never summed or converted. Money in/out are external gross credits/debits after excluding detected transfers between imported accounts, not classified income/expenses. Sidebar balances show each account's latest recorded balance regardless of the selected period. Date presets are relative to the most recent transaction in the selected currency, not today's date.

The download button exports the filtered transaction view for analysis; it is not a Rabobank-format backup for reimport. Hide amounts masks displayed values, not the underlying locally loaded data or CSV downloads.

## Security Boundaries

Do not introduce analytics, remote fonts, external financial APIs, or cloud storage without an explicit product decision. Import endpoints must continue rejecting cross-origin requests and unsafe filenames. Production static serving is limited to `dist/`; source exports, category data, and server code must not become public assets. There is no authentication, so network exposure requires a separate security design.

## Checks and Build

Run from `dashboard/` in WSL:

```sh
npm test
npm run lint
npm run build
npm run preview
```

`preview` serves the production build together with the local API. `npm start` serves the same build using the production Node entry point. Do not open `dist/index.html` directly or deploy it to a static host: persistence requires the API.

Use `node --test tests/api.test.js`, `tests/finance.test.js`, `tests/categories.test.js`, or `tests/i18n.test.js` for focused checks. Tests cover synthetic financial cases, temporary API storage, and production serving. The real-export test also expects the original supplied CSV in `../import/`; do not modify that export to make tests pass. Translation coverage uses `@babel/parser` to check JSX labels, catalogue keys, interpolation placeholders, plurals, persistence, and locale formatting.

To test the production API inside the Alpine image without mounting user data, run from `dashboard/`:

```sh
docker run --rm \
	--mount "type=bind,source=$(pwd)/tests/api.test.js,target=/app/dashboard/tests/api.test.js,readonly" \
	financial-dashboard:latest node --test tests/api.test.js
```

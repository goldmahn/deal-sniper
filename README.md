# Deal Sniper

Node.js price watcher that scrapes configured store searches, logs results, and sends Telegram alerts when prices hit your targets or drop sharply versus a rolling baseline.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install Playwright’s Chromium browser (first time only):

   ```bash
   npx playwright install chromium
   ```

3. Copy the example env file and fill in your Telegram credentials:

   ```bash
   cp .env.example .env
   ```

   Get a bot token from [@BotFather](https://t.me/BotFather). Your chat ID is the numeric ID of the chat or channel where alerts should go.

## Browser mode

Playwright runs **headless by default** (no window), including when `HEADLESS` is unset or set to `true`. That suits unattended runs on a server or with `npm run watch`.

To debug scraping with a visible browser, set in `.env`:

```bash
HEADLESS=false
```

Only the literal value `false` opens a window; any other value keeps headless mode. Applies to `npm start` and `npm run watch`.

## Commands

- **`npm start`** — Run one scan pass: read watches from `data/products.json`, scrape each watch, append to the current month’s `data/price-history-YYYY-MM.jsonl`, update `data/baselines.json`, and send Telegram messages for alerts.
- **`npm run watch`** — Run scans repeatedly on a timer (default every 15 minutes, set `POLL_INTERVAL_MINUTES` in `.env`). Skips a tick if the previous scan is still running. Logs scan start/end and the next scheduled tick.
- **`npm run status`** — Quick health check: watch process running, last log lines, data file sizes, baseline summary. Process detection works on both Linux/macOS and Windows.
- **`npm test`** — Run the unit test suite (Node's built-in test runner; no extra dependencies).
- **`npm run test:telegram`** — Send a single test message (`Deal Sniper online.`) to verify `.env` and Telegram connectivity.

## Unattended operation (tmux)

On Ginnungagap, run watch mode in a detached tmux session so it survives logout:

```bash
cd /Users/ginnungagap/Projects/dealbot
tmux new -s dealsniper
npm run watch
```

Detach with `Ctrl-b` then `d`. Reattach later:

```bash
tmux attach -t dealsniper
```

Check health without attaching:

```bash
npm run status
tail -f logs/dealsniper-$(date +%Y-%m).log
```

Operational events append to the current month’s `logs/dealsniper-YYYY-MM.log` (plain text, gitignored). Each scan logs start/end, duration, listing counts, alerts, Telegram sends, and errors. Listing JSON still goes to the console and the current month’s `data/price-history-YYYY-MM.jsonl`.

Older unrotated files (`data/price-history.jsonl`, `logs/dealsniper.log`) are left in place if they exist; new writes use the monthly filenames only.

## Watch list (`data/products.json`)

Watches are a JSON array. Each entry needs:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Label for logs and alerts (e.g. `"DDR5 32GB Newegg Test"`). |
| `store` | yes | Store adapter name. Supported: `"newegg"`, `"craigslist"`. |
| `url` | yes | Page to open (a search results URL for the chosen store). |
| `targetPrice` | no | Alert when a listing price is at or below this value (USD). |
| `requirements` | no | Optional filters applied to scraped listing titles before candidate selection. |

### Craigslist watches

Set `"store": "craigslist"` and point `url` at a Craigslist search results page, e.g. `https://sfbay.craigslist.org/search/sss?query=ddr5%20ram&sort=priceasc`. The adapter scrapes up to 20 results (title, URL, price, location) and tolerates several Craigslist layouts. Craigslist listings have no product identity yet, so each result is treated individually (no dedupe); the `requirements` title filters still apply if you set them.

### Requirements (`requirements`)

When present, each scraped listing is validated from its **title** before it can become the watch candidate. Listings that fail are still written to history with `validationPassed: false` and `validationReasons`.

| Field | Description |
|-------|-------------|
| `generation` | Required substring in title (case-insensitive), e.g. `"DDR5"`. |
| `totalCapacityGB` | Title must contain total capacity as a word boundary match, e.g. `64` → `64GB`. |
| `allowedKitLayouts` | If set, title must match at least one kit layout. Values use `modules x perStickGB`, e.g. `"2x32"` matches `2 x 32GB`, `(2 x 32GB)`, or `2x32GB`. |
| `excludeTerms` | If any term appears in the title (case-insensitive), the listing is rejected. |

Candidate selection uses only listings with `validationPassed: true`, then picks the lowest price. If none pass, baseline updates and alerts are skipped for that watch.

Example:

```json
[
  {
    "name": "DDR5 32GB Newegg Test",
    "store": "newegg",
    "url": "https://www.newegg.com/p/pl?d=DDR5+32GB+6000",
    "targetPrice": 80,
    "requirements": {
      "generation": "DDR5",
      "totalCapacityGB": 32,
      "allowedKitLayouts": ["2x16"],
      "excludeTerms": ["SO-DIMM", "SODIMM", "Laptop", "Mac", "Server"]
    }
  },
  {
    "name": "DDR5 64GB Newegg Test",
    "store": "newegg",
    "url": "https://www.newegg.com/p/pl?d=DDR5+64GB+6000",
    "targetPrice": 150,
    "requirements": {
      "generation": "DDR5",
      "totalCapacityGB": 64,
      "allowedKitLayouts": ["2x32", "4x16"],
      "excludeTerms": ["SO-DIMM", "SODIMM", "Laptop", "Mac", "Server"]
    }
  }
]
```

## Runtime data (not committed)

- `data/baselines.json` — rolling price stats per watch. The `averagePrice` is the mean of the most recent `BASELINE_WINDOW_SIZE` prices (default 50) across all valid listings for that watch; `lowestSeen`/`highestSeen` are all-time. Used for the anomaly-drop alert (`price ≤ averagePrice × 0.55` once `marketSampleSize ≥ 10`).
- `data/price-history-YYYY-MM.jsonl` — append-only log of each scraped listing (one file per month)
- `data/alert-state.json` — last Telegram alert per product or listing (deduplication). Keys use `store:watchName:productKey` when `productKey` is present, otherwise `store:watchName:url` (legacy). No migration required; old URL keys are simply unused for listings that now have a `productKey`.
- `logs/dealsniper-YYYY-MM.log` — operational scan log (start/end, counts, errors; one file per month)

These files are created on first run and listed in `.gitignore`.

### Price history fields (`data/price-history-YYYY-MM.jsonl`)

Each scraped listing is one JSON object per line. Newegg rows include product identity fields (enrich-only; does not change candidate selection or alerts):

| Field | Description |
|-------|-------------|
| `productKey` | Stable id: `newegg:item:<id>`, `newegg:model:<MPN>`, or `newegg:url:<normalizedUrl>`. |
| `productKeySource` | How `productKey` was derived: `newegg_item_id`, `model_number`, `normalized_url`, or `none`. |
| `identityConfidence` | `high` (item id), `medium` (model only), or `low` (url fallback / missing). |
| `neweggItemId` | Item id from URL path `/p/<id>`, if present. |
| `modelNumber` | Manufacturer model parsed from title after `Model`, if present. |
| `normalizedUrl` | Listing URL with query string and hash removed. |

Other stores omit these fields until a store-specific identity module exists.

**Dedupe (candidate selection only)** — After validation, valid listings with the same `productKey` are collapsed to one row (lowest price; tie → first scrape order). Every listing is still written to history:

| Field | Description |
|-------|-------------|
| `dedupeRole` | `kept` (eligible for candidate), `duplicate` (same `productKey` as a cheaper or earlier listing), or `not_applicable` (failed validation). |
| `dedupeGroupKey` | Set to `productKey` when dedupe applied; omitted when not applicable. |

Listings without `productKey` stay eligible individually. Scan logs include `duplicatesCollapsed` per watch (when > 0) and in the scan summary line.

**Alert identity (watch candidate rows)** — Cooldown in `data/alert-state.json` is keyed by canonical product when possible:

| Field | Description |
|-------|-------------|
| `alertStateKey` | `store:watchName:productKey` or `store:watchName:url` fallback. |
| `alertStateKeySource` | `productKey` or `url`. |

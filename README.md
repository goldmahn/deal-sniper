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

## Commands

- **`npm start`** — Run one scan pass: read watches from `data/products.json`, scrape each watch, append to `data/price-history.jsonl`, update `data/baselines.json`, and send Telegram messages for alerts.
- **`npm run watch`** — Run scans repeatedly on a timer (default every 15 minutes, set `POLL_INTERVAL_MINUTES` in `.env`). Skips a tick if the previous scan is still running. Logs scan start/end and the next scheduled tick.
- **`npm run test:telegram`** — Send a single test message (`Deal Sniper online.`) to verify `.env` and Telegram connectivity.

## Watch list (`data/products.json`)

Watches are a JSON array. Each entry needs:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Label for logs and alerts (e.g. `"DDR5 32GB Newegg Test"`). |
| `store` | yes | Store adapter name. Currently only `"newegg"` is supported. |
| `url` | yes | Page to open (for Newegg, a search results URL). |
| `targetPrice` | no | Alert when a listing price is at or below this value (USD). |
| `requirements` | no | Optional filters applied to scraped listing titles before candidate selection. |

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

- `data/baselines.json` — rolling price stats per watch
- `data/price-history.jsonl` — append-only log of each scraped listing
- `data/alert-state.json` — last Telegram alert per listing (deduplication)

These files are created on first run and listed in `.gitignore`.

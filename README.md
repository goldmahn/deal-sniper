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
- **`npm run test:telegram`** — Send a single test message (`Deal Sniper online.`) to verify `.env` and Telegram connectivity.

## Watch list (`data/products.json`)

Watches are a JSON array. Each entry needs:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Label for logs and alerts (e.g. `"DDR5 32GB Newegg Test"`). |
| `store` | yes | Store adapter name. Currently only `"newegg"` is supported. |
| `url` | yes | Page to open (for Newegg, a search results URL). |
| `targetPrice` | no | Alert when a listing price is at or below this value (USD). |

Example:

```json
[
  {
    "name": "DDR5 32GB Newegg Test",
    "store": "newegg",
    "url": "https://www.newegg.com/p/pl?d=DDR5+32GB+6000",
    "targetPrice": 80
  }
]
```

## Runtime data (not committed)

- `data/baselines.json` — rolling price stats per watch
- `data/price-history.jsonl` — append-only log of each scraped listing

These files are created on first run and listed in `.gitignore`.

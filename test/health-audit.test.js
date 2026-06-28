const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HEALTH } = require("../src/health/levels");
const { parseLogContent } = require("../src/health/log-parser");
const { evaluateWatchHealth, buildWatchHealthLayer } = require("../src/health/watch-health");
const { buildStoreHealthLayer } = require("../src/health/store-health");
const {
  assessLowestSeenPollution,
  buildDataHealthLayer,
  detectRejectionSpikeForWatch,
} = require("../src/health/data-health");
const {
  buildSystemHealthLayer,
  inspectBaselineFiles,
  STALE_SCAN_WARNING_MINUTES,
} = require("../src/health/system-health");
const { buildHealthReport, formatHealthSection } = require("../src/health/index");
const {
  WATCH,
  SCAN_WINDOW,
  LOG_ALL_GREEN,
  makeHistoryRow,
  makeHealthyBatchHistory,
  makeBaseline,
} = require("./fixtures/health-fixtures");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-health-audit-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  return root;
}

test("all-green fixture: operational layers green, safe to leave alone", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, "data", "baselines.json"), "{}");
  fs.writeFileSync(path.join(root, "data", "product-baselines.json"), "{}");

  const report = buildHealthReport({
    root,
    watchRunning: true,
    now: new Date("2026-06-24T22:57:00.000Z"),
    watches: [WATCH],
    baselines: { "newegg:Test NVMe Watch": makeBaseline() },
    productBaselines: {},
    priceHistoryRows: [makeHistoryRow()],
    logText: LOG_ALL_GREEN,
    telegramConfigured: true,
  });

  assert.equal(report.layers.watch.status, HEALTH.GREEN);
  assert.equal(report.layers.store.status, HEALTH.GREEN);
  assert.equal(report.layers.system.status, HEALTH.GREEN);
  assert.equal(report.operationalStatus, HEALTH.GREEN);
  assert.equal(report.answers.safeToLeaveAlone, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("warning fixture: validation-rate collapse in watch layer", () => {
  const result = evaluateWatchHealth({
    watch: WATCH,
    batchHistory: [
      ...makeHealthyBatchHistory(),
      {
        checkedAt: SCAN_WINDOW.end,
        listingsScraped: 10,
        listingsValid: 2,
        validationRate: 0.2,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: makeBaseline(),
    scanDurationSec: 21.8,
    logEvents: [],
    latestScanWindow: SCAN_WINDOW,
  });

  assert.equal(result.status, HEALTH.WARNING);
  assert.ok(result.issues.some((issue) => issue.code === "validation_rate_drop"));
});

test("critical fixture: zero-scrape streak", () => {
  const result = evaluateWatchHealth({
    watch: WATCH,
    batchHistory: [
      {
        checkedAt: "2026-06-24T22:00:00.000Z",
        listingsScraped: 10,
        listingsValid: 10,
        validationRate: 1,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: "2026-06-24T22:15:00.000Z",
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: "2026-06-24T22:30:00.000Z",
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: makeBaseline({ updatedAt: "2026-06-24T22:00:00.000Z" }),
    scanDurationSec: 21.8,
    logEvents: [],
    latestScanWindow: SCAN_WINDOW,
  });

  assert.equal(result.status, HEALTH.CRITICAL);
  assert.ok(result.issues.some((issue) => issue.code === "zero_scrape"));
  assert.ok(!result.issues.some((issue) => issue.code === "baseline_stale"));
});

test("system health: stale scan is critical, aging scan is warning", () => {
  const stale = buildSystemHealthLayer({
    root: "/tmp/unused",
    watchRunning: true,
    logEvents: parseLogContent(`
[2026-06-24T20:00:00.000Z] Scan started watches=1 headless=true
[2026-06-24T20:00:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
`),
    now: new Date("2026-06-24T22:00:00.000Z"),
    telegramConfigured: true,
  });

  assert.equal(stale.status, HEALTH.CRITICAL);
  assert.ok(stale.issues.some((issue) => issue.code === "stale_scan"));

  const agingRoot = makeTempRoot();
  fs.writeFileSync(path.join(agingRoot, "data", "baselines.json"), "{}");
  fs.writeFileSync(path.join(agingRoot, "data", "product-baselines.json"), "{}");

  const aging = buildSystemHealthLayer({
    root: agingRoot,
    watchRunning: true,
    logEvents: parseLogContent(`
[2026-06-24T22:00:00.000Z] Scan started watches=1 headless=true
[2026-06-24T22:00:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
`),
    now: new Date(
      new Date("2026-06-24T22:00:10.000Z").getTime() +
        STALE_SCAN_WARNING_MINUTES * 60 * 1000 +
        60 * 1000
    ),
    telegramConfigured: true,
  });

  assert.equal(aging.status, HEALTH.WARNING);
  assert.ok(aging.issues.some((issue) => issue.code === "aging_scan"));

  fs.rmSync(agingRoot, { recursive: true, force: true });
});

test("data health: live lowestSeen pollution vs historical-only pollution", () => {
  const watch = WATCH;

  const live = assessLowestSeenPollution({
    watch,
    baselineEntry: { lowestSeen: 104.99 },
    latestBatchRows: [
      makeHistoryRow({
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
      }),
    ],
    allRows: [
      makeHistoryRow({
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
      }),
    ],
  });

  assert.ok(live.livePollution);
  assert.ok(live.historicalPollution);

  const historicalOnly = assessLowestSeenPollution({
    watch,
    baselineEntry: { lowestSeen: 236.99 },
    latestBatchRows: [
      makeHistoryRow({ price: 236.99, title: "SanDisk 2TB NVMe M.2 Internal SSD" }),
    ],
    allRows: [
      makeHistoryRow({ price: 236.99, title: "SanDisk 2TB NVMe M.2 Internal SSD" }),
      {
        watchName: watch.name,
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
      },
    ],
  });

  assert.equal(historicalOnly, null);
});

test("data health layer separates live and historical issues", () => {
  const layer = buildDataHealthLayer({
    watches: [WATCH],
    baselines: {
      "newegg:Test NVMe Watch": { lowestSeen: 236.99 },
    },
    productBaselines: {
      "newegg:newegg:item:OLD": {
        lowestSeen: 104.99,
        averagePrice: 104.99,
        marketSampleSize: 10,
      },
    },
    priceHistoryRows: [
      makeHistoryRow(),
      {
        watchName: WATCH.name,
        productKey: "newegg:item:OLD",
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
        validationPassed: true,
        checkedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    logEvents: parseLogContent(LOG_ALL_GREEN),
  });

  assert.equal(layer.liveStatus, HEALTH.GREEN);
  assert.equal(layer.historicalStatus, HEALTH.WARNING);
  assert.ok(
    layer.issues.some(
      (issue) =>
        issue.scope === "historical" && issue.code === "polluted_product_baselines"
    )
  );
});

test("system health detects corrupt baseline JSON", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, "data", "baselines.json"), "{not-json");

  const inspected = inspectBaselineFiles(root);
  assert.equal(inspected.watchBaselines.parseable, false);

  const layer = buildSystemHealthLayer({
    root,
    watchRunning: true,
    logEvents: parseLogContent(LOG_ALL_GREEN),
    now: new Date("2026-06-24T22:57:00.000Z"),
    telegramConfigured: true,
  });

  assert.ok(layer.issues.some((issue) => issue.code === "baselines_corrupt"));

  fs.rmSync(root, { recursive: true, force: true });
});

test("system health warns when Telegram config is missing", () => {
  const layer = buildSystemHealthLayer({
    root: "/tmp/unused",
    watchRunning: true,
    logEvents: parseLogContent(LOG_ALL_GREEN),
    now: new Date("2026-06-24T22:57:00.000Z"),
    telegramConfigured: false,
  });

  assert.ok(layer.issues.some((issue) => issue.code === "telegram_not_configured"));
});

test("store health independently aggregates watch layer statuses", () => {
  const storeLayer = buildStoreHealthLayer({
    status: HEALTH.CRITICAL,
    watches: [
      {
        store: "newegg",
        status: HEALTH.GREEN,
        issues: [],
        metrics: { scanDurationSec: 10 },
      },
      {
        store: "newegg",
        status: HEALTH.CRITICAL,
        issues: [{ code: "zero_scrape", severity: HEALTH.CRITICAL }],
        metrics: { scanDurationSec: 20 },
      },
    ],
  });

  assert.equal(storeLayer.status, HEALTH.CRITICAL);
  assert.equal(storeLayer.stores[0].criticalWatches, 1);
});

test("watch health layer builds from fixture history and log window", () => {
  const layer = buildWatchHealthLayer({
    watches: [WATCH],
    priceHistoryRows: [makeHistoryRow()],
    baselines: { "newegg:Test NVMe Watch": makeBaseline() },
    logEvents: parseLogContent(LOG_ALL_GREEN),
    scanDurationSec: 21.8,
  });

  assert.equal(layer.watches[0].metrics.listingsScraped, 1);
  assert.equal(layer.status, HEALTH.GREEN);
});

test("rejection spike uses current validation, not stale JSONL flags alone", () => {
  const batches = [
    {
      checkedAt: "2026-06-24T22:00:00.000Z",
      rows: Array.from({ length: 10 }, () =>
        makeHistoryRow({
          checkedAt: "2026-06-24T22:00:00.000Z",
          validationPassed: true,
        })
      ),
    },
    {
      checkedAt: SCAN_WINDOW.end,
      rows: Array.from({ length: 10 }, () =>
        makeHistoryRow({
          validationPassed: true,
          title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
          price: 104.99,
        })
      ),
    },
  ];

  const spike = detectRejectionSpikeForWatch(batches, WATCH.name, WATCH);
  assert.ok(spike);
  assert.equal(spike.scope, "live");
});

test("formatHealthSection labels historical drift separately from operational safety", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, "data", "baselines.json"), "{}");
  fs.writeFileSync(path.join(root, "data", "product-baselines.json"), "{}");

  const report = buildHealthReport({
    root,
    watchRunning: true,
    now: new Date("2026-06-24T22:57:00.000Z"),
    watches: [WATCH],
    baselines: { "newegg:Test NVMe Watch": makeBaseline() },
    productBaselines: {
      "newegg:newegg:item:OLD": {
        lowestSeen: 104.99,
        averagePrice: 104.99,
        marketSampleSize: 10,
      },
    },
    priceHistoryRows: [
      makeHistoryRow(),
      {
        watchName: WATCH.name,
        productKey: "newegg:item:OLD",
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
        validationPassed: true,
        checkedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    logText: LOG_ALL_GREEN,
    telegramConfigured: true,
  });

  const text = formatHealthSection(report).join("\n");
  assert.match(text, /Operational: GREEN/);
  assert.match(text, /Historical JSONL\/baseline drift detected\? yes/i);
  assert.match(text, /Safe to leave alone \(operational only\)\? yes/);
  assert.match(text, /\[historical JSONL\/baseline drift\]/);
  assert.match(text, /shared scan total, not per-watch/);

  fs.rmSync(root, { recursive: true, force: true });
});

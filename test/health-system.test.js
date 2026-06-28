const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HEALTH, worstStatus, statusFromIssues } = require("../src/health/levels");
const {
  parseLogLine,
  parseLogContent,
  getLatestScanEnded,
  countConsecutiveWatchErrors,
} = require("../src/health/log-parser");
const {
  summarizeWatchBatchRows,
  buildWatchBatchHistory,
  countConsecutiveZeroScrapeBatches,
  medianValidationRate,
} = require("../src/health/history-metrics");
const { evaluateWatchHealth } = require("../src/health/watch-health");
const { buildStoreHealthLayer } = require("../src/health/store-health");
const {
  assessLowestSeenPollution,
  detectRejectionSpike,
  detectProductKeyIssues,
} = require("../src/health/data-health");
const { minutesSince, buildSystemHealthLayer } = require("../src/health/system-health");
const { buildHealthReport, formatHealthSection } = require("../src/health/index");
const { extractIssuesFromReport } = require("../src/health/issue-ids");

test("worstStatus picks the most severe health level", () => {
  assert.equal(worstStatus(HEALTH.GREEN, HEALTH.WARNING), HEALTH.WARNING);
  assert.equal(worstStatus(HEALTH.WARNING, HEALTH.CRITICAL), HEALTH.CRITICAL);
  assert.equal(worstStatus(HEALTH.GREEN, HEALTH.GREEN), HEALTH.GREEN);
});

test("statusFromIssues maps issue severities to layer status", () => {
  assert.equal(statusFromIssues([]), HEALTH.GREEN);
  assert.equal(
    statusFromIssues([{ severity: HEALTH.WARNING, code: "x" }]),
    HEALTH.WARNING
  );
  assert.equal(
    statusFromIssues([
      { severity: HEALTH.WARNING, code: "x" },
      { severity: HEALTH.CRITICAL, code: "y" },
    ]),
    HEALTH.CRITICAL
  );
});

test("parseLogLine parses scan lifecycle and watch errors", () => {
  assert.deepEqual(
    parseLogLine(
      "[2026-06-24T22:41:43.200Z] Scan ended durationSec=21.8 watches=9 listingsScraped=90 listingsValid=83 duplicatesCollapsed=1 candidates=9 alerts=0 telegramSends=0"
    ),
    {
      type: "scan_ended",
      timestamp: "2026-06-24T22:41:43.200Z",
      durationSec: 21.8,
      watches: 9,
      listingsScraped: 90,
      listingsValid: 83,
      duplicatesCollapsed: 1,
      candidates: 9,
      alerts: 0,
      telegramSends: 0,
    }
  );

  assert.equal(
    parseLogLine('[2026-06-13T00:50:41.587Z] ERROR watch="DDR5 32GB Newegg Test" page.goto: Timeout')
      ?.type,
    "watch_error"
  );
});

test("countConsecutiveWatchErrors counts trailing failed scans", () => {
  const events = parseLogContent(`
[2026-06-01T00:00:00.000Z] Scan started watches=1 headless=true
[2026-06-01T00:00:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
[2026-06-01T00:15:00.000Z] Scan started watches=1 headless=true
[2026-06-01T00:15:01.000Z] ERROR watch="Test Watch" timeout
[2026-06-01T00:15:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=0 listingsValid=0 duplicatesCollapsed=0 candidates=0 alerts=0 telegramSends=0
[2026-06-01T00:30:00.000Z] Scan started watches=1 headless=true
[2026-06-01T00:30:01.000Z] ERROR watch="Test Watch" timeout again
[2026-06-01T00:30:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=0 listingsValid=0 duplicatesCollapsed=0 candidates=0 alerts=0 telegramSends=0
`);

  assert.equal(countConsecutiveWatchErrors(events, "Test Watch"), 2);
  assert.equal(countConsecutiveWatchErrors(events, "Other Watch"), 0);
});

test("summarizeWatchBatchRows computes validation rate and candidate flag", () => {
  const summary = summarizeWatchBatchRows(
    [
      {
        watchName: "Test Watch",
        checkedAt: "2026-06-01T00:00:00.000Z",
        validationPassed: true,
        isWatchCandidate: true,
        dedupeRole: "kept",
        productKey: "newegg:item:A",
        identityConfidence: "high",
      },
      {
        watchName: "Test Watch",
        checkedAt: "2026-06-01T00:00:00.000Z",
        validationPassed: false,
        isWatchCandidate: false,
        dedupeRole: "not_applicable",
        productKey: "newegg:item:B",
        identityConfidence: "high",
      },
    ],
    "Test Watch"
  );

  assert.equal(summary.listingsScraped, 2);
  assert.equal(summary.listingsValid, 1);
  assert.equal(summary.validationRate, 0.5);
  assert.equal(summary.candidateFound, true);
});

test("evaluateWatchHealth flags validation drop, missing candidate, and zero scrape streak", () => {
  const watch = { name: "Test Watch", store: "newegg" };
  const batchHistory = [
    {
      checkedAt: "2026-06-01T00:00:00.000Z",
      listingsScraped: 10,
      listingsValid: 9,
      validationRate: 0.9,
      candidateFound: true,
      duplicatesCollapsed: 0,
    },
    {
      checkedAt: "2026-06-01T00:15:00.000Z",
      listingsScraped: 0,
      listingsValid: 0,
      validationRate: 0,
      candidateFound: false,
      duplicatesCollapsed: 0,
    },
    {
      checkedAt: "2026-06-01T00:30:00.000Z",
      listingsScraped: 0,
      listingsValid: 0,
      validationRate: 0,
      candidateFound: false,
      duplicatesCollapsed: 0,
    },
  ];

  const critical = evaluateWatchHealth({
    watch,
    batchHistory,
    baselineEntry: { updatedAt: "2026-06-01T00:00:00.000Z" },
    scanDurationSec: 12,
    logEvents: [],
    latestScanWindow: {
      start: "2026-06-01T00:29:00.000Z",
      end: "2026-06-01T00:30:10.000Z",
    },
  });

  assert.equal(critical.status, HEALTH.CRITICAL);
  assert.match(
    critical.issues.map((issue) => issue.code).join(","),
    /zero_scrape/
  );
  assert.ok(!critical.issues.some((issue) => issue.code === "baseline_stale"));

  const warning = evaluateWatchHealth({
    watch,
    batchHistory: [
      ...batchHistory.slice(0, 1),
      {
        checkedAt: "2026-06-01T00:15:00.000Z",
        listingsScraped: 10,
        listingsValid: 4,
        validationRate: 0.4,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-01T00:15:00.000Z" },
    scanDurationSec: 12,
    logEvents: [],
    latestScanWindow: {
      start: "2026-06-01T00:14:00.000Z",
      end: "2026-06-01T00:15:10.000Z",
    },
  });

  assert.equal(warning.status, HEALTH.WARNING);
  assert.match(
    warning.issues.map((issue) => issue.code).join(","),
    /validation_rate_drop|missing_candidate/
  );
});

test("buildStoreHealthLayer aggregates watch statuses by store", () => {
  const storeLayer = buildStoreHealthLayer({
    status: HEALTH.WARNING,
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
  assert.equal(storeLayer.stores[0].totalWatches, 2);
  assert.equal(storeLayer.stores[0].criticalWatches, 1);
  assert.equal(storeLayer.stores[0].averageScanDuration, 15);
});

test("assessLowestSeenPollution detects stale all-time lows", () => {
  const watch = {
    name: "2TB NVMe SSD Newegg Category",
    store: "newegg",
    requirements: {
      storageCapacityTB: 2,
      mustInclude: ["NVMe"],
    },
  };

  const pollution = assessLowestSeenPollution({
    watch,
    baselineEntry: { lowestSeen: 104.99 },
    latestBatchRows: [
      {
        watchName: watch.name,
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
      },
    ],
    allRows: [
      {
        watchName: watch.name,
        price: 104.99,
        title: "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe SSD",
      },
      {
        watchName: watch.name,
        price: 236.99,
        title: "Team Group 2TB NVMe M.2 Internal SSD",
      },
    ],
  });

  assert.ok(pollution);
  assert.equal(pollution.lowestSeen, 104.99);
  assert.equal(pollution.livePollution, true);
});

test("detectRejectionSpike flags sudden increase in rejected listings", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => ({
      watchName: "Test Watch",
      checkedAt: "2026-06-01T00:00:00.000Z",
      validationPassed: index < 9,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      watchName: "Test Watch",
      checkedAt: "2026-06-01T00:15:00.000Z",
      validationPassed: index < 3,
    })),
  ];

  const spike = detectRejectionSpike(rows, "Test Watch", {
    name: "Test Watch",
    requirements: {},
  });
  assert.ok(spike);
  assert.ok(spike.latestRejectionRate > spike.priorMedianRejectionRate);
});

test("detectProductKeyIssues warns on missing productKeys", () => {
  const issue = detectProductKeyIssues(
    [
      { watchName: "Test Watch", productKey: null, identityConfidence: "high" },
      { watchName: "Test Watch", productKey: null, identityConfidence: "high" },
      { watchName: "Test Watch", productKey: "newegg:item:A", identityConfidence: "high" },
    ],
    "Test Watch"
  );

  assert.ok(issue);
  assert.equal(issue.missingProductKey, 2);
});

test("buildSystemHealthLayer marks stale scans and down watch process", () => {
  const now = new Date("2026-06-24T23:00:00.000Z");
  const layer = buildSystemHealthLayer({
    root: "/tmp/unused",
    watchRunning: false,
    logEvents: parseLogContent(`
[2026-06-24T21:00:00.000Z] Scan started watches=1 headless=true
[2026-06-24T21:00:10.000Z] Scan ended durationSec=10 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
`),
    now,
    telegramConfigured: false,
  });

  assert.equal(layer.status, HEALTH.CRITICAL);
  assert.match(
    layer.issues.map((issue) => issue.code).join(","),
    /watch_process_down|stale_scan|telegram_not_configured/
  );
});

test("buildHealthReport and formatHealthSection render all layers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-health-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "data", "products.json"),
    JSON.stringify([
      {
        name: "Test Watch",
        store: "newegg",
        url: "https://example.com",
        requirements: { generation: "DDR5" },
      },
    ])
  );

  fs.writeFileSync(
    path.join(root, "data", "baselines.json"),
    JSON.stringify({
      "newegg:Test Watch": {
        averagePrice: 100,
        marketSampleSize: 5,
        lowestSeen: 90,
        highestSeen: 110,
        updatedAt: "2026-06-24T22:00:00.000Z",
      },
    })
  );

  fs.writeFileSync(path.join(root, "data", "product-baselines.json"), "{}");

  const ym = "2026-06";
  fs.writeFileSync(
    path.join(root, "data", `price-history-${ym}.jsonl`),
    [
      JSON.stringify({
        checkedAt: "2026-06-24T22:00:00.000Z",
        watchName: "Test Watch",
        store: "newegg",
        title: "DDR5 32GB kit",
        price: 100,
        validationPassed: true,
        isWatchCandidate: true,
        productKey: "newegg:item:TEST",
        identityConfidence: "high",
      }),
    ].join("\n")
  );

  const report = buildHealthReport({
    root,
    watchRunning: true,
    now: new Date("2026-06-24T22:05:00.000Z"),
    logText: `
[2026-06-24T22:00:00.000Z] Scan started watches=1 headless=true
[2026-06-24T22:00:05.000Z] Scan ended durationSec=5 watches=1 listingsScraped=1 listingsValid=1 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
`,
    telegramConfigured: true,
  });

  const text = formatHealthSection(report).join("\n");
  assert.match(text, /Overall:/);
  assert.match(text, /Layer 1 — Watch Health:/);
  assert.match(text, /Layer 2 — Store Health:/);
  assert.match(text, /Layer 3 — Data Health:/);
  assert.match(text, /Layer 4 — System Health:/);
  assert.match(text, /Safe to leave alone \(operational only\)\?/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("minutesSince computes elapsed minutes", () => {
  const minutes = minutesSince(
    "2026-06-24T22:00:00.000Z",
    new Date("2026-06-24T22:30:00.000Z")
  );
  assert.equal(minutes, 30);
});

test("medianValidationRate and zero-scrape helpers behave predictably", () => {
  const history = buildWatchBatchHistory(
    [
      {
        watchName: "Test Watch",
        checkedAt: "2026-06-01T00:00:00.000Z",
        validationPassed: true,
      },
      {
        watchName: "Test Watch",
        checkedAt: "2026-06-01T00:15:00.000Z",
        validationPassed: false,
      },
    ],
    "Test Watch"
  );

  assert.equal(medianValidationRate(history), 0.5);
  assert.equal(
    countConsecutiveZeroScrapeBatches([
      { listingsScraped: 10 },
      { listingsScraped: 0 },
      { listingsScraped: 0 },
    ]),
    2
  );
  assert.equal(getLatestScanEnded(parseLogContent("[2026-06-01T00:00:10.000Z] Scan ended durationSec=1 watches=1 listingsScraped=1 listingsValid=1 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0"))?.durationSec, 1);
});

test("zero-scrape watch is not baseline_stale when latest scan returned no listings", () => {
  const watch = { name: "DDR5 32GB Newegg Test", store: "newegg" };
  const latestScanWindow = {
    start: "2026-06-24T23:41:21.465Z",
    end: "2026-06-24T23:41:43.010Z",
  };

  const result = evaluateWatchHealth({
    watch,
    batchHistory: [
      {
        checkedAt: "2026-06-24T23:26:42.243Z",
        listingsScraped: 10,
        listingsValid: 10,
        validationRate: 1,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: latestScanWindow.end,
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-24T23:26:42.243Z" },
    scanDurationSec: 21.5,
    logEvents: [],
    latestScanWindow,
  });

  assert.equal(result.status, HEALTH.WARNING);
  assert.ok(result.issues.some((issue) => issue.code === "zero_scrape"));
  assert.ok(!result.issues.some((issue) => issue.code === "baseline_stale"));
});

test("first zero-scrape scan is WARNING not CRITICAL", () => {
  const watch = { name: "RTX 5070 Ti Newegg Category", store: "newegg" };

  const result = evaluateWatchHealth({
    watch,
    batchHistory: [
      {
        checkedAt: "2026-06-24T23:26:42.243Z",
        listingsScraped: 10,
        listingsValid: 10,
        validationRate: 1,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: "2026-06-24T23:41:43.010Z",
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-24T23:26:42.243Z" },
    scanDurationSec: 21.5,
    logEvents: [],
    latestScanWindow: {
      start: "2026-06-24T23:41:21.465Z",
      end: "2026-06-24T23:41:43.010Z",
    },
  });

  assert.equal(result.status, HEALTH.WARNING);
  const zeroScrape = result.issues.find((issue) => issue.code === "zero_scrape");
  assert.ok(zeroScrape);
  assert.equal(zeroScrape.severity, HEALTH.WARNING);
});

test("repeated zero-scrape becomes CRITICAL", () => {
  const watch = { name: "2TB NVMe SSD Newegg Category", store: "newegg" };

  const result = evaluateWatchHealth({
    watch,
    batchHistory: [
      {
        checkedAt: "2026-06-24T23:11:38.826Z",
        listingsScraped: 10,
        listingsValid: 9,
        validationRate: 0.9,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: "2026-06-24T23:26:42.243Z",
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
      {
        checkedAt: "2026-06-24T23:41:43.010Z",
        listingsScraped: 0,
        listingsValid: 0,
        validationRate: 0,
        candidateFound: false,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-24T23:11:38.826Z" },
    scanDurationSec: 21.5,
    logEvents: [],
    latestScanWindow: {
      start: "2026-06-24T23:41:21.465Z",
      end: "2026-06-24T23:41:43.010Z",
    },
  });

  assert.equal(result.status, HEALTH.CRITICAL);
  const zeroScrape = result.issues.find((issue) => issue.code === "zero_scrape");
  assert.ok(zeroScrape);
  assert.equal(zeroScrape.severity, HEALTH.CRITICAL);
});

test("buildWatchBatchHistory records zero-scrape scan windows without history rows", () => {
  const scanWindows = [
    {
      start: "2026-06-24T23:26:21.464Z",
      end: "2026-06-24T23:26:42.243Z",
    },
    {
      start: "2026-06-24T23:41:21.465Z",
      end: "2026-06-24T23:41:43.010Z",
    },
  ];

  const history = buildWatchBatchHistory(
    [
      {
        watchName: "DDR5 32GB Newegg Test",
        checkedAt: "2026-06-24T23:26:42.243Z",
        validationPassed: true,
        isWatchCandidate: true,
      },
    ],
    "DDR5 32GB Newegg Test",
    8,
    scanWindows
  );

  assert.equal(history.length, 2);
  assert.equal(history[0].listingsScraped, 1);
  assert.equal(history[1].listingsScraped, 0);
  assert.equal(history[1].checkedAt, scanWindows[1].end);
});

test("healthy watches remain GREEN when other watches zero-scrape in same scan", () => {
  const healthy = evaluateWatchHealth({
    watch: { name: "RTX 5080 Newegg Category", store: "newegg" },
    batchHistory: [
      {
        checkedAt: "2026-06-24T23:41:43.010Z",
        listingsScraped: 10,
        listingsValid: 10,
        validationRate: 1,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-24T23:41:43.010Z" },
    scanDurationSec: 21.5,
    logEvents: [],
    latestScanWindow: {
      start: "2026-06-24T23:41:21.465Z",
      end: "2026-06-24T23:41:43.010Z",
    },
  });

  assert.equal(healthy.status, HEALTH.GREEN);
  assert.equal(healthy.issues.length, 0);
});

test("baseline_stale still applies when scrape succeeded with candidate but baseline did not update", () => {
  const watch = { name: "RTX 5080 Newegg Category", store: "newegg" };
  const latestScanWindow = {
    start: "2026-06-24T23:41:21.465Z",
    end: "2026-06-24T23:41:43.010Z",
  };

  const result = evaluateWatchHealth({
    watch,
    batchHistory: [
      {
        checkedAt: latestScanWindow.end,
        listingsScraped: 10,
        listingsValid: 10,
        validationRate: 1,
        candidateFound: true,
        duplicatesCollapsed: 0,
      },
    ],
    baselineEntry: { updatedAt: "2026-06-24T23:26:42.243Z" },
    scanDurationSec: 21.5,
    logEvents: [],
    latestScanWindow,
  });

  assert.equal(result.status, HEALTH.CRITICAL);
  assert.ok(result.issues.some((issue) => issue.code === "baseline_stale"));
  assert.ok(!result.issues.some((issue) => issue.code === "zero_scrape"));
});

test("multiple zero-scrape watches produce one grouped store alert issue ID", () => {
  const report = {
    layers: {
      watch: {
        watches: [
          {
            watchName: "DDR5 32GB Newegg Test",
            store: "newegg",
            issues: [
              {
                code: "zero_scrape",
                severity: HEALTH.WARNING,
                message: "scraped=0 for 1 consecutive scan(s)",
              },
            ],
          },
          {
            watchName: "RTX 5070 Ti Newegg Category",
            store: "newegg",
            issues: [
              {
                code: "zero_scrape",
                severity: HEALTH.WARNING,
                message: "scraped=0 for 1 consecutive scan(s)",
              },
            ],
          },
          {
            watchName: "2TB NVMe SSD Newegg Category",
            store: "newegg",
            issues: [
              {
                code: "zero_scrape",
                severity: HEALTH.WARNING,
                message: "scraped=0 for 1 consecutive scan(s)",
              },
            ],
          },
        ],
      },
      store: {
        stores: [
          {
            store: "newegg",
            status: HEALTH.WARNING,
            failurePatterns: [{ code: "zero_scrape", count: 3 }],
          },
        ],
      },
      system: { issues: [] },
      data: { issues: [] },
    },
  };

  const issues = extractIssuesFromReport(report);

  assert.equal(issues.has("store:newegg:zero_scrape"), true);
  assert.equal(issues.has("watch:newegg:ddr5_32gb:zero_scrape"), false);
  assert.equal(issues.has("watch:newegg:rtx_5070_ti:zero_scrape"), false);
  assert.equal(issues.has("watch:newegg:2tb_nvme_ssd:zero_scrape"), false);
  assert.equal(issues.get("store:newegg:zero_scrape").count, 3);
});

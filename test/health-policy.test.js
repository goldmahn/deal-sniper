const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HEALTH } = require("../src/health/levels");
const { buildHealthReport, applyHealthPolicy } = require("../src/health/index");
const { classifyIssue } = require("../src/health/policy/classify");
const { POLICY_CLASS, CONFIDENCE } = require("../src/health/policy/classes");
const {
  shouldPageImmediately,
  shouldPageWithThreshold,
  isDigestOnlyIssue,
} = require("../src/health/policy/telegram");
const { extractIssuesFromReport } = require("../src/health/issue-ids");
const { processHealthAlerts } = require("../src/health/alerts");
const { buildGreenDigestMessage } = require("../src/health/message-builder");

const DEFAULT_CONFIG = {
  enabled: true,
  dailyDigestHour: 20,
  warningConsecutive: 3,
  warningCooldownMs: 24 * 60 * 60 * 1000,
  criticalCooldownMs: 60 * 60 * 1000,
};

function evening(nowDate = "2026-06-24T20:30:00") {
  return new Date(nowDate);
}

async function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-policy-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });

  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeOperationalCriticalReport(overrides = {}) {
  const report = {
    operationalStatus: HEALTH.CRITICAL,
    overallStatus: HEALTH.CRITICAL,
    layers: {
      watch: {
        status: HEALTH.CRITICAL,
        watches: [
          {
            watchName: "RTX 5070 Ti Newegg Category",
            store: "newegg",
            status: HEALTH.CRITICAL,
            issues: [
              {
                severity: HEALTH.CRITICAL,
                code: "zero_scrape",
                message: "scraped=0 for 2 consecutive scans",
              },
            ],
            metrics: { listingsScraped: 0, listingsValid: 0, duplicatesCollapsed: 0 },
          },
        ],
      },
      store: {
        status: HEALTH.CRITICAL,
        stores: [
          {
            store: "newegg",
            status: HEALTH.CRITICAL,
            failurePatterns: [{ code: "zero_scrape", count: 1 }],
          },
        ],
      },
      data: {
        status: HEALTH.GREEN,
        liveStatus: HEALTH.GREEN,
        historicalStatus: HEALTH.GREEN,
        issues: [],
        metrics: {},
      },
      system: { status: HEALTH.GREEN, issues: [], metrics: {} },
    },
    answers: { safeToLeaveAlone: false },
  };

  return applyHealthPolicy({ ...report, ...overrides });
}

test("QUALITY issues never page", async () => {
  const issue = classifyIssue({
    code: "product_key_quality",
    severity: HEALTH.WARNING,
    scope: "live",
  });

  assert.equal(issue.policyClass, POLICY_CLASS.QUALITY);
  assert.equal(isDigestOnlyIssue({ ...issue, code: "product_key_quality" }), true);
  assert.equal(
    shouldPageImmediately({ ...issue, severity: HEALTH.WARNING, code: "product_key_quality" }),
    false
  );
  assert.equal(
    shouldPageWithThreshold({ ...issue, severity: HEALTH.WARNING, code: "product_key_quality" }),
    false
  );

  await withTempRoot(async (root) => {
    const report = applyHealthPolicy({
      operationalStatus: HEALTH.GREEN,
      overallStatus: HEALTH.WARNING,
      layers: {
        watch: { status: HEALTH.GREEN, watches: [] },
        store: { status: HEALTH.GREEN, stores: [] },
        system: { status: HEALTH.GREEN, issues: [], metrics: {} },
        data: {
          status: HEALTH.WARNING,
          liveStatus: HEALTH.WARNING,
          historicalStatus: HEALTH.GREEN,
          issues: [
            {
              severity: HEALTH.WARNING,
              code: "product_key_quality",
              scope: "live",
              message: "1 watch(es) have missing/low-confidence productKeys in latest batch",
              details: [
                {
                  watchName: "RTX 5080 Newegg Category",
                  missingProductKey: 2,
                  lowIdentity: 0,
                  scraped: 84,
                },
              ],
            },
          ],
          metrics: {},
        },
      },
      answers: { safeToLeaveAlone: true },
    });

    const messages = [];
    const result = await processHealthAlerts({
      report,
      root,
      now: new Date("2026-06-24T19:00:00"),
      config: DEFAULT_CONFIG,
      sendTelegram: async (message) => {
        messages.push(message);
      },
    });

    assert.ok(!result.sent.some((entry) => entry.type === "warning"));
    assert.ok(!result.sent.some((entry) => entry.type === "critical"));
  });
});

test("HISTORICAL issues never page", async () => {
  const issue = classifyIssue({
    code: "polluted_product_baselines",
    severity: HEALTH.WARNING,
    scope: "historical",
  });

  assert.equal(issue.policyClass, POLICY_CLASS.HISTORICAL);
  assert.equal(isDigestOnlyIssue({ ...issue, code: "polluted_product_baselines" }), true);

  await withTempRoot(async (root) => {
    const report = applyHealthPolicy({
      operationalStatus: HEALTH.GREEN,
      overallStatus: HEALTH.WARNING,
      layers: {
        watch: { status: HEALTH.GREEN, watches: [] },
        store: { status: HEALTH.GREEN, stores: [] },
        system: { status: HEALTH.GREEN, issues: [], metrics: {} },
        data: {
          status: HEALTH.WARNING,
          liveStatus: HEALTH.GREEN,
          historicalStatus: HEALTH.WARNING,
          issues: [
            {
              severity: HEALTH.WARNING,
              code: "polluted_product_baselines",
              scope: "historical",
              message:
                "14 product baseline(s) tied to historical JSONL rows failing current validation",
            },
          ],
          metrics: {},
        },
      },
      answers: { safeToLeaveAlone: true },
    });

    const messages = [];
    const result = await processHealthAlerts({
      report,
      root,
      now: new Date("2026-06-24T19:00:00"),
      config: DEFAULT_CONFIG,
      sendTelegram: async (message) => {
        messages.push(message);
      },
    });

    assert.ok(!result.sent.some((entry) => entry.type === "warning"));
    assert.ok(!result.sent.some((entry) => entry.type === "critical"));
  });
});

test("CRITICAL operational pages immediately with medium or high confidence", async () => {
  await withTempRoot(async (root) => {
    const report = makeOperationalCriticalReport();
    const messages = [];
    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram: async (message) => {
        messages.push(message);
      },
    });

    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].type, "critical");
    assert.match(messages[0], /CRITICAL/);
  });
});

test("WARNING operational waits for threshold", async () => {
  await withTempRoot(async (root) => {
    const report = applyHealthPolicy({
      operationalStatus: HEALTH.WARNING,
      overallStatus: HEALTH.WARNING,
      layers: {
        watch: {
          status: HEALTH.WARNING,
          watches: [
            {
              watchName: "RTX 5070 Ti Newegg Category",
              store: "newegg",
              status: HEALTH.WARNING,
              issues: [
                {
                  severity: HEALTH.WARNING,
                  code: "validation_rate_drop",
                  message: "validation rate 40% vs recent median 80%",
                },
              ],
              metrics: { listingsScraped: 10, listingsValid: 4, duplicatesCollapsed: 0 },
            },
          ],
        },
        store: {
          status: HEALTH.GREEN,
          stores: [],
        },
        data: {
          status: HEALTH.GREEN,
          liveStatus: HEALTH.GREEN,
          historicalStatus: HEALTH.GREEN,
          issues: [],
          metrics: {},
        },
        system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      },
      answers: { safeToLeaveAlone: false },
    });

    const messages = [];
    const sendTelegram = async (message) => {
      messages.push(message);
    };

    for (let scan = 1; scan <= 2; scan += 1) {
      const result = await processHealthAlerts({
        report,
        root,
        now: evening(`2026-06-24T20:${10 + scan}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
      assert.equal(result.sent.length, 0);
    }

    const third = await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:13:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(third.sent.length, 1);
    assert.equal(third.sent[0].type, "warning");
  });
});

test("confidence does not affect status reporting", () => {
  const lowConfidenceIssue = {
    severity: HEALTH.WARNING,
    code: "product_key_quality",
    scope: "live",
    message: "quality issue",
    details: [{ missingProductKey: 2, lowIdentity: 0, scraped: 84 }],
  };

  const report = applyHealthPolicy({
    operationalStatus: HEALTH.GREEN,
    overallStatus: HEALTH.WARNING,
    layers: {
      watch: { status: HEALTH.GREEN, watches: [] },
      store: { status: HEALTH.GREEN, stores: [] },
      system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      data: {
        status: HEALTH.WARNING,
        liveStatus: HEALTH.WARNING,
        historicalStatus: HEALTH.GREEN,
        issues: [lowConfidenceIssue],
        metrics: {},
      },
    },
    answers: { safeToLeaveAlone: true },
  });

  assert.equal(report.policy.qualityStatus, HEALTH.WARNING);
  assert.match(
    report.policy.qualityObservations.join("\n"),
    /Identity confidence:/
  );
});

test("confidence DOES affect paging for CRITICAL operational", () => {
  const lowConfidenceCritical = {
    severity: HEALTH.WARNING,
    code: "product_baselines_missing",
    layer: "system",
  };

  const classified = classifyIssue(lowConfidenceCritical);
  assert.equal(classified.policyClass, POLICY_CLASS.WARNING_OPERATIONAL);
  assert.equal(classified.confidence, CONFIDENCE.LOW);

  const highConfidenceCritical = {
    severity: HEALTH.CRITICAL,
    code: "watch_process_down",
    layer: "system",
  };

  const high = classifyIssue(highConfidenceCritical);
  assert.equal(high.policyClass, POLICY_CLASS.CRITICAL_OPERATIONAL);
  assert.equal(high.confidence, CONFIDENCE.HIGH);
  assert.equal(
    shouldPageImmediately({ ...highConfidenceCritical, ...high }),
    true
  );
  assert.equal(
    shouldPageImmediately({ ...lowConfidenceCritical, ...classified }),
    false
  );
});

test("daily digest includes Quality observations", () => {
  const report = applyHealthPolicy({
    operationalStatus: HEALTH.GREEN,
    overallStatus: HEALTH.WARNING,
    layers: {
      watch: {
        status: HEALTH.GREEN,
        watches: [
          {
            watchName: "RTX 5080 Newegg Category",
            store: "newegg",
            status: HEALTH.GREEN,
            issues: [],
            metrics: { listingsScraped: 84, listingsValid: 82, duplicatesCollapsed: 1 },
          },
        ],
      },
      store: { status: HEALTH.GREEN, stores: [] },
      system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      data: {
        status: HEALTH.WARNING,
        liveStatus: HEALTH.WARNING,
        historicalStatus: HEALTH.GREEN,
        issues: [
          {
            severity: HEALTH.WARNING,
            code: "product_key_quality",
            scope: "live",
            message: "1 watch(es) have missing/low-confidence productKeys in latest batch",
            details: [
              {
                watchName: "RTX 5080 Newegg Category",
                missingProductKey: 2,
                lowIdentity: 0,
                scraped: 84,
              },
            ],
          },
        ],
        metrics: {},
      },
    },
    answers: { safeToLeaveAlone: true },
  });

  const digest = buildGreenDigestMessage(report);
  assert.match(digest, /Quality observations/);
  assert.match(digest, /Identity confidence:/);
  assert.match(digest, /Inferred productKeys: 2 of 84 listings/);
});

test("daily digest includes Historical observations", () => {
  const report = applyHealthPolicy({
    operationalStatus: HEALTH.GREEN,
    overallStatus: HEALTH.WARNING,
    layers: {
      watch: { status: HEALTH.GREEN, watches: [] },
      store: { status: HEALTH.GREEN, stores: [] },
      system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      data: {
        status: HEALTH.WARNING,
        liveStatus: HEALTH.GREEN,
        historicalStatus: HEALTH.WARNING,
        issues: [
          {
            severity: HEALTH.WARNING,
            code: "polluted_product_baselines",
            scope: "historical",
            message:
              "14 product baseline(s) tied to historical JSONL rows failing current validation",
          },
        ],
        metrics: {},
      },
    },
    answers: { safeToLeaveAlone: true },
  });

  const digest = buildGreenDigestMessage(report);
  assert.match(digest, /Historical observations/);
  assert.match(digest, /Historical JSONL contains 14 legacy polluted product baseline row/);
});

test("extractIssuesFromReport attaches policy metadata", () => {
  const report = applyHealthPolicy({
    operationalStatus: HEALTH.GREEN,
    overallStatus: HEALTH.WARNING,
    layers: {
      watch: { status: HEALTH.GREEN, watches: [] },
      store: { status: HEALTH.GREEN, stores: [] },
      system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      data: {
        status: HEALTH.WARNING,
        liveStatus: HEALTH.WARNING,
        historicalStatus: HEALTH.GREEN,
        issues: [
          {
            severity: HEALTH.WARNING,
            code: "product_key_quality",
            scope: "live",
            message: "quality",
          },
        ],
        metrics: {},
      },
    },
    answers: { safeToLeaveAlone: true },
  });

  const issues = extractIssuesFromReport(report);
  const quality = issues.get("data:product_key_quality:live");
  assert.equal(quality.policyClass, POLICY_CLASS.QUALITY);
  assert.equal(quality.confidence, CONFIDENCE.LOW);
});

test("buildHealthReport applies policy automatically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-policy-report-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "baselines.json"), "{}");
  fs.writeFileSync(path.join(root, "data", "product-baselines.json"), "{}");

  try {
    const report = buildHealthReport({
      root,
      watchRunning: true,
      now: new Date("2026-06-24T22:57:00.000Z"),
      watches: [],
      baselines: {},
      productBaselines: {},
      priceHistoryRows: [],
      logText:
        "[2026-06-24T22:56:21.467Z] Scan started watches=1 headless=true\n" +
        "[2026-06-24T22:56:43.237Z] Scan ended durationSec=21.8 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0\n",
      telegramConfigured: true,
    });

    assert.ok(report.policy);
    assert.equal(typeof report.policy.qualityStatus, "string");
    assert.equal(typeof report.policy.historicalStatus, "string");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

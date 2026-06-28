const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { HEALTH } = require("../src/health/levels");
const { loadHealthAlertsConfig } = require("../src/health/alerts-config");
const {
  extractIssuesFromReport,
  buildWatchIssueId,
} = require("../src/health/issue-ids");
const {
  readHealthAlertState,
  writeHealthAlertState,
  shouldSendGreenDigest,
  formatHealthAlertsStatusLines,
} = require("../src/health/alert-state");
const {
  getHealthAlertStatePath,
} = require("../src/repositories/health-alert-state-repository");
const { getAlertStatePath } = require("../src/repositories/alert-state-repository");
const { processHealthAlerts } = require("../src/health/alerts");
const { applyHealthPolicy } = require("../src/health/index");

const DEFAULT_CONFIG = {
  enabled: true,
  dailyDigestHour: 20,
  warningConsecutive: 3,
  warningCooldownMs: 24 * 60 * 60 * 1000,
  criticalCooldownMs: 60 * 60 * 1000,
};

function makeReport(overrides = {}) {
  const watchIssues = overrides.watchIssues ?? [];
  const storePatterns = overrides.storePatterns ?? [];
  const systemIssues = overrides.systemIssues ?? [];
  const dataIssues = overrides.dataIssues ?? [];

  const watchStatus =
    overrides.watchStatus ??
    (watchIssues.length > 0 ? watchIssues[0].severity : HEALTH.GREEN);
  const storeStatus =
    overrides.storeStatus ??
    (storePatterns.length > 0 ? HEALTH.WARNING : HEALTH.GREEN);
  const systemStatus =
    overrides.systemStatus ??
    (systemIssues.length > 0 ? systemIssues[0].severity : HEALTH.GREEN);
  const dataStatus =
    overrides.dataStatus ??
    (dataIssues.length > 0 ? dataIssues[0].severity : HEALTH.GREEN);

  const operationalStatus =
    overrides.operationalStatus ??
    [watchStatus, storeStatus, systemStatus].reduce((worst, status) => {
      if (status === HEALTH.CRITICAL) return HEALTH.CRITICAL;
      if (status === HEALTH.WARNING && worst !== HEALTH.CRITICAL) {
        return HEALTH.WARNING;
      }
      return worst;
    }, HEALTH.GREEN);

  return applyHealthPolicy({
    operationalStatus,
    overallStatus: operationalStatus,
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    layers: {
      watch: {
        status: watchStatus,
        watches: [
          {
            watchName: "RTX 5070 Ti Newegg Category",
            store: "newegg",
            status: watchStatus,
            issues: watchIssues,
            metrics: overrides.watchMetrics ?? {},
          },
        ],
      },
      store: {
        status: storeStatus,
        stores: [
          {
            store: "newegg",
            status: storeStatus,
            failurePatterns: storePatterns,
          },
        ],
      },
      data: {
        status: dataStatus,
        liveStatus: overrides.liveStatus ?? dataStatus,
        historicalStatus: overrides.historicalStatus ?? HEALTH.GREEN,
        issues: dataIssues,
        metrics: {},
      },
      system: {
        status: systemStatus,
        issues: systemIssues,
        metrics: {},
      },
    },
    answers: {
      safeToLeaveAlone: operationalStatus === HEALTH.GREEN,
      ...(overrides.answers ?? {}),
    },
  });
}

async function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-alerts-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });

  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function collectTelegram() {
  const messages = [];
  const sendTelegram = async (message) => {
    messages.push(message);
  };

  return { messages, sendTelegram };
}

function evening(nowDate = "2026-06-24T20:30:00") {
  return new Date(nowDate);
}

test("extractIssuesFromReport uses stable deterministic issue IDs", () => {
  const report = makeReport({
    watchIssues: [
      {
        severity: HEALTH.WARNING,
        code: "validation_rate_drop",
        message: "validation rate 40% vs recent median 80%",
      },
    ],
    storePatterns: [{ code: "validation_rate_drop", count: 1 }],
    systemIssues: [
      {
        severity: HEALTH.WARNING,
        code: "stale_scan",
        message: "latest scan is stale",
      },
    ],
    dataIssues: [
      {
        severity: HEALTH.WARNING,
        code: "baseline_lowest_seen_pollution",
        scope: "historical",
        message: "historical pollution",
      },
    ],
  });

  const issues = extractIssuesFromReport(report);

  assert.equal(
    issues.has("watch:newegg:rtx_5070_ti:validation_rate_drop"),
    true
  );
  assert.equal(
    issues.has("store:newegg:validation_rate_drop"),
    true
  );
  assert.equal(issues.has("system:stale_scan"), true);
  assert.equal(issues.has("data:historical_lowest_seen_pollution"), true);
});

test("GREEN digest sends once per day after configured hour", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({ operationalStatus: HEALTH.GREEN });

    const first = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(first.sent.length, 1);
    assert.equal(first.sent[0].type, "green_digest");
    assert.match(messages[0], /🟢 DEAL SNIPER HEALTH/);

    const second = await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T21:00:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(second.sent.length, 0);
    assert.equal(messages.length, 1);
  });
});

test("shouldSendGreenDigest allows next digest on a later day", () => {
  const now = evening("2026-06-25T20:05:00");
  assert.equal(
    shouldSendGreenDigest(now, evening().toISOString(), DEFAULT_CONFIG.dailyDigestHour),
    true
  );
});

test("WARNING notifies only on third consecutive occurrence", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const issue = {
      severity: HEALTH.WARNING,
      code: "validation_rate_drop",
      message: "validation rate 40% vs recent median 80%",
    };
    const report = makeReport({
      watchStatus: HEALTH.WARNING,
      watchIssues: [issue],
      operationalStatus: HEALTH.WARNING,
    });

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
    assert.match(messages[0], /🟡 DEAL SNIPER HEALTH WARNING/);
    assert.match(messages[0], /Consecutive detections/);
    assert.match(messages[0], /3/);
  });
});

test("warning counter resets after recovery without duplicate warning spam", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const warningReport = makeReport({
      watchStatus: HEALTH.WARNING,
      watchIssues: [
        {
          severity: HEALTH.WARNING,
          code: "validation_rate_drop",
          message: "validation rate 40% vs recent median 80%",
        },
      ],
      operationalStatus: HEALTH.WARNING,
    });
    const greenReport = makeReport({ operationalStatus: HEALTH.GREEN });

    for (let scan = 1; scan <= 3; scan += 1) {
      await processHealthAlerts({
        report: warningReport,
        root,
        now: evening(`2026-06-24T20:${10 + scan}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
    }

    assert.equal(messages.filter((text) => text.includes("WARNING")).length, 1);

    await processHealthAlerts({
      report: greenReport,
      root,
      now: evening("2026-06-24T20:14:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(messages.filter((text) => text.includes("RECOVERED")).length, 1);

    for (let scan = 1; scan <= 2; scan += 1) {
      const result = await processHealthAlerts({
        report: warningReport,
        root,
        now: evening(`2026-06-24T20:${14 + scan}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
      assert.equal(result.sent.length, 0);
    }
  });
});

test("CRITICAL notifies immediately", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      watchStatus: HEALTH.CRITICAL,
      watchIssues: [
        {
          severity: HEALTH.CRITICAL,
          code: "zero_scrape",
          message: "scraped=0 for 2 consecutive scans",
        },
      ],
      operationalStatus: HEALTH.CRITICAL,
    });

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].type, "critical");
    assert.match(messages[0], /🔴 DEAL SNIPER HEALTH CRITICAL/);
  });
});

test("CRITICAL respects cooldown for the same issue ID", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      watchStatus: HEALTH.CRITICAL,
      watchIssues: [
        {
          severity: HEALTH.CRITICAL,
          code: "zero_scrape",
          message: "scraped=0 for 2 consecutive scans",
        },
      ],
      operationalStatus: HEALTH.CRITICAL,
    });

    await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:00:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    const duringCooldown = await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:30:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(duringCooldown.sent.length, 0);
    assert.equal(messages.length, 1);

    const afterCooldown = await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T21:01:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(afterCooldown.sent.length, 1);
    assert.equal(messages.length, 2);
  });
});

test("recovery notification sends exactly once and clears issue history", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const warningReport = makeReport({
      watchStatus: HEALTH.WARNING,
      watchIssues: [
        {
          severity: HEALTH.WARNING,
          code: "validation_rate_drop",
          message: "validation rate 40% vs recent median 80%",
        },
      ],
      operationalStatus: HEALTH.WARNING,
    });
    const greenReport = makeReport({ operationalStatus: HEALTH.GREEN });

    for (let scan = 1; scan <= 3; scan += 1) {
      await processHealthAlerts({
        report: warningReport,
        root,
        now: evening(`2026-06-24T20:${10 + scan}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
    }

    await processHealthAlerts({
      report: greenReport,
      root,
      now: evening("2026-06-24T20:14:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    await processHealthAlerts({
      report: greenReport,
      root,
      now: evening("2026-06-24T20:15:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(messages.filter((text) => text.includes("RECOVERED")).length, 1);

    const state = readHealthAlertState(root);
    assert.equal(
      Object.keys(state.issues).length,
      0
    );
  });
});

test("health alert state persists across restart", async () => {
  await withTempRoot(async (root) => {
    const { sendTelegram } = collectTelegram();
    const report = makeReport({
      watchStatus: HEALTH.WARNING,
      watchIssues: [
        {
          severity: HEALTH.WARNING,
          code: "validation_rate_drop",
          message: "validation rate 40% vs recent median 80%",
        },
      ],
      operationalStatus: HEALTH.WARNING,
    });

    await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:10:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    const reloaded = readHealthAlertState(root);
    const issueId = buildWatchIssueId(
      "newegg",
      "RTX 5070 Ti Newegg Category",
      "validation_rate_drop"
    );

    assert.equal(reloaded.issues[issueId].consecutiveScans, 1);

    const resumed = await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:11:00"),
      config: DEFAULT_CONFIG,
      sendTelegram: collectTelegram().sendTelegram,
    });

    assert.equal(
      readHealthAlertState(root).issues[issueId].consecutiveScans,
      2
    );
    assert.equal(resumed.sent.length, 0);
  });
});

test("health alerts stay independent from deal alert state", async () => {
  await withTempRoot((root) => {
    fs.writeFileSync(
      path.join(root, "data", "alert-state.json"),
      JSON.stringify({ listings: { "deal:1": { lastSentAt: "2026-01-01T00:00:00.000Z" } } })
    );

    assert.notEqual(getHealthAlertStatePath(root), getAlertStatePath(root));

    const dealBefore = fs.readFileSync(
      path.join(root, "data", "alert-state.json"),
      "utf8"
    );

    writeHealthAlertState(root, {
      issues: {
        "system:stale_scan": {
          issueId: "system:stale_scan",
          active: true,
          severity: HEALTH.WARNING,
          consecutiveScans: 2,
        },
      },
      lastWarningSentAt: "2026-06-24T20:00:00.000Z",
    });

    const dealAfter = fs.readFileSync(
      path.join(root, "data", "alert-state.json"),
      "utf8"
    );

    assert.equal(dealBefore, dealAfter);
    assert.equal(fs.existsSync(getHealthAlertStatePath(root)), true);
    assert.equal(fs.existsSync(getAlertStatePath(root)), true);
  });
});

test("corrupt health-alert-state.json is handled gracefully", async () => {
  await withTempRoot(async (root) => {
    fs.writeFileSync(getHealthAlertStatePath(root), "{not-json");

    const state = readHealthAlertState(root);
    assert.deepEqual(state.issues, {});

    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({ operationalStatus: HEALTH.GREEN });

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(result.sent.length, 1);
    assert.equal(messages.length, 1);
  });
});

test("disabled health alerts skip all telegram sends", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      watchStatus: HEALTH.CRITICAL,
      watchIssues: [
        {
          severity: HEALTH.CRITICAL,
          code: "zero_scrape",
          message: "scraped=0 for 2 consecutive scans",
        },
      ],
      operationalStatus: HEALTH.CRITICAL,
    });

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: { ...DEFAULT_CONFIG, enabled: false },
      sendTelegram,
    });

    assert.equal(result.skipped, "disabled");
    assert.equal(messages.length, 0);
  });
});

test("formatHealthAlertsStatusLines includes counters and last send timestamps", () => {
  const lines = formatHealthAlertsStatusLines(
    {
      lastGreenDigestAt: "2026-06-24T20:00:00.000Z",
      lastWarningSentAt: "2026-06-24T19:00:00.000Z",
      lastCriticalSentAt: null,
      issues: {
        "watch:newegg:rtx_5070_ti:validation_rate_drop": {
          issueId: "watch:newegg:rtx_5070_ti:validation_rate_drop",
          active: true,
          severity: HEALTH.WARNING,
          consecutiveScans: 2,
        },
      },
    },
    loadHealthAlertsConfig({ HEALTH_ALERTS_ENABLED: "true" })
  );

  assert.match(lines.join("\n"), /Health Alerts/);
  assert.match(lines.join("\n"), /Last GREEN digest: 2026-06-24T20:00:00.000Z/);
  assert.match(lines.join("\n"), /2\/3/);
});

test("loadHealthAlertsConfig reads env defaults", () => {
  const config = loadHealthAlertsConfig({
    HEALTH_ALERTS_ENABLED: "true",
    HEALTH_DAILY_DIGEST_HOUR: "18",
    HEALTH_WARNING_CONSECUTIVE: "5",
    HEALTH_WARNING_COOLDOWN_HOURS: "12",
    HEALTH_CRITICAL_COOLDOWN_MINUTES: "30",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.dailyDigestHour, 18);
  assert.equal(config.warningConsecutive, 5);
  assert.equal(config.warningCooldownMs, 12 * 60 * 60 * 1000);
  assert.equal(config.criticalCooldownMs, 30 * 60 * 1000);
});

test("historical-only polluted product baselines do not send WARNING", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      operationalStatus: HEALTH.GREEN,
      overallStatus: HEALTH.WARNING,
      dataStatus: HEALTH.WARNING,
      historicalStatus: HEALTH.WARNING,
      dataIssues: [
        {
          severity: HEALTH.WARNING,
          code: "polluted_product_baselines",
          scope: "historical",
          message:
            "14 product baseline(s) tied to historical JSONL rows failing current validation",
        },
      ],
    });

    for (let scan = 1; scan <= 3; scan += 1) {
      const result = await processHealthAlerts({
        report,
        root,
        now: evening(`2026-06-24T20:${10 + scan}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
      assert.equal(
        result.sent.filter((entry) => entry.type === "warning").length,
        0
      );
    }

    assert.equal(messages.filter((text) => text.includes("WARNING")).length, 0);
    assert.equal(Object.keys(readHealthAlertState(root).issues).length, 0);
  });
});

test("historical-only issues do not increment warning counters", async () => {
  await withTempRoot(async (root) => {
    const { sendTelegram } = collectTelegram();
    const report = makeReport({
      operationalStatus: HEALTH.GREEN,
      dataIssues: [
        {
          severity: HEALTH.WARNING,
          code: "baseline_lowest_seen_pollution",
          scope: "historical",
          message:
            "2 watch baseline(s) still show historical lowestSeen pollution in JSONL",
        },
      ],
    });

    writeHealthAlertState(root, {
      issues: {
        "data:historical_lowest_seen_pollution": {
          issueId: "data:historical_lowest_seen_pollution",
          active: true,
          severity: HEALTH.WARNING,
          code: "baseline_lowest_seen_pollution",
          layer: "data",
          consecutiveScans: 2,
          firstActiveAt: "2026-06-24T19:00:00.000Z",
          lastActiveAt: "2026-06-24T19:30:00.000Z",
        },
      },
    });

    await processHealthAlerts({
      report,
      root,
      now: evening("2026-06-24T20:10:00"),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    const state = readHealthAlertState(root);
    assert.equal(state.issues["data:historical_lowest_seen_pollution"], undefined);
  });
});

test("daily digest may mention historical warnings", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      operationalStatus: HEALTH.GREEN,
      overallStatus: HEALTH.WARNING,
      dataStatus: HEALTH.WARNING,
      historicalStatus: HEALTH.WARNING,
      dataIssues: [
        {
          severity: HEALTH.WARNING,
          code: "polluted_product_baselines",
          scope: "historical",
          message:
            "14 product baseline(s) tied to historical JSONL rows failing current validation",
        },
      ],
    });

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].type, "green_digest");
    assert.match(messages[0], /Historical warnings only/);
    assert.match(messages[0], /Historical observations/);
    assert.match(
      messages[0],
      /Historical JSONL contains 14 legacy polluted product baseline row/
    );
  });
});

test("live polluted product baselines are QUALITY and never page", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      operationalStatus: HEALTH.GREEN,
      dataStatus: HEALTH.WARNING,
      liveStatus: HEALTH.WARNING,
      dataIssues: [
        {
          severity: HEALTH.WARNING,
          code: "polluted_product_baselines",
          scope: "live",
          message: "2 product baseline(s) in latest scan fail current validation",
        },
      ],
    });

    for (let scan = 1; scan <= 3; scan += 1) {
      const result = await processHealthAlerts({
        report,
        root,
        now: new Date(`2026-06-24T19:${String(10 + scan).padStart(2, "0")}:00`),
        config: DEFAULT_CONFIG,
        sendTelegram,
      });
      assert.ok(!result.sent.some((entry) => entry.type === "warning"));
      assert.ok(!result.sent.some((entry) => entry.type === "critical"));
    }

    assert.ok(!messages.some((text) => text.includes("WARNING")));
    assert.ok(!messages.some((text) => text.includes("CRITICAL")));
  });
});

test("live CRITICAL still fires immediately for non-historical issues", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const report = makeReport({
      watchStatus: HEALTH.CRITICAL,
      watchIssues: [
        {
          severity: HEALTH.CRITICAL,
          code: "zero_scrape",
          message: "scraped=0 for 2 consecutive scans",
        },
      ],
      operationalStatus: HEALTH.CRITICAL,
      dataIssues: [
        {
          severity: HEALTH.WARNING,
          code: "polluted_product_baselines",
          scope: "historical",
          message:
            "14 product baseline(s) tied to historical JSONL rows failing current validation",
        },
      ],
    });

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].type, "critical");
    assert.match(messages[0], /CRITICAL/);
    assert.equal(messages.filter((text) => text.includes("WARNING")).length, 0);
  });
});

test("multiple zero-scrape watches send one grouped store critical alert", async () => {
  await withTempRoot(async (root) => {
    const { messages, sendTelegram } = collectTelegram();
    const zeroScrapeIssue = {
      severity: HEALTH.CRITICAL,
      code: "zero_scrape",
      message: "scraped=0 for 2 consecutive scans",
    };
    const report = {
      operationalStatus: HEALTH.CRITICAL,
      overallStatus: HEALTH.CRITICAL,
      layers: {
        watch: {
          status: HEALTH.CRITICAL,
          watches: [
            {
              watchName: "DDR5 32GB Newegg Test",
              store: "newegg",
              status: HEALTH.CRITICAL,
              issues: [zeroScrapeIssue],
              metrics: {},
            },
            {
              watchName: "RTX 5070 Ti Newegg Category",
              store: "newegg",
              status: HEALTH.CRITICAL,
              issues: [zeroScrapeIssue],
              metrics: {},
            },
            {
              watchName: "2TB NVMe SSD Newegg Category",
              store: "newegg",
              status: HEALTH.CRITICAL,
              issues: [zeroScrapeIssue],
              metrics: {},
            },
          ],
        },
        store: {
          status: HEALTH.CRITICAL,
          stores: [
            {
              store: "newegg",
              status: HEALTH.CRITICAL,
              failurePatterns: [{ code: "zero_scrape", count: 3 }],
            },
          ],
        },
        data: {
          status: HEALTH.GREEN,
          liveStatus: HEALTH.GREEN,
          historicalStatus: HEALTH.GREEN,
          issues: [],
        },
        system: { status: HEALTH.GREEN, issues: [], metrics: {} },
      },
      answers: { safeToLeaveAlone: false },
    };

    const result = await processHealthAlerts({
      report,
      root,
      now: evening(),
      config: DEFAULT_CONFIG,
      sendTelegram,
    });

    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0].type, "critical");
    assert.equal(result.sent[0].issueId, "store:newegg:zero_scrape");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Affected watches/);
  });
});

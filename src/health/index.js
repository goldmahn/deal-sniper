require("dotenv").config();

const fs = require("fs");

const { HEALTH, worstStatus } = require("./levels");
const { parseLogContent } = require("./log-parser");
const { yearMonth } = require("../monthly-paths");
const { buildWatchHealthLayer } = require("./watch-health");
const { buildStoreHealthLayer } = require("./store-health");
const { buildDataHealthLayer } = require("./data-health");
const { buildSystemHealthLayer } = require("./system-health");
const { loadPriceHistoryRows } = require("./history-metrics");
const { loadWatches } = require("../repositories/watches-repository");
const { readBaselines } = require("../repositories/baseline-repository");
const { readProductBaselines } = require("../repositories/product-baseline-repository");
const { readRecentLogTail } = require("../status-health");
const { getLogPath } = require("../logger");
const { applyHealthPolicy, formatPolicyStatusSection } = require("./policy");

function buildHealthReport({
  root,
  watchRunning,
  now = new Date(),
  logText,
  priceHistoryRows,
  watches,
  baselines,
  productBaselines,
  telegramConfigured = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
  ),
}) {
  const resolvedWatches = watches ?? loadWatches(root);
  const resolvedBaselines = baselines ?? readBaselines(root);
  const resolvedProductBaselines = productBaselines ?? readProductBaselines(root);
  const resolvedHistory =
    priceHistoryRows ?? loadPriceHistoryRows(root, yearMonth(now));
  const resolvedLogText =
    logText ?? readRecentLogTail(getLogPath(), 2000);
  const logEvents = parseLogContent(resolvedLogText);
  const latestScan = logEvents.filter((event) => event.type === "scan_ended").pop();

  const watchLayer = buildWatchHealthLayer({
    watches: resolvedWatches,
    priceHistoryRows: resolvedHistory,
    baselines: resolvedBaselines,
    logEvents,
    scanDurationSec: latestScan?.durationSec ?? null,
  });

  const storeLayer = buildStoreHealthLayer(watchLayer);
  const dataLayer = buildDataHealthLayer({
    watches: resolvedWatches,
    baselines: resolvedBaselines,
    productBaselines: resolvedProductBaselines,
    priceHistoryRows: resolvedHistory,
    logEvents,
  });

  const systemLayer = buildSystemHealthLayer({
    root,
    watchRunning,
    logEvents,
    now,
    telegramConfigured,
  });

  const operationalStatus = worstStatus(
    watchLayer.status,
    storeLayer.status,
    systemLayer.status
  );

  const overallStatus = worstStatus(operationalStatus, dataLayer.status);

  return applyHealthPolicy({
    overallStatus,
    operationalStatus,
    generatedAt: now.toISOString(),
    layers: {
      watch: watchLayer,
      store: storeLayer,
      data: dataLayer,
      system: systemLayer,
    },
    answers: {
      botRunning: systemLayer.metrics.watchProcessRunning,
      watchesNormal: watchLayer.status === HEALTH.GREEN,
      storesHealthy: storeLayer.status === HEALTH.GREEN,
      liveDataTrustworthy: dataLayer.liveStatus === HEALTH.GREEN,
      historicalDataDrift: dataLayer.historicalStatus !== HEALTH.GREEN,
      dataTrustworthy: dataLayer.status === HEALTH.GREEN,
      safeToLeaveAlone: operationalStatus === HEALTH.GREEN,
    },
  });
}

function formatPercent(rate) {
  if (rate == null || !Number.isFinite(rate)) {
    return "n/a";
  }

  return `${(rate * 100).toFixed(0)}%`;
}

function formatIssueScope(issue) {
  if (issue.scope === "live") {
    return "[live]";
  }
  if (issue.scope === "historical") {
    return "[historical JSONL/baseline drift]";
  }
  return "";
}

function formatHealthSection(report) {
  const lines = [];

  if (report.policy) {
    lines.push(...formatPolicyStatusSection(report));
    lines.push("");
  }

  lines.push(
    "--- Health ---",
    `Operational: ${report.operationalStatus}`,
    `Data integrity: ${report.layers.data.status} (live=${report.layers.data.liveStatus}, historical=${report.layers.data.historicalStatus})`,
    `Overall: ${report.overallStatus}`,
    ""
  );

  lines.push("Quick answers:");
  lines.push(
    `  1. Bot running? ${report.answers.botRunning ? "yes" : "NO"}`
  );
  lines.push(
    `  2. Watches normal (latest scan window)? ${report.answers.watchesNormal ? "yes" : "NO"} (${report.layers.watch.status})`
  );
  lines.push(
    `  3. Stores healthy? ${report.answers.storesHealthy ? "yes" : "NO"} (${report.layers.store.status})`
  );
  lines.push(
    `  4. Live pricing data trustworthy? ${report.answers.liveDataTrustworthy ? "yes" : "NO"} (${report.layers.data.liveStatus})`
  );
  lines.push(
    `  5. Historical JSONL/baseline drift detected? ${report.answers.historicalDataDrift ? "yes" : "no"} (${report.layers.data.historicalStatus})`
  );
  lines.push(
    `  6. Safe to leave alone (operational only)? ${report.answers.safeToLeaveAlone ? "yes" : "NO"}`
  );
  lines.push("");
  lines.push(
    "Note: Layer 1-2-4 reflect the latest scan/log window. Layer 3 may include historical JSONL drift that does not mean current scraping is broken."
  );
  lines.push("");

  lines.push(`Layer 1 — Watch Health: ${report.layers.watch.status}`);
  lines.push("  Source: latest log scan window + price-history rows in that window");
  for (const watch of report.layers.watch.watches) {
    const metrics = watch.metrics;
    lines.push(
      `  ${watch.watchName} [${watch.status}] scraped=${metrics.listingsScraped} valid=${metrics.listingsValid} rate=${formatPercent(metrics.validationRate)} candidate=${metrics.candidateFound ? "yes" : "no"} baselineUpdated=${metrics.baselineUpdated ? "yes" : "no"} failures=${metrics.consecutiveFailures}`
    );
    lines.push(
      `    scanDurationSec=${metrics.scanDurationSec ?? "n/a"} (shared scan total, not per-watch)`
    );
    for (const issue of watch.issues) {
      lines.push(`    - ${issue.severity}: ${issue.message}`);
    }
  }
  lines.push("");

  lines.push(`Layer 2 — Store Health: ${report.layers.store.status}`);
  for (const store of report.layers.store.stores) {
    lines.push(
      `  ${store.store} [${store.status}] watches=${store.totalWatches} healthy=${store.healthyWatches} warning=${store.warningWatches} critical=${store.criticalWatches} avgDurationSec=${store.averageScanDuration ?? "n/a"}`
    );
    if (store.failurePatterns.length > 0) {
      lines.push(
        `    patterns: ${store.failurePatterns.map((entry) => `${entry.code}(${entry.count})`).join(", ")}`
      );
    }
  }
  lines.push("");

  lines.push(`Layer 3 — Data Health: ${report.layers.data.status}`);
  if (report.layers.data.issues.length === 0) {
    lines.push("  No live or historical data integrity issues detected in current inputs.");
  } else {
    for (const issue of report.layers.data.issues) {
      lines.push(
        `  - ${formatIssueScope(issue)} ${issue.severity}: ${issue.message}`
      );
    }
  }
  lines.push("");

  lines.push(`Layer 4 — System Health: ${report.layers.system.status}`);
  const system = report.layers.system.metrics;
  lines.push(
    `  watchProcess=${system.watchProcessRunning ? "running" : "down"} latestScanAgeMin=${system.latestScanAgeMinutes == null ? "n/a" : system.latestScanAgeMinutes.toFixed(1)} priceHistoryWritable=${system.priceHistoryWritable ? "yes" : "no"} baselinesReadable=${system.baselinesReadable ? "yes" : "no"} productBaselinesReadable=${system.productBaselinesReadable ? "yes" : "no"} telegramConfigured=${system.telegramConfigured ? "yes" : "no"}`
  );
  for (const issue of report.layers.system.issues) {
    lines.push(`  - ${issue.severity}: ${issue.message}`);
  }

  return lines;
}

module.exports = {
  buildHealthReport,
  formatHealthSection,
  applyHealthPolicy,
  formatPolicyStatusSection,
};

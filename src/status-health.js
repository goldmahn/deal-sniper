require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { MIN_PRODUCT_SAMPLES } = require("./anomaly-engine");
const {
  getProductBaselinesPath,
  PRODUCT_BASELINES_FILE,
} = require("./repositories/product-baseline-repository");

const ANOMALY_LOG_MARKER = "PRICING ANOMALY";
const MANUAL_LOG_MARKER = "MANUAL PRICE TARGET";

function summarizeProductBaselines(baselines, minSamples = MIN_PRODUCT_SAMPLES) {
  const entries = Object.entries(baselines ?? {});

  if (entries.length === 0) {
    return {
      count: 0,
      qualifiedCount: 0,
      minSamples,
      maxSampleSize: 0,
      priceVariedCount: 0,
      top5: [],
      mostRecentUpdatedAt: null,
    };
  }

  const qualifiedCount = entries.filter(
    ([, entry]) => entry.marketSampleSize >= minSamples
  ).length;

  const maxSampleSize = Math.max(
    ...entries.map(([, entry]) => entry.marketSampleSize ?? 0)
  );

  const priceVariedCount = entries.filter(
    ([, entry]) => entry.lowestSeen !== entry.highestSeen
  ).length;

  const top5 = entries
    .map(([key, entry]) => ({
      key,
      marketSampleSize: entry.marketSampleSize ?? 0,
      averagePrice: entry.averagePrice ?? null,
      lowestSeen: entry.lowestSeen ?? null,
      highestSeen: entry.highestSeen ?? null,
      updatedAt: entry.updatedAt ?? null,
    }))
    .sort((a, b) => b.marketSampleSize - a.marketSampleSize)
    .slice(0, 5);

  const mostRecentUpdatedAt = entries.reduce((latest, [, entry]) => {
    if (!entry.updatedAt) {
      return latest;
    }
    if (!latest || entry.updatedAt > latest) {
      return entry.updatedAt;
    }
    return latest;
  }, null);

  return {
    count: entries.length,
    qualifiedCount,
    minSamples,
    maxSampleSize,
    priceVariedCount,
    top5,
    mostRecentUpdatedAt,
  };
}

function loadProductBaselinesSummary(root, minSamples = MIN_PRODUCT_SAMPLES) {
  const baselinesPath = getProductBaselinesPath(root);

  if (!fs.existsSync(baselinesPath)) {
    return { exists: false, summary: null, error: null };
  }

  try {
    const baselines = JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
    return {
      exists: true,
      summary: summarizeProductBaselines(baselines, minSamples),
      error: null,
    };
  } catch (error) {
    return { exists: true, summary: null, error: error.message };
  }
}

function readRecentLogTail(filePath, maxLines = 500) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const lines = fs.readFileSync(filePath, "utf8").trimEnd().split("\n");
  return lines.slice(-maxLines).join("\n");
}

function scanLogTextForAlertTypes(text) {
  const content = text ?? "";

  return {
    hasAnomaly: content.includes(ANOMALY_LOG_MARKER),
    hasManual: content.includes(MANUAL_LOG_MARKER),
  };
}

function scanLogFilesForAlertTypes(logTexts) {
  return (logTexts ?? []).reduce(
    (acc, text) => {
      const found = scanLogTextForAlertTypes(text);
      return {
        hasAnomaly: acc.hasAnomaly || found.hasAnomaly,
        hasManual: acc.hasManual || found.hasManual,
      };
    },
    { hasAnomaly: false, hasManual: false }
  );
}

function formatProductBaselineKey(key) {
  const match = String(key).match(/item:([^:]+)$/);
  return match ? match[1] : key;
}

function formatAlertPresence(label, present) {
  return `${label}: ${present ? "seen in recent logs" : "not seen in recent logs"}`;
}

function buildAnomalyEngineHealthLines({
  root,
  minSamples = MIN_PRODUCT_SAMPLES,
  logTexts = [],
}) {
  const lines = ["--- Anomaly Engine / product baselines ---"];
  const loaded = loadProductBaselinesSummary(root, minSamples);

  if (!loaded.exists) {
    lines.push(`${PRODUCT_BASELINES_FILE}: missing`);
  } else if (loaded.error) {
    lines.push(`${PRODUCT_BASELINES_FILE}: present (failed to read: ${loaded.error})`);
  } else {
    const { summary } = loaded;
    lines.push(`${PRODUCT_BASELINES_FILE}: present (${summary.count} products)`);
    lines.push(
      `Qualified for product-level anomaly (>=${summary.minSamples} samples): ${summary.qualifiedCount}/${summary.count}`
    );
    lines.push(`Max product sample size: ${summary.maxSampleSize}`);
    lines.push(
      `Products with price variation (low != high): ${summary.priceVariedCount}`
    );
    lines.push(
      `Most recent product baseline update: ${summary.mostRecentUpdatedAt ?? "(none)"}`
    );

    if (summary.top5.length === 0) {
      lines.push("Top 5 by sample size: (none)");
    } else {
      lines.push("Top 5 by sample size:");
      for (const entry of summary.top5) {
        const label = formatProductBaselineKey(entry.key);
        const avg =
          entry.averagePrice == null ? "n/a" : `$${entry.averagePrice}`;
        lines.push(`  ${label} samples=${entry.marketSampleSize} avg=${avg}`);
      }
    }
  }

  const alerts = scanLogFilesForAlertTypes(logTexts);
  lines.push(formatAlertPresence(ANOMALY_LOG_MARKER, alerts.hasAnomaly));
  lines.push(formatAlertPresence(MANUAL_LOG_MARKER, alerts.hasManual));

  return lines;
}

function collectRecentAlertLogTexts(root, { maxLines = 500, monthLogPath } = {}) {
  const logPaths = [
    monthLogPath,
    path.join(root, "logs", "launchd.out.log"),
    path.join(root, "logs", "launchd.err.log"),
  ].filter(Boolean);

  return logPaths.map((logPath) => readRecentLogTail(logPath, maxLines));
}

module.exports = {
  summarizeProductBaselines,
  loadProductBaselinesSummary,
  readRecentLogTail,
  scanLogTextForAlertTypes,
  scanLogFilesForAlertTypes,
  formatProductBaselineKey,
  buildAnomalyEngineHealthLines,
  collectRecentAlertLogTexts,
  ANOMALY_LOG_MARKER,
  MANUAL_LOG_MARKER,
};

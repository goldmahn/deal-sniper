const fs = require("fs");
const path = require("path");

const { HEALTH, statusFromIssues } = require("./levels");
const { priceHistoryPath, dealsniperLogPath, yearMonth } = require("../monthly-paths");
const { getBaselinesPath } = require("../repositories/baseline-repository");
const { getProductBaselinesPath } = require("../repositories/product-baseline-repository");
const { getLatestScanEnded } = require("./log-parser");
const { inspectBaselineFiles } = require("./baseline-files");

const STALE_SCAN_WARNING_MINUTES = 30;
const STALE_SCAN_CRITICAL_MINUTES = 60;
const LARGE_LOG_WARNING_BYTES = 50 * 1024 * 1024;

function minutesSince(isoTimestamp, now = new Date()) {
  if (!isoTimestamp) {
    return null;
  }

  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) {
    return null;
  }

  return (now.getTime() - then) / (60 * 1000);
}

function checkReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function checkWritable(filePath) {
  try {
    const directory = path.dirname(filePath);
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function buildSystemHealthLayer({
  root,
  watchRunning,
  logEvents,
  now = new Date(),
  telegramConfigured,
}) {
  const issues = [];
  const ym = yearMonth(now);
  const historyPath = priceHistoryPath(root, ym);
  const logPath = dealsniperLogPath(root, ym);
  const baselinesPath = getBaselinesPath(root);
  const productBaselinesPath = getProductBaselinesPath(root);
  const latestScan = getLatestScanEnded(logEvents);
  const latestScanAgeMinutes = minutesSince(latestScan?.timestamp, now);

  if (!watchRunning) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "watch_process_down",
      message: "watch process is not running",
    });
  }

  if (latestScanAgeMinutes == null) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "no_recent_scan",
      message: "no completed scan found in logs",
    });
  } else if (latestScanAgeMinutes >= STALE_SCAN_CRITICAL_MINUTES) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "stale_scan",
      message: `latest scan is ${latestScanAgeMinutes.toFixed(0)} minutes old`,
    });
  } else if (latestScanAgeMinutes >= STALE_SCAN_WARNING_MINUTES) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "aging_scan",
      message: `latest scan is ${latestScanAgeMinutes.toFixed(0)} minutes old`,
    });
  }

  const priceHistoryWritable = checkWritable(historyPath);
  const baselineFiles = inspectBaselineFiles(root);
  const baselinesReadable =
    baselineFiles.watchBaselines.readable && baselineFiles.watchBaselines.parseable;
  const productBaselinesReadable =
    baselineFiles.productBaselines.readable &&
    baselineFiles.productBaselines.parseable;

  if (!priceHistoryWritable) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "price_history_not_writable",
      message: "monthly price-history directory is not writable",
    });
  }

  if (!baselineFiles.watchBaselines.exists) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "baselines_missing",
      message: "baselines.json is missing",
    });
  } else if (!baselineFiles.watchBaselines.parseable) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "baselines_corrupt",
      message: `baselines.json is not valid JSON (${baselineFiles.watchBaselines.error})`,
    });
  } else if (!baselineFiles.watchBaselines.readable) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "baselines_not_readable",
      message: "baselines.json is not readable",
    });
  }

  if (!baselineFiles.productBaselines.exists) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "product_baselines_missing",
      message: "product-baselines.json is missing",
    });
  } else if (!baselineFiles.productBaselines.parseable) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "product_baselines_corrupt",
      message: `product-baselines.json is not valid JSON (${baselineFiles.productBaselines.error})`,
    });
  } else if (!baselineFiles.productBaselines.readable) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "product_baselines_not_readable",
      message: "product-baselines.json is not readable",
    });
  }

  if (!telegramConfigured) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "telegram_not_configured",
      message: "Telegram env vars are missing",
    });
  }

  let logSizeBytes = null;
  if (fs.existsSync(logPath)) {
    logSizeBytes = fs.statSync(logPath).size;
    if (logSizeBytes >= LARGE_LOG_WARNING_BYTES) {
      issues.push({
        severity: HEALTH.WARNING,
        code: "large_log_file",
        message: `monthly log is ${(logSizeBytes / (1024 * 1024)).toFixed(1)} MB`,
      });
    }
  }

  return {
    status: statusFromIssues(issues),
    issues,
    metrics: {
      watchProcessRunning: watchRunning,
      latestScanAt: latestScan?.timestamp ?? null,
      latestScanAgeMinutes,
      priceHistoryWritable,
      baselinesReadable,
      productBaselinesReadable,
      baselineFiles,
      telegramConfigured,
      logSizeBytes,
    },
  };
}

module.exports = {
  STALE_SCAN_WARNING_MINUTES,
  STALE_SCAN_CRITICAL_MINUTES,
  LARGE_LOG_WARNING_BYTES,
  minutesSince,
  checkReadable,
  checkWritable,
  buildSystemHealthLayer,
  inspectBaselineFiles,
};

const { HEALTH, statusFromIssues } = require("./levels");
const { countConsecutiveWatchErrors } = require("./log-parser");
const {
  buildWatchBatchHistory,
  countConsecutiveZeroScrapeBatches,
  getScanWindowsFromEvents,
  medianValidationRate,
  latestSuccessfulScanAt,
} = require("./history-metrics");

const VALIDATION_RATE_DROP_THRESHOLD = 0.25;
const ZERO_SCRAPE_CRITICAL_THRESHOLD = 2;

function evaluateWatchHealth({
  watch,
  batchHistory,
  baselineEntry,
  scanDurationSec,
  logEvents = [],
  latestScanWindow = null,
}) {
  const latest = batchHistory[batchHistory.length - 1] ?? null;
  const issues = [];

  const listingsScraped = latest?.listingsScraped ?? 0;
  const listingsValid = latest?.listingsValid ?? 0;
  const validationRate = latest?.validationRate ?? 0;
  const duplicatesCollapsed = latest?.duplicatesCollapsed ?? 0;
  const candidateFound = latest?.candidateFound ?? false;
  const consecutiveZeroScrape = countConsecutiveZeroScrapeBatches(batchHistory);
  const consecutiveLogErrors = countConsecutiveWatchErrors(logEvents, watch.name);
  const consecutiveFailures = Math.max(consecutiveZeroScrape, consecutiveLogErrors);
  const lastSuccessfulScanAt = latestSuccessfulScanAt(batchHistory);
  const baselineUpdated =
    baselineEntry?.updatedAt != null &&
    latestScanWindow != null &&
    baselineEntry.updatedAt >= latestScanWindow.start &&
    baselineEntry.updatedAt <= latestScanWindow.end;

  const latestIsZeroScrape = listingsScraped === 0;

  if (consecutiveZeroScrape >= ZERO_SCRAPE_CRITICAL_THRESHOLD) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "zero_scrape",
      message: `scraped=0 for ${consecutiveZeroScrape} consecutive scans`,
    });
  } else if (latestIsZeroScrape || consecutiveZeroScrape > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "zero_scrape",
      message: `scraped=0 for ${Math.max(consecutiveZeroScrape, 1)} consecutive scan(s)`,
    });
  }

  if (
    !latestIsZeroScrape &&
    listingsScraped > 0 &&
    listingsValid > 0 &&
    candidateFound &&
    latest?.checkedAt &&
    !baselineUpdated
  ) {
    issues.push({
      severity: HEALTH.CRITICAL,
      code: "baseline_stale",
      message: "baseline did not update after latest successful scrape",
    });
  }

  const referenceRate = medianValidationRate(batchHistory.slice(0, -1));
  if (
    referenceRate != null &&
    listingsScraped > 0 &&
    validationRate + VALIDATION_RATE_DROP_THRESHOLD < referenceRate
  ) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "validation_rate_drop",
      message: `validation rate ${(validationRate * 100).toFixed(0)}% vs recent median ${(referenceRate * 100).toFixed(0)}%`,
    });
  }

  if (listingsScraped > 0 && listingsValid > 0 && !candidateFound) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "missing_candidate",
      message: "valid listings present but no candidate selected",
    });
  }

  if (consecutiveLogErrors > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "recent_watch_errors",
      message: `${consecutiveLogErrors} consecutive scan(s) with errors in logs`,
    });
  }

  return {
    watchName: watch.name,
    store: watch.store,
    status: statusFromIssues(issues),
    issues,
    metrics: {
      listingsScraped,
      listingsValid,
      validationRate,
      duplicatesCollapsed,
      candidateFound,
      baselineUpdated,
      scanDurationSec: scanDurationSec ?? null,
      consecutiveFailures,
      consecutiveZeroScrape,
      consecutiveLogErrors,
      lastSuccessfulScanAt,
      baselineUpdatedAt: baselineEntry?.updatedAt ?? null,
    },
  };
}

function buildWatchHealthLayer({ watches, priceHistoryRows, baselines, logEvents, scanDurationSec }) {
  const scanWindows = getScanWindowsFromEvents(logEvents);
  const latestScanWindow = scanWindows[scanWindows.length - 1] ?? null;

  const watchHealth = watches.map((watch) => {
    const batchHistory = buildWatchBatchHistory(
      priceHistoryRows,
      watch.name,
      8,
      scanWindows
    );
    const baselineKey = `${watch.store}:${watch.name}`;
    return evaluateWatchHealth({
      watch,
      batchHistory,
      baselineEntry: baselines[baselineKey] ?? null,
      scanDurationSec,
      logEvents,
      latestScanWindow,
    });
  });

  return {
    status: statusFromIssues(watchHealth.flatMap((entry) => entry.issues)),
    watches: watchHealth,
  };
}

module.exports = {
  VALIDATION_RATE_DROP_THRESHOLD,
  ZERO_SCRAPE_CRITICAL_THRESHOLD,
  evaluateWatchHealth,
  buildWatchHealthLayer,
};

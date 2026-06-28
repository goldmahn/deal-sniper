const fs = require("fs");
const path = require("path");

const { yearMonth, priceHistoryPath } = require("../monthly-paths");

function getScanWindowsFromEvents(events) {
  const windows = [];

  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== "scan_started") {
      continue;
    }

    const ended = events
      .slice(index + 1)
      .find((event) => event.type === "scan_ended");

    if (ended) {
      windows.push({
        start: events[index].timestamp,
        end: ended.timestamp,
        durationSec: ended.durationSec,
      });
    }
  }

  return windows;
}

function rowsInScanWindow(rows, window) {
  if (!window) {
    return rows;
  }

  return rows.filter(
    (row) => row.checkedAt >= window.start && row.checkedAt <= window.end
  );
}

function latestScanWindow(events) {
  const windows = getScanWindowsFromEvents(events);
  return windows.length > 0 ? windows[windows.length - 1] : null;
}

function loadPriceHistoryRows(root, ym = yearMonth()) {
  const historyPath = priceHistoryPath(root, ym);
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, "utf8").trim();
  if (!content) {
    return [];
  }

  return content.split("\n").map((line) => JSON.parse(line));
}

function groupRowsByBatch(rows, scanWindows = null) {
  if (scanWindows && scanWindows.length > 0) {
    return scanWindows.map((window) => ({
      checkedAt: window.end,
      rows: rowsInScanWindow(rows, window),
      window,
    }));
  }

  const batches = new Map();

  for (const row of rows) {
    if (!batches.has(row.checkedAt)) {
      batches.set(row.checkedAt, []);
    }
    batches.get(row.checkedAt).push(row);
  }

  return [...batches.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([checkedAt, batchRows]) => ({ checkedAt, rows: batchRows }));
}

function summarizeWatchBatchRows(rows, watchName) {
  const watchRows = rows.filter((row) => row.watchName === watchName);
  const scraped = watchRows.length;
  const valid = watchRows.filter((row) => row.validationPassed).length;
  const validationRate = scraped > 0 ? valid / scraped : 0;
  const candidateFound = watchRows.some((row) => row.isWatchCandidate);
  const duplicatesCollapsed = watchRows.filter(
    (row) => row.dedupeRole === "duplicate"
  ).length;
  const missingProductKey = watchRows.filter((row) => !row.productKey).length;
  const lowIdentity = watchRows.filter(
    (row) => row.identityConfidence === "low"
  ).length;

  return {
    watchName,
    checkedAt: watchRows[0]?.checkedAt ?? null,
    listingsScraped: scraped,
    listingsValid: valid,
    validationRate,
    duplicatesCollapsed,
    candidateFound,
    missingProductKey,
    lowIdentity,
    rejected: scraped - valid,
  };
}

function buildWatchBatchHistory(rows, watchName, maxBatches = 8, scanWindows = null) {
  const batches = groupRowsByBatch(rows, scanWindows);
  return batches
    .slice(-maxBatches)
    .map((batch) => {
      const summary = summarizeWatchBatchRows(batch.rows, watchName);
      return {
        ...summary,
        checkedAt: summary.checkedAt ?? batch.checkedAt ?? null,
      };
    })
    .filter((summary) => summary.listingsScraped > 0 || summary.checkedAt != null);
}

function countConsecutiveZeroScrapeBatches(batchHistory) {
  let consecutive = 0;

  for (let index = batchHistory.length - 1; index >= 0; index -= 1) {
    if (batchHistory[index].listingsScraped === 0) {
      consecutive += 1;
      continue;
    }
    break;
  }

  return consecutive;
}

function medianValidationRate(batchHistory) {
  const rates = batchHistory
    .map((batch) => batch.validationRate)
    .filter((rate) => Number.isFinite(rate));

  if (rates.length === 0) {
    return null;
  }

  const sorted = [...rates].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function latestSuccessfulScanAt(batchHistory) {
  for (let index = batchHistory.length - 1; index >= 0; index -= 1) {
    if (batchHistory[index].listingsScraped > 0) {
      return batchHistory[index].checkedAt;
    }
  }

  return null;
}

module.exports = {
  loadPriceHistoryRows,
  getScanWindowsFromEvents,
  rowsInScanWindow,
  latestScanWindow,
  groupRowsByBatch,
  summarizeWatchBatchRows,
  buildWatchBatchHistory,
  countConsecutiveZeroScrapeBatches,
  medianValidationRate,
  latestSuccessfulScanAt,
};

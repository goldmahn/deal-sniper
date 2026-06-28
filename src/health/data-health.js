const { validateListingTitle } = require("../validation");
const { HEALTH, statusFromIssues } = require("./levels");
const { groupRowsByBatch, getScanWindowsFromEvents } = require("./history-metrics");

const REJECTION_SPIKE_THRESHOLD = 0.2;
const PRODUCT_KEY_MISSING_WARNING_RATE = 0.2;

function normalizeProductBaselineKey(key) {
  const match = String(key).match(/item:([^:]+)$/);
  return match ? `newegg:item:${match[1]}` : key;
}

function revalidateRow(row, watch) {
  if (!watch?.requirements || !row.title) {
    return row.validationPassed === true;
  }

  return validateListingTitle(row.title, watch.requirements).validationPassed;
}

function assessLowestSeenPollution({ watch, baselineEntry, latestBatchRows, allRows }) {
  if (!baselineEntry || baselineEntry.lowestSeen == null) {
    return null;
  }

  const lowestSeen = baselineEntry.lowestSeen;
  const atLowLatest = latestBatchRows.filter(
    (row) => row.watchName === watch.name && row.price === lowestSeen && row.title
  );
  const livePollution = atLowLatest.some((row) => !revalidateRow(row, watch));

  const atLow = allRows.filter(
    (row) =>
      row.watchName === watch.name &&
      row.price === lowestSeen &&
      row.title
  );
  const failingAtLow = atLow.filter((row) => !revalidateRow(row, watch));
  const historicalPollution = failingAtLow.length > 0;

  if (!livePollution && !historicalPollution) {
    return null;
  }

  return {
    watchName: watch.name,
    lowestSeen,
    livePollution,
    historicalPollution,
    sampleTitle: failingAtLow[failingAtLow.length - 1]?.title ?? null,
    productKey: failingAtLow[failingAtLow.length - 1]?.productKey ?? null,
    reason: livePollution
      ? "latest scan batch contains lowestSeen listing(s) failing current validation"
      : "historical JSONL rows at lowestSeen fail current validation",
  };
}

function findPollutedProductBaselines({
  watches,
  productBaselines,
  rowsByProductKey,
  latestBatchProductKeys,
}) {
  const polluted = [];

  for (const [rawKey] of Object.entries(productBaselines ?? {})) {
    const productKey = normalizeProductBaselineKey(rawKey);
    const sampleRow = rowsByProductKey.get(productKey);

    if (!sampleRow) {
      continue;
    }

    const watch = watches.find((entry) => entry.name === sampleRow.watchName);
    if (!watch?.requirements) {
      continue;
    }

    if (!revalidateRow(sampleRow, watch)) {
      polluted.push({
        productKey,
        watchName: sampleRow.watchName,
        title: sampleRow.title,
        lowestSeen: productBaselines[rawKey]?.lowestSeen ?? null,
        scope: latestBatchProductKeys.has(productKey) ? "live" : "historical",
      });
    }
  }

  return polluted;
}

function detectRejectionSpikeForWatch(allBatches, watchName, watch) {
  const batches = allBatches
    .map((batch) => ({
      checkedAt: batch.checkedAt,
      rows: batch.rows.filter((row) => row.watchName === watchName),
    }))
    .filter((batch) => batch.rows.length > 0);

  if (batches.length < 2) {
    return null;
  }

  const latest = batches[batches.length - 1];
  const prior = batches.slice(0, -1);
  const latestSummary = summarizeBatchRejections(latest.rows, watch);
  const priorRates = prior.map((batch) =>
    summarizeBatchRejections(batch.rows, watch).rejectionRate
  );
  const priorMedian = median(priorRates);

  if (
    priorMedian != null &&
    latestSummary.rejectionRate > priorMedian + REJECTION_SPIKE_THRESHOLD
  ) {
    return {
      watchName,
      scope: "live",
      latestRejectionRate: latestSummary.rejectionRate,
      priorMedianRejectionRate: priorMedian,
    };
  }

  return null;
}

function detectRejectionSpike(rows, watchName, watch) {
  const batches = groupRowsByBatch(rows.filter((row) => row.watchName === watchName));
  if (batches.length < 2) {
    return null;
  }

  return detectRejectionSpikeForWatch(batches, watchName, watch);
}

function summarizeBatchRejections(rows, watch) {
  const scraped = rows.length;
  const rejected = rows.filter((row) => !revalidateRow(row, watch)).length;
  return {
    scraped,
    rejected,
    rejectionRate: scraped > 0 ? rejected / scraped : 0,
  };
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function detectProductKeyIssues(rows, watchName) {
  const watchRows = rows.filter((row) => row.watchName === watchName);
  if (watchRows.length === 0) {
    return null;
  }

  const missing = watchRows.filter((row) => !row.productKey).length;
  const lowIdentity = watchRows.filter((row) => row.identityConfidence === "low").length;
  const missingRate = missing / watchRows.length;
  const lowIdentityRate = lowIdentity / watchRows.length;

  if (
    missingRate >= PRODUCT_KEY_MISSING_WARNING_RATE ||
    lowIdentityRate >= PRODUCT_KEY_MISSING_WARNING_RATE
  ) {
    return {
      watchName,
      scope: "live",
      missingProductKey: missing,
      lowIdentity,
      scraped: watchRows.length,
    };
  }

  return null;
}

function buildDataHealthLayer({
  watches,
  baselines,
  productBaselines,
  priceHistoryRows,
  logEvents = [],
}) {
  const issues = [];
  const scanWindows = getScanWindowsFromEvents(logEvents);
  const batches = groupRowsByBatch(priceHistoryRows, scanWindows);
  const latestBatch = batches[batches.length - 1]?.rows ?? [];
  const latestBatchProductKeys = new Set(
    latestBatch.map((row) => row.productKey).filter(Boolean)
  );
  const rowsByProductKey = new Map();

  for (const row of priceHistoryRows) {
    if (row.productKey) {
      rowsByProductKey.set(row.productKey, row);
    }
  }

  const lowestSeenAssessments = [];
  for (const watch of watches) {
    const baselineKey = `${watch.store}:${watch.name}`;
    const assessment = assessLowestSeenPollution({
      watch,
      baselineEntry: baselines[baselineKey],
      latestBatchRows: latestBatch,
      allRows: priceHistoryRows,
    });
    if (assessment) {
      lowestSeenAssessments.push(assessment);
    }
  }

  const liveLowestSeen = lowestSeenAssessments.filter((entry) => entry.livePollution);
  const historicalLowestSeen = lowestSeenAssessments.filter(
    (entry) => entry.historicalPollution
  );

  if (liveLowestSeen.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "baseline_lowest_seen_pollution",
      scope: "live",
      message: `${liveLowestSeen.length} watch baseline(s) have lowestSeen listings failing validation in latest scan`,
      details: liveLowestSeen,
    });
  }

  if (historicalLowestSeen.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "baseline_lowest_seen_pollution",
      scope: "historical",
      message: `${historicalLowestSeen.length} watch baseline(s) still show historical lowestSeen pollution in JSONL`,
      details: historicalLowestSeen,
    });
  }

  const pollutedProductBaselines = findPollutedProductBaselines({
    watches,
    productBaselines,
    rowsByProductKey,
    latestBatchProductKeys,
  });

  const liveProductBaselines = pollutedProductBaselines.filter(
    (entry) => entry.scope === "live"
  );
  const historicalProductBaselines = pollutedProductBaselines.filter(
    (entry) => entry.scope === "historical"
  );

  if (liveProductBaselines.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "polluted_product_baselines",
      scope: "live",
      message: `${liveProductBaselines.length} product baseline(s) in latest scan fail current validation`,
      details: liveProductBaselines.slice(0, 5),
    });
  }

  if (historicalProductBaselines.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "polluted_product_baselines",
      scope: "historical",
      message: `${historicalProductBaselines.length} product baseline(s) tied to historical JSONL rows failing current validation`,
      details: historicalProductBaselines.slice(0, 5),
    });
  }

  const rejectionSpikes = watches
    .map((watch) => detectRejectionSpikeForWatch(batches, watch.name, watch))
    .filter(Boolean);

  if (rejectionSpikes.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "rejection_spike",
      scope: "live",
      message: `${rejectionSpikes.length} watch(es) show a live rejection-rate spike`,
      details: rejectionSpikes,
    });
  }

  const productKeyIssues = watches
    .map((watch) => detectProductKeyIssues(latestBatch, watch.name))
    .filter(Boolean);

  if (productKeyIssues.length > 0) {
    issues.push({
      severity: HEALTH.WARNING,
      code: "product_key_quality",
      scope: "live",
      message: `${productKeyIssues.length} watch(es) have missing/low-confidence productKeys in latest batch`,
      details: productKeyIssues,
    });
  }

  const liveIssues = issues.filter((issue) => issue.scope === "live");
  const historicalIssues = issues.filter((issue) => issue.scope === "historical");

  return {
    status: statusFromIssues(issues),
    liveStatus: statusFromIssues(liveIssues),
    historicalStatus: statusFromIssues(historicalIssues),
    issues,
    metrics: {
      liveIssueCount: liveIssues.length,
      historicalIssueCount: historicalIssues.length,
      lowestSeenPollutionCount: lowestSeenAssessments.length,
      liveLowestSeenPollutionCount: liveLowestSeen.length,
      historicalLowestSeenPollutionCount: historicalLowestSeen.length,
      pollutedProductBaselineCount: pollutedProductBaselines.length,
      livePollutedProductBaselineCount: liveProductBaselines.length,
      historicalPollutedProductBaselineCount: historicalProductBaselines.length,
      rejectionSpikeCount: rejectionSpikes.length,
      productKeyIssueCount: productKeyIssues.length,
      lowestSeenAssessments,
      pollutedProductBaselines: pollutedProductBaselines.slice(0, 5),
    },
  };
}

module.exports = {
  REJECTION_SPIKE_THRESHOLD,
  PRODUCT_KEY_MISSING_WARNING_RATE,
  normalizeProductBaselineKey,
  revalidateRow,
  assessLowestSeenPollution,
  findPollutedProductBaselines,
  detectRejectionSpike,
  detectRejectionSpikeForWatch,
  detectProductKeyIssues,
  buildDataHealthLayer,
  // Back-compat alias used in older tests
  findLowestSeenPollution: assessLowestSeenPollution,
};

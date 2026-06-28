const { HEALTH } = require("../levels");

function formatPercent(rate, digits = 1) {
  if (rate == null || !Number.isFinite(rate)) {
    return "n/a";
  }

  return `${(rate * 100).toFixed(digits)}%`;
}

function buildScanQualityMetrics(report) {
  const watches = report.layers.watch.watches;
  let listingsScraped = 0;
  let listingsValid = 0;
  let duplicatesCollapsed = 0;

  for (const watch of watches) {
    listingsScraped += watch.metrics.listingsScraped ?? 0;
    listingsValid += watch.metrics.listingsValid ?? 0;
    duplicatesCollapsed += watch.metrics.duplicatesCollapsed ?? 0;
  }

  const validationSuccess =
    listingsScraped > 0 ? listingsValid / listingsScraped : null;
  const duplicateCollapseRate =
    listingsScraped > 0 ? duplicatesCollapsed / listingsScraped : null;

  const productKeyIssue = report.layers.data.issues.find(
    (issue) => issue.code === "product_key_quality"
  );
  const productKeyDetails = productKeyIssue?.details ?? [];

  let inferredProductKeys = 0;
  let missingProductKeys = 0;
  let lowIdentityListings = 0;
  let identityDenominator = 0;

  for (const detail of productKeyDetails) {
    missingProductKeys += detail.missingProductKey ?? 0;
    lowIdentityListings += detail.lowIdentity ?? 0;
    identityDenominator += detail.scraped ?? 0;
  }

  inferredProductKeys = missingProductKeys + lowIdentityListings;

  if (identityDenominator === 0 && listingsScraped > 0) {
    identityDenominator = listingsScraped;
  }

  const identityConfidence =
    identityDenominator > 0
      ? (identityDenominator - lowIdentityListings) / identityDenominator
      : listingsScraped > 0
        ? 1
        : null;

  return {
    listingsScraped,
    listingsValid,
    duplicatesCollapsed,
    validationSuccess,
    duplicateCollapseRate,
    identityConfidence,
    inferredProductKeys,
    missingProductKeys,
    lowIdentityListings,
    identityDenominator,
  };
}

function metricSummaryForIssue(issue, scanMetrics) {
  if (issue.code === "product_key_quality" && issue.details?.length) {
    const missing = issue.details.reduce(
      (sum, entry) => sum + (entry.missingProductKey ?? 0),
      0
    );
    const lowIdentity = issue.details.reduce(
      (sum, entry) => sum + (entry.lowIdentity ?? 0),
      0
    );
    const scraped = issue.details.reduce(
      (sum, entry) => sum + (entry.scraped ?? 0),
      0
    );
    const inferred = missing + lowIdentity;
    const identityConfidence =
      scraped > 0 ? (scraped - lowIdentity) / scraped : scanMetrics.identityConfidence;

    return {
      identityConfidence,
      inferredProductKeys: inferred,
      inferredDenominator: scraped,
      validationSuccess: scanMetrics.validationSuccess,
      duplicateCollapseRate: scanMetrics.duplicateCollapseRate,
      displayLines: [
        `Identity confidence: ${formatPercent(identityConfidence)}`,
        `Inferred productKeys: ${inferred} of ${scraped} listings`,
        `Validation success: ${formatPercent(scanMetrics.validationSuccess)}`,
        `Duplicate collapse rate: ${formatPercent(scanMetrics.duplicateCollapseRate)}`,
      ],
    };
  }

  if (issue.code === "rejection_spike" && issue.details?.length) {
    const detail = issue.details[0];
    return {
      displayLines: [
        `Validation success: ${formatPercent(1 - (detail.latestRejectionRate ?? 0))}`,
        `Rejection rate: ${formatPercent(detail.latestRejectionRate)}`,
      ],
    };
  }

  if (issue.code === "validation_rate_drop") {
    return {
      displayLines: [`Validation success: ${issue.message}`],
    };
  }

  if (issue.code === "polluted_product_baselines" && issue.scope === "historical") {
    const count = Number.parseInt(issue.message, 10) || issue.details?.length || 0;
    return {
      displayLines: [
        `Historical JSONL contains ${count} legacy polluted product baseline row(s)`,
      ],
    };
  }

  if (issue.code === "baseline_lowest_seen_pollution" && issue.scope === "historical") {
    const count = Number.parseInt(issue.message, 10) || issue.details?.length || 0;
    return {
      displayLines: [
        `Historical JSONL contains legacy polluted lowestSeen on ${count} watch(es)`,
      ],
    };
  }

  return {
    displayLines: [issue.message],
  };
}

function statusFromPolicyIssues(issues, policyClass) {
  const filtered = issues.filter((entry) => entry.policyClass === policyClass);
  if (filtered.some((entry) => entry.severity === HEALTH.CRITICAL)) {
    return HEALTH.CRITICAL;
  }
  if (filtered.some((entry) => entry.severity === HEALTH.WARNING)) {
    return HEALTH.WARNING;
  }
  return HEALTH.GREEN;
}

module.exports = {
  formatPercent,
  buildScanQualityMetrics,
  metricSummaryForIssue,
  statusFromPolicyIssues,
};

const { HEALTH } = require("./levels");
const { formatDuration } = require("./alert-state");

const ISSUE_LABELS = {
  validation_rate_drop: "Validation rate dropped",
  zero_scrape: "Scrape returned zero listings",
  zero_scrape_streak: "Scrape returned zero listings",
  baseline_stale: "Baseline did not update after scrape",
  missing_candidate: "No watch candidate selected",
  recent_watch_errors: "Recent watch errors in logs",
  stale_scan: "Latest scan is stale",
  aging_scan: "Latest scan is aging",
  watch_process_down: "Watch process is down",
  no_recent_scan: "No completed scan found",
  price_history_not_writable: "Price history is not writable",
  baselines_corrupt: "baselines.json is corrupt",
  baselines_missing: "baselines.json is missing",
  baselines_not_readable: "baselines.json is not readable",
  product_baselines_corrupt: "product-baselines.json is corrupt",
  product_baselines_missing: "product-baselines.json is missing",
  product_baselines_not_readable: "product-baselines.json is not readable",
  telegram_not_configured: "Telegram is not configured",
  large_log_file: "Monthly log file is very large",
  baseline_lowest_seen_pollution: "Suspicious lowestSeen in baseline",
  polluted_product_baselines: "Polluted product baselines",
  rejection_spike: "Rejection-rate spike",
  product_key_quality: "Missing or low-confidence productKeys",
  historical_lowest_seen_pollution: "Historical lowestSeen pollution",
  live_lowest_seen_pollution: "Live lowestSeen pollution",
  product_baseline_drift: "Historical product baseline drift",
  live_product_baseline_drift: "Live product baseline drift",
};

function issueLabel(issue) {
  if (ISSUE_LABELS[issue.code]) {
    return ISSUE_LABELS[issue.code];
  }

  return issue.message ?? issue.code;
}

function affectedWatchNames(report, storeName, code) {
  if (!storeName || !code) {
    return [];
  }

  return report.layers.watch.watches
    .filter(
      (watch) =>
        watch.store === storeName &&
        watch.issues.some((entry) => entry.code === code)
    )
    .map((watch) => watch.watchName);
}

function buildGreenDigestMessage(report) {
  const policy = report.policy;
  const qualityLines =
    policy?.qualityObservations?.length > 0
      ? policy.qualityObservations
      : policy?.metrics?.identityConfidence != null
        ? [
            `Identity confidence: ${formatPercent(policy.metrics.identityConfidence)}`,
            `Validation success: ${formatPercent(policy.metrics.validationSuccess)}`,
            `Duplicate collapse rate: ${formatPercent(policy.metrics.duplicateCollapseRate)}`,
          ]
        : [];
  const historicalLines = policy?.historicalObservations ?? [];
  const hasHistorical = historicalLines.length > 0;
  const hasQuality = qualityLines.length > 0;
  const dataLine = hasHistorical ? "🟡 Historical warnings only" : "🟢 GREEN";

  const lines = [
    "🟢 DEAL SNIPER HEALTH",
    "",
    "Daily system check",
    "",
    "Operational",
    `🟢 ${report.operationalStatus}`,
    "",
    "Data Integrity",
    dataLine,
  ];

  if (hasQuality) {
    lines.push("", "Quality observations", "");
    for (const line of qualityLines) {
      lines.push(`- ${line}`);
    }
  }

  if (hasHistorical) {
    lines.push("", "Historical observations", "");
    for (const line of historicalLines) {
      lines.push(`- ${line}`);
    }
  }

  lines.push(
    "",
    "System",
    `🟢 ${report.layers.system.status}`,
    "",
    "Summary",
    "",
    report.answers.safeToLeaveAlone
      ? "All watches operating normally."
      : "Operational checks passed on latest scan window.",
    "",
    "No action required."
  );

  return lines.join("\n");
}

function formatPercent(rate) {
  if (rate == null || !Number.isFinite(rate)) {
    return "n/a";
  }

  return `${(rate * 100).toFixed(1)}%`;
}

function buildWarningMessage(issue, record) {
  return [
    "🟡 DEAL SNIPER HEALTH WARNING",
    "",
    "Issue",
    "",
    issueLabel(issue),
    "",
    issue.watchName ? "Watch" : issue.store ? "Store" : "Area",
    "",
    issue.watchName ?? issue.store ?? issue.layer,
    "",
    "Consecutive detections",
    "",
    String(record.consecutiveScans ?? 0),
    "",
    "Likely cause",
    "",
    issue.message,
    "",
    "Suggested action",
    "",
    "Run:",
    "",
    "npm run status",
  ].join("\n");
}

function buildCriticalMessage(issue, report) {
  const lines = [
    "🔴 DEAL SNIPER HEALTH CRITICAL",
    "",
    "Issue",
    "",
    issueLabel(issue),
    "",
  ];

  if (issue.store) {
    lines.push("Store", "", issue.store, "");
  }

  if (issue.layer === "watch" && issue.watchName) {
    lines.push("Watch", "", issue.watchName, "");
  }

  if (issue.layer === "store") {
    const watches =
      issue.affectedWatches ??
      affectedWatchNames(report, issue.store, issue.code);
    if (watches.length > 0) {
      lines.push("Affected watches", "");
      for (const watchName of watches) {
        lines.push(watchName);
      }
      lines.push("");
    }
  }

  lines.push(
    "Suggested action",
    "",
    issue.layer === "system"
      ? "Investigate process, files, or scan scheduling."
      : "Investigate scraper or retailer changes.",
    "",
    "Run:",
    "",
    "npm run status"
  );

  return lines.join("\n");
}

function buildRecoveryMessage(issue, record, now) {
  const duration = formatDuration(
    now.getTime() - new Date(record.firstActiveAt).getTime()
  );

  return [
    "✅ DEAL SNIPER HEALTH RECOVERED",
    "",
    "Issue",
    "",
    issueLabel(issue),
    "",
    issue.watchName ? "Watch" : issue.store ? "Store" : "Area",
    "",
    issue.watchName ?? issue.store ?? issue.layer,
    "",
    "Recovered after",
    "",
    duration,
    "",
    "Current status",
    "",
    "GREEN",
  ].join("\n");
}

module.exports = {
  ISSUE_LABELS,
  issueLabel,
  buildGreenDigestMessage,
  buildWarningMessage,
  buildCriticalMessage,
  buildRecoveryMessage,
};

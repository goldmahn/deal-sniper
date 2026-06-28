const { HEALTH } = require("./levels");
const { classifyIssue } = require("./policy/classify");
const { POLICY_CLASS } = require("./policy/classes");
const { isDigestOnlyIssue } = require("./policy/telegram");

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+newegg\s+category\s*$/i, "")
    .replace(/\s+newegg\s+test\s*$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slugifyWatchName(watchName) {
  const slug = slugify(watchName);
  return slug || "unknown_watch";
}

function buildWatchIssueId(store, watchName, code) {
  return `watch:${store}:${slugifyWatchName(watchName)}:${code}`;
}

function buildStoreIssueId(store, code) {
  return `store:${store}:${code}`;
}

function buildSystemIssueId(code) {
  return `system:${code}`;
}

function buildDataIssueId(issue) {
  if (issue.code === "baseline_lowest_seen_pollution") {
    return issue.scope === "historical"
      ? "data:historical_lowest_seen_pollution"
      : "data:live_lowest_seen_pollution";
  }

  if (issue.code === "polluted_product_baselines") {
    return issue.scope === "historical"
      ? "data:product_baseline_drift"
      : "data:live_product_baseline_drift";
  }

  if (issue.scope) {
    return `data:${issue.code}:${issue.scope}`;
  }

  return `data:${issue.code}`;
}

function isHistoricalOnlyAlertIssue(issue) {
  return isDigestOnlyIssue(enrichIssuePolicy(issue));
}

function isHistoricalOnlyAlertIssueId(issueId) {
  return (
    issueId === "data:historical_lowest_seen_pollution" ||
    issueId === "data:product_baseline_drift" ||
    issueId.startsWith("data:product_key_quality:")
  );
}

function enrichIssuePolicy(issue) {
  const { policyClass, confidence } = classifyIssue(issue);
  return {
    ...issue,
    policyClass,
    confidence,
  };
}

function extractIssuesFromReport(report) {
  const issues = new Map();
  const zeroScrapeWatchesByStore = new Map();

  for (const watch of report.layers.watch.watches) {
    for (const issue of watch.issues) {
      if (issue.code !== "zero_scrape") {
        continue;
      }

      if (!zeroScrapeWatchesByStore.has(watch.store)) {
        zeroScrapeWatchesByStore.set(watch.store, []);
      }

      zeroScrapeWatchesByStore.get(watch.store).push({ watch, issue });
    }
  }

  const groupedZeroScrapeStores = new Set();
  const singleZeroScrapeStores = new Set();

  for (const [store, entries] of zeroScrapeWatchesByStore) {
    if (entries.length >= 2) {
      groupedZeroScrapeStores.add(store);
      const severity = entries.some(
        (entry) => entry.issue.severity === HEALTH.CRITICAL
      )
        ? HEALTH.CRITICAL
        : HEALTH.WARNING;
      const id = buildStoreIssueId(store, "zero_scrape");

      issues.set(id, enrichIssuePolicy({
        id,
        severity,
        layer: "store",
        code: "zero_scrape",
        message: `${entries.length} watch(es) returned zero listings`,
        store,
        watchName: null,
        count: entries.length,
        affectedWatches: entries.map((entry) => entry.watch.watchName),
      }));
      continue;
    }

    singleZeroScrapeStores.add(store);
  }

  for (const watch of report.layers.watch.watches) {
    for (const issue of watch.issues) {
      if (issue.code === "zero_scrape" && groupedZeroScrapeStores.has(watch.store)) {
        continue;
      }

      const id = buildWatchIssueId(watch.store, watch.watchName, issue.code);
      issues.set(id, enrichIssuePolicy({
        id,
        severity: issue.severity,
        layer: "watch",
        code: issue.code,
        message: issue.message,
        store: watch.store,
        watchName: watch.watchName,
      }));
    }
  }

  for (const store of report.layers.store.stores) {
    for (const pattern of store.failurePatterns) {
      if (
        pattern.code === "zero_scrape" &&
        (groupedZeroScrapeStores.has(store.store) ||
          singleZeroScrapeStores.has(store.store))
      ) {
        continue;
      }

      const id = buildStoreIssueId(store.store, pattern.code);
      issues.set(id, enrichIssuePolicy({
        id,
        severity: store.status === HEALTH.CRITICAL ? HEALTH.CRITICAL : HEALTH.WARNING,
        layer: "store",
        code: pattern.code,
        message: `${pattern.code} (${pattern.count} watch(es))`,
        store: store.store,
        watchName: null,
        count: pattern.count,
      }));
    }
  }

  for (const issue of report.layers.system.issues) {
    const id = buildSystemIssueId(issue.code);
    issues.set(id, enrichIssuePolicy({
      id,
      severity: issue.severity,
      layer: "system",
      code: issue.code,
      message: issue.message,
      store: null,
      watchName: null,
    }));
  }

  for (const issue of report.layers.data.issues) {
    const id = buildDataIssueId(issue);
    issues.set(id, enrichIssuePolicy({
      id,
      severity: issue.severity,
      layer: "data",
      code: issue.code,
      scope: issue.scope ?? null,
      message: issue.message,
      store: null,
      watchName: null,
      details: issue.details,
    }));
  }

  return issues;
}

module.exports = {
  slugifyWatchName,
  buildWatchIssueId,
  buildStoreIssueId,
  buildSystemIssueId,
  buildDataIssueId,
  isHistoricalOnlyAlertIssue,
  isHistoricalOnlyAlertIssueId,
  enrichIssuePolicy,
  extractIssuesFromReport,
  POLICY_CLASS,
};

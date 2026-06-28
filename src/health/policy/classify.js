const { HEALTH } = require("../levels");
const { POLICY_CLASS, CONFIDENCE } = require("./classes");

const ISSUE_POLICY = {
  zero_scrape: ({ severity }) =>
    severity === HEALTH.CRITICAL
      ? { policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL, confidence: CONFIDENCE.HIGH }
      : { policyClass: POLICY_CLASS.WARNING_OPERATIONAL, confidence: CONFIDENCE.MEDIUM },
  baseline_stale: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  validation_rate_drop: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  missing_candidate: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  recent_watch_errors: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  watch_process_down: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  no_recent_scan: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  stale_scan: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  aging_scan: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  price_history_not_writable: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  baselines_corrupt: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  baselines_not_readable: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  baselines_missing: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  product_baselines_corrupt: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  product_baselines_not_readable: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  product_baselines_missing: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.LOW,
  }),
  telegram_not_configured: () => ({
    policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
    confidence: CONFIDENCE.HIGH,
  }),
  large_log_file: () => ({
    policyClass: POLICY_CLASS.QUALITY,
    confidence: CONFIDENCE.LOW,
  }),
  baseline_lowest_seen_pollution: ({ scope }) =>
    scope === "historical"
      ? { policyClass: POLICY_CLASS.HISTORICAL, confidence: CONFIDENCE.LOW }
      : { policyClass: POLICY_CLASS.WARNING_OPERATIONAL, confidence: CONFIDENCE.MEDIUM },
  polluted_product_baselines: ({ scope }) =>
    scope === "historical"
      ? { policyClass: POLICY_CLASS.HISTORICAL, confidence: CONFIDENCE.LOW }
      : { policyClass: POLICY_CLASS.QUALITY, confidence: CONFIDENCE.LOW },
  rejection_spike: () => ({
    policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
    confidence: CONFIDENCE.MEDIUM,
  }),
  product_key_quality: () => ({
    policyClass: POLICY_CLASS.QUALITY,
    confidence: CONFIDENCE.LOW,
  }),
};

function classifyIssue(issue, context = {}) {
  const mapper = ISSUE_POLICY[issue.code];

  if (mapper) {
    return mapper({ ...context, ...issue });
  }

  if (issue.scope === "historical") {
    return {
      policyClass: POLICY_CLASS.HISTORICAL,
      confidence: CONFIDENCE.LOW,
    };
  }

  if (issue.severity === HEALTH.CRITICAL) {
    return {
      policyClass: POLICY_CLASS.CRITICAL_OPERATIONAL,
      confidence: CONFIDENCE.MEDIUM,
    };
  }

  if (issue.severity === HEALTH.WARNING) {
    return {
      policyClass: POLICY_CLASS.WARNING_OPERATIONAL,
      confidence: CONFIDENCE.MEDIUM,
    };
  }

  return {
    policyClass: POLICY_CLASS.QUALITY,
    confidence: CONFIDENCE.LOW,
  };
}

module.exports = { ISSUE_POLICY, classifyIssue };

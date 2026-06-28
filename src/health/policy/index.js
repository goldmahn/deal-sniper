const { HEALTH } = require("../levels");
const { classifyIssue } = require("./classify");
const { POLICY_CLASS } = require("./classes");
const {
  buildScanQualityMetrics,
  metricSummaryForIssue,
  statusFromPolicyIssues,
  formatPercent,
} = require("./metrics");
const {
  isDigestOnlyIssue,
  shouldPageImmediately,
  shouldPageWithThreshold,
  shouldTrackInAlertState,
} = require("./telegram");

function collectLayerIssues(report) {
  const collected = [];

  for (const watch of report.layers.watch.watches) {
    for (const issue of watch.issues) {
      collected.push({
        ...issue,
        layer: "watch",
        store: watch.store,
        watchName: watch.watchName,
      });
    }
  }

  for (const store of report.layers.store.stores) {
    for (const pattern of store.failurePatterns) {
      collected.push({
        severity:
          store.status === HEALTH.CRITICAL ? HEALTH.CRITICAL : HEALTH.WARNING,
        code: pattern.code,
        message: `${pattern.code} (${pattern.count} watch(es))`,
        layer: "store",
        store: store.store,
        watchName: null,
        count: pattern.count,
      });
    }
  }

  for (const issue of report.layers.system.issues) {
    collected.push({
      ...issue,
      layer: "system",
      store: null,
      watchName: null,
    });
  }

  for (const issue of report.layers.data.issues) {
    collected.push({
      ...issue,
      layer: "data",
      store: null,
      watchName: null,
    });
  }

  return collected;
}

function applyHealthPolicy(report) {
  const scanMetrics = buildScanQualityMetrics(report);
  const rawIssues = collectLayerIssues(report);

  const issues = rawIssues.map((issue) => {
    const { policyClass, confidence } = classifyIssue(issue);
    const metrics = metricSummaryForIssue(issue, scanMetrics);

    return {
      ...issue,
      policyClass,
      confidence,
      metricSummary: metrics.displayLines.join("\n"),
      metricLines: metrics.displayLines,
    };
  });

  const operationalIssues = issues.filter(
    (issue) =>
      issue.policyClass === POLICY_CLASS.CRITICAL_OPERATIONAL ||
      issue.policyClass === POLICY_CLASS.WARNING_OPERATIONAL
  );
  const qualityIssues = issues.filter(
    (issue) => issue.policyClass === POLICY_CLASS.QUALITY
  );
  const historicalIssues = issues.filter(
    (issue) => issue.policyClass === POLICY_CLASS.HISTORICAL
  );

  report.policy = {
    operationalStatus: report.operationalStatus,
    qualityStatus: statusFromPolicyIssues(issues, POLICY_CLASS.QUALITY),
    historicalStatus: statusFromPolicyIssues(issues, POLICY_CLASS.HISTORICAL),
    issues,
    operationalIssues,
    qualityIssues,
    historicalIssues,
    metrics: scanMetrics,
    safeToLeaveAlone: report.operationalStatus === HEALTH.GREEN,
    qualityObservations: qualityIssues.flatMap((issue) => issue.metricLines),
    historicalObservations: historicalIssues.flatMap((issue) => issue.metricLines),
  };

  return report;
}

function formatPolicyStatusSection(report) {
  const policy = report.policy;
  if (!policy) {
    return [];
  }

  const lines = ["--- Health Policy ---", ""];

  lines.push("Operational", policy.operationalStatus, "");

  if (policy.operationalIssues.length > 0) {
    for (const issue of policy.operationalIssues) {
      lines.push(`- ${issue.metricLines[0] ?? issue.message}`);
    }
    lines.push("");
  }

  lines.push("Quality", policy.qualityStatus, "");
  if (policy.qualityIssues.length > 0) {
    for (const issue of policy.qualityIssues) {
      for (const line of issue.metricLines) {
        lines.push(`- ${line}`);
      }
    }
  } else if (policy.metrics.identityConfidence != null) {
    lines.push(`- Identity confidence: ${formatPercent(policy.metrics.identityConfidence)}`);
    lines.push(
      `- Validation success: ${formatPercent(policy.metrics.validationSuccess)}`
    );
    lines.push(
      `- Duplicate collapse rate: ${formatPercent(policy.metrics.duplicateCollapseRate)}`
    );
  }
  lines.push("");

  lines.push("Historical", policy.historicalStatus, "");
  if (policy.historicalIssues.length > 0) {
    for (const issue of policy.historicalIssues) {
      for (const line of issue.metricLines) {
        lines.push(`- ${line}`);
      }
    }
  } else {
    lines.push("- No historical drift flagged");
  }
  lines.push("");

  lines.push(
    "Safe to leave alone?",
    policy.safeToLeaveAlone ? "YES" : "NO"
  );

  return lines;
}

module.exports = {
  applyHealthPolicy,
  formatPolicyStatusSection,
  classifyIssue,
  isDigestOnlyIssue,
  shouldPageImmediately,
  shouldPageWithThreshold,
  shouldTrackInAlertState,
  POLICY_CLASS,
};

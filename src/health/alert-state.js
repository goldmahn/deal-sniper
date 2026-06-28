const {
  readHealthAlertState,
  writeHealthAlertState,
  createEmptyHealthAlertState,
} = require("../repositories/health-alert-state-repository");
const { isHistoricalOnlyAlertIssueId } = require("./issue-ids");

function getIssueRecord(state, issueId) {
  return state.issues[issueId] ?? null;
}

function upsertIssueRecord(state, issueId, patch) {
  const existing = state.issues[issueId] ?? {};
  state.issues[issueId] = {
    ...existing,
    ...patch,
    issueId,
  };
}

function clearIssueRecord(state, issueId) {
  delete state.issues[issueId];
}

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "unknown duration";
  }

  const totalMinutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function shouldSendGreenDigest(now, lastGreenDigestAt, digestHour) {
  const digestAt = new Date(now);
  digestAt.setHours(digestHour, 0, 0, 0, 0);

  if (now < digestAt) {
    return false;
  }

  if (!lastGreenDigestAt) {
    return true;
  }

  return new Date(lastGreenDigestAt) < digestAt;
}

function cooldownElapsed(lastNotifiedAt, cooldownMs, now) {
  if (!lastNotifiedAt) {
    return true;
  }

  return now.getTime() - new Date(lastNotifiedAt).getTime() >= cooldownMs;
}

function summarizeOutstandingIssues(state, config) {
  const outstandingWarnings = [];
  const outstandingCriticals = [];

  for (const record of Object.values(state.issues)) {
    if (!record.active || isHistoricalOnlyAlertIssueId(record.issueId)) {
      continue;
    }

    if (record.severity === "CRITICAL") {
      outstandingCriticals.push(record);
      continue;
    }

    if (record.severity === "WARNING") {
      outstandingWarnings.push(record);
    }
  }

  return {
    outstandingWarnings,
    outstandingCriticals,
    warningCounters: outstandingWarnings.map((record) => ({
      issueId: record.issueId,
      consecutiveScans: record.consecutiveScans ?? 0,
      threshold: config.warningConsecutive,
    })),
  };
}

function formatHealthAlertsStatusLines(state, config) {
  const summary = summarizeOutstandingIssues(state, config);
  const lines = ["--- Health Alerts ---"];

  lines.push(`Enabled: ${config.enabled ? "yes" : "no"}`);
  lines.push(`Last GREEN digest: ${state.lastGreenDigestAt ?? "(none)"}`);
  lines.push(`Last WARNING: ${state.lastWarningSentAt ?? "(none)"}`);
  lines.push(`Last CRITICAL: ${state.lastCriticalSentAt ?? "(none)"}`);
  lines.push(`Last recovery: ${state.lastRecoverySentAt ?? "(none)"}`);

  if (summary.warningCounters.length === 0) {
    lines.push("Outstanding warning counters: (none)");
  } else {
    lines.push("Outstanding warning counters:");
    for (const entry of summary.warningCounters) {
      lines.push(
        `  ${entry.issueId}: ${entry.consecutiveScans}/${entry.threshold}`
      );
    }
  }

  if (summary.outstandingCriticals.length === 0) {
    lines.push("Outstanding critical issues: (none)");
  } else {
    lines.push("Outstanding critical issues:");
    for (const record of summary.outstandingCriticals) {
      lines.push(`  ${record.issueId}`);
    }
  }

  return lines;
}

module.exports = {
  readHealthAlertState,
  writeHealthAlertState,
  createEmptyHealthAlertState,
  getIssueRecord,
  upsertIssueRecord,
  clearIssueRecord,
  formatDuration,
  shouldSendGreenDigest,
  cooldownElapsed,
  summarizeOutstandingIssues,
  formatHealthAlertsStatusLines,
};

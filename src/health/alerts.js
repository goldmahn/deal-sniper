const { HEALTH } = require("./levels");
const { loadHealthAlertsConfig } = require("./alerts-config");
const {
  extractIssuesFromReport,
  isHistoricalOnlyAlertIssue,
  isHistoricalOnlyAlertIssueId,
} = require("./issue-ids");
const {
  isDigestOnlyIssue,
  shouldPageImmediately,
  shouldPageWithThreshold,
  shouldTrackInAlertState,
} = require("./policy/telegram");
const {
  readHealthAlertState,
  writeHealthAlertState,
  upsertIssueRecord,
  clearIssueRecord,
  shouldSendGreenDigest,
  cooldownElapsed,
} = require("./alert-state");
const {
  getHealthAlertStatePath,
} = require("../repositories/health-alert-state-repository");
const {
  buildGreenDigestMessage,
  buildWarningMessage,
  buildCriticalMessage,
  buildRecoveryMessage,
} = require("./message-builder");
const { sendHealthTelegramMessage } = require("./health-telegram");
const { writeLog } = require("../logger");
const { applyHealthPolicy } = require("./policy");

function shouldNotifyRecovery(record) {
  return Boolean(record.lastNotifiedAt || record.severity === HEALTH.CRITICAL);
}

function describeDigestEligibility({
  now,
  lastGreenDigestAt,
  digestHour,
  operationalStatus,
}) {
  if (operationalStatus !== HEALTH.GREEN) {
    return {
      eligible: false,
      reason: `operationalStatus=${operationalStatus}`,
    };
  }

  const digestAt = new Date(now);
  digestAt.setHours(digestHour, 0, 0, 0, 0);

  if (now < digestAt) {
    return {
      eligible: false,
      reason: `before_digest_hour localHour=${now.getHours()} digestHour=${digestHour}`,
    };
  }

  if (!lastGreenDigestAt) {
    return { eligible: true, reason: null };
  }

  if (new Date(lastGreenDigestAt) < digestAt) {
    return { eligible: true, reason: null };
  }

  return {
    eligible: false,
    reason: `already_sent_today lastGreenDigestAt=${lastGreenDigestAt}`,
  };
}

function logHealthAlertDiagnostics({
  root,
  config,
  report,
  now,
  state,
  digest,
}) {
  const statePath = getHealthAlertStatePath(root);

  writeLog(`Health alerts enabled=${config.enabled}`);
  writeLog(
    `Health alerts operationalStatus=${report.operationalStatus} overallStatus=${report.overallStatus}`
  );
  writeLog(
    `Health alerts localHour=${now.getHours()} configuredDigestHour=${config.dailyDigestHour} timezone=${Intl.DateTimeFormat().resolvedOptions().timeZone}`
  );
  writeLog(
    `Health alerts digestEligible=${digest.eligible} digestSkipReason=${digest.reason ?? "(none)"}`
  );
  writeLog(`Health alerts stateReadPath=${statePath}`);
  writeLog(
    `Health alerts stateSnapshot lastGreenDigestAt=${state.lastGreenDigestAt ?? "(none)"} issueCount=${Object.keys(state.issues).length}`
  );
}

async function attemptHealthTelegram(sendTelegram, message, context) {
  writeLog(`Health alert telegram attempted context=${context}`);
  try {
    await sendTelegram(message);
    writeLog(`Health alert telegram succeeded context=${context}`);
  } catch (error) {
    writeLog(
      `Health alert telegram failed context=${context} error=${error.message}`
    );
    throw error;
  }
}

async function processHealthAlerts({
  report,
  root,
  now = new Date(),
  config = loadHealthAlertsConfig(),
  sendTelegram = sendHealthTelegramMessage,
  readState = () => readHealthAlertState(root),
  writeState = (state) => writeHealthAlertState(root, state),
}) {
  const statePath = getHealthAlertStatePath(root);
  const digest = describeDigestEligibility({
    now,
    lastGreenDigestAt: null,
    digestHour: config.dailyDigestHour,
    operationalStatus: report.operationalStatus,
  });

  writeLog("Health alerts entered");
  writeLog(`Health alerts enabled=${config.enabled}`);

  if (!config.enabled) {
    writeLog("Health alerts skipReason=disabled");
    writeLog("Health alerts stateWrite=skipped reason=disabled");
    return { sent: [], skipped: "disabled" };
  }

  if (!report.policy) {
    applyHealthPolicy(report);
  }

  const state = readState();
  digest.lastGreenDigestAt = state.lastGreenDigestAt;
  const digestEligibility = describeDigestEligibility({
    now,
    lastGreenDigestAt: state.lastGreenDigestAt,
    digestHour: config.dailyDigestHour,
    operationalStatus: report.operationalStatus,
  });

  logHealthAlertDiagnostics({
    root,
    config,
    report,
    now,
    state,
    digest: digestEligibility,
  });

  const currentIssues = extractIssuesFromReport(report);
  const sent = [];

  for (const [issueId, record] of Object.entries(state.issues)) {
    if (currentIssues.has(issueId) || !record.active) {
      continue;
    }

    if (isHistoricalOnlyAlertIssueId(issueId)) {
      clearIssueRecord(state, issueId);
      continue;
    }

    const recoveredIssue = {
      id: issueId,
      code: record.code,
      layer: record.layer,
      message: record.message,
      store: record.store ?? null,
      watchName: record.watchName ?? null,
    };

    if (shouldNotifyRecovery(record)) {
      const message = buildRecoveryMessage(recoveredIssue, record, now);
      await attemptHealthTelegram(sendTelegram, message, `recovery:${issueId}`);
      sent.push({ type: "recovery", issueId, message });
      state.lastRecoverySentAt = now.toISOString();
    }

    clearIssueRecord(state, issueId);
  }

  for (const [issueId, issue] of currentIssues.entries()) {
    if (isDigestOnlyIssue(issue) || isHistoricalOnlyAlertIssue(issue)) {
      if (state.issues[issueId]) {
        clearIssueRecord(state, issueId);
      }
      continue;
    }

    if (!shouldTrackInAlertState(issue)) {
      if (state.issues[issueId]) {
        clearIssueRecord(state, issueId);
      }
      continue;
    }

    const existing = state.issues[issueId] ?? {};
    const firstActiveAt = existing.active
      ? existing.firstActiveAt
      : now.toISOString();

    if (shouldPageImmediately(issue)) {
      const record = {
        active: true,
        severity: HEALTH.CRITICAL,
        code: issue.code,
        layer: issue.layer,
        message: issue.message,
        store: issue.store ?? null,
        watchName: issue.watchName ?? null,
        policyClass: issue.policyClass,
        confidence: issue.confidence,
        firstActiveAt,
        lastActiveAt: now.toISOString(),
        consecutiveScans: (existing.consecutiveScans ?? 0) + 1,
        lastNotifiedAt: existing.lastNotifiedAt ?? null,
      };

      const shouldSend =
        !record.lastNotifiedAt ||
        cooldownElapsed(record.lastNotifiedAt, config.criticalCooldownMs, now);

      if (shouldSend) {
        const message = buildCriticalMessage(issue, report);
        await attemptHealthTelegram(sendTelegram, message, `critical:${issueId}`);
        record.lastNotifiedAt = now.toISOString();
        state.lastCriticalSentAt = now.toISOString();
        sent.push({ type: "critical", issueId, message });
      }

      upsertIssueRecord(state, issueId, record);
      continue;
    }

    if (shouldPageWithThreshold(issue)) {
      const consecutiveScans = existing.active
        ? (existing.consecutiveScans ?? 0) + 1
        : 1;

      const record = {
        active: true,
        severity: HEALTH.WARNING,
        code: issue.code,
        layer: issue.layer,
        message: issue.message,
        store: issue.store ?? null,
        watchName: issue.watchName ?? null,
        policyClass: issue.policyClass,
        confidence: issue.confidence,
        firstActiveAt,
        lastActiveAt: now.toISOString(),
        consecutiveScans,
        lastNotifiedAt: existing.lastNotifiedAt ?? null,
      };

      const reachedThreshold = consecutiveScans >= config.warningConsecutive;
      const shouldSend =
        reachedThreshold &&
        cooldownElapsed(record.lastNotifiedAt, config.warningCooldownMs, now);

      if (shouldSend) {
        const message = buildWarningMessage(issue, record);
        await attemptHealthTelegram(sendTelegram, message, `warning:${issueId}`);
        record.lastNotifiedAt = now.toISOString();
        state.lastWarningSentAt = now.toISOString();
        sent.push({ type: "warning", issueId, message });
      }

      upsertIssueRecord(state, issueId, record);
    }
  }

  if (digestEligibility.eligible) {
    const message = buildGreenDigestMessage(report);
    await attemptHealthTelegram(sendTelegram, message, "green_digest");
    state.lastGreenDigestAt = now.toISOString();
    sent.push({ type: "green_digest", message });
  } else if (report.operationalStatus === HEALTH.GREEN) {
    writeLog(
      `Health alerts digestSkipped reason=${digestEligibility.reason ?? "unknown"}`
    );
  } else {
    writeLog(
      `Health alerts digestSkipped reason=${digestEligibility.reason ?? "operational_not_green"}`
    );
  }

  writeState(state);
  writeLog(`Health alerts stateWrite=success path=${statePath}`);
  writeLog(
    `Health alerts completed sent=${sent.map((entry) => entry.type).join(",") || "(none)"}`
  );

  return { sent, state };
}

module.exports = {
  processHealthAlerts,
  shouldNotifyRecovery,
  sendHealthTelegramMessage,
  describeDigestEligibility,
};

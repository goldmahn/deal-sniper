const fs = require("fs");
const path = require("path");

const HEALTH_ALERT_STATE_FILE = "health-alert-state.json";

function getHealthAlertStatePath(root = path.join(__dirname, "..", "..")) {
  return path.join(root, "data", HEALTH_ALERT_STATE_FILE);
}

function readHealthAlertState(root) {
  const statePath = getHealthAlertStatePath(root);

  if (!fs.existsSync(statePath)) {
    return createEmptyHealthAlertState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return normalizeHealthAlertState(parsed);
  } catch {
    return createEmptyHealthAlertState();
  }
}

function writeHealthAlertState(root, state) {
  const statePath = getHealthAlertStatePath(root);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(normalizeHealthAlertState(state), null, 2) + "\n");
}

function createEmptyHealthAlertState() {
  return {
    issues: {},
    lastGreenDigestAt: null,
    lastWarningSentAt: null,
    lastCriticalSentAt: null,
    lastRecoverySentAt: null,
  };
}

function normalizeHealthAlertState(state) {
  const empty = createEmptyHealthAlertState();

  return {
    issues: state?.issues && typeof state.issues === "object" ? state.issues : {},
    lastGreenDigestAt: state?.lastGreenDigestAt ?? null,
    lastWarningSentAt: state?.lastWarningSentAt ?? null,
    lastCriticalSentAt: state?.lastCriticalSentAt ?? null,
    lastRecoverySentAt: state?.lastRecoverySentAt ?? null,
  };
}

module.exports = {
  readHealthAlertState,
  writeHealthAlertState,
  getHealthAlertStatePath,
  createEmptyHealthAlertState,
  normalizeHealthAlertState,
  HEALTH_ALERT_STATE_FILE,
};

const fs = require("fs");
const path = require("path");

const ALERT_STATE_FILE = "alert-state.json";

function getAlertStatePath(root = path.join(__dirname, "..", "..")) {
  return path.join(root, "data", ALERT_STATE_FILE);
}

function readAlertState(root) {
  const alertStatePath = getAlertStatePath(root);

  if (!fs.existsSync(alertStatePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(alertStatePath, "utf8"));
  } catch {
    return {};
  }
}

function writeAlertState(root, state) {
  const alertStatePath = getAlertStatePath(root);
  fs.writeFileSync(alertStatePath, JSON.stringify(state, null, 2) + "\n");
}

module.exports = {
  readAlertState,
  writeAlertState,
  getAlertStatePath,
  ALERT_STATE_FILE,
};

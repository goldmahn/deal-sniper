const fs = require("fs");
const path = require("path");
require("dotenv").config();

const alertStatePath = path.join(__dirname, "..", "data", "alert-state.json");

const cooldownMs =
  (Number(process.env.ALERT_COOLDOWN_HOURS) || 12) * 60 * 60 * 1000;
const improvementFactor =
  1 - (Number(process.env.ALERT_PRICE_IMPROVEMENT_PERCENT) || 5) / 100;

function readAlertState() {
  if (!fs.existsSync(alertStatePath)) return {};

  try {
    return JSON.parse(fs.readFileSync(alertStatePath, "utf8"));
  } catch {
    return {};
  }
}

function writeAlertState(state) {
  fs.writeFileSync(alertStatePath, JSON.stringify(state, null, 2) + "\n");
}

function getAlertKey(listing) {
  return `${listing.store}:${listing.watchName}:${listing.url}`;
}

function shouldSendTelegramAlert(listing) {
  const state = readAlertState();
  const prior = state[getAlertKey(listing)];

  if (!prior) {
    return { send: true, reason: "first_alert" };
  }

  const elapsed = Date.now() - new Date(prior.lastAlertedAt).getTime();

  if (elapsed >= cooldownMs) {
    return { send: true, reason: "cooldown_elapsed" };
  }

  if (listing.price <= prior.lastAlertedPrice * improvementFactor) {
    return { send: true, reason: "price_improved" };
  }

  return { send: false, reason: "cooldown_active" };
}

function recordAlertSent(listing) {
  const state = readAlertState();
  state[getAlertKey(listing)] = {
    lastAlertedAt: new Date().toISOString(),
    lastAlertedPrice: listing.price,
  };
  writeAlertState(state);
}

module.exports = { shouldSendTelegramAlert, recordAlertSent };

const {
  readAlertState: readAlertStateFromStore,
  writeAlertState: writeAlertStateToStore,
} = require("./repositories/alert-state-repository");

require("dotenv").config();

const root = require("path").join(__dirname, "..");

const cooldownMs =
  (Number(process.env.ALERT_COOLDOWN_HOURS) || 12) * 60 * 60 * 1000;
const improvementFactor =
  1 - (Number(process.env.ALERT_PRICE_IMPROVEMENT_PERCENT) || 5) / 100;

function readAlertState() {
  return readAlertStateFromStore(root);
}

function writeAlertState(state) {
  writeAlertStateToStore(root, state);
}

function resolveAlertStateKey(listing) {
  if (listing.productKey) {
    return {
      alertStateKey: `${listing.store}:${listing.watchName}:${listing.productKey}`,
      alertStateKeySource: "productKey",
    };
  }

  return {
    alertStateKey: `${listing.store}:${listing.watchName}:${listing.url}`,
    alertStateKeySource: "url",
  };
}

function getAlertKey(listing) {
  return resolveAlertStateKey(listing).alertStateKey;
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

module.exports = {
  shouldSendTelegramAlert,
  recordAlertSent,
  resolveAlertStateKey,
};

const {
  readBaselines: readBaselinesFromStore,
  writeBaselines: writeBaselinesToStore,
} = require("./repositories/baseline-repository");

const root = require("path").join(__dirname, "..");

// Rolling window of recent market prices used to compute the baseline average.
// Previously the average was a cumulative mean over all observations ever (it
// never "rolled") and was fed only the cheapest listing each scan (biasing it
// low). It now averages the most recent N prices across all valid listings.
const DEFAULT_WINDOW_SIZE = Number(process.env.BASELINE_WINDOW_SIZE) || 50;

function readBaselines() {
  return readBaselinesFromStore(root);
}

function writeBaselines(baselines) {
  writeBaselinesToStore(root, baselines);
}

function getBaselineKey(store, watchName) {
  return `${store}:${watchName}`;
}

function getBaseline(store, watchName) {
  const baselines = readBaselines();
  return baselines[getBaselineKey(store, watchName)] ?? null;
}

// Pure: given the existing baseline entry (or undefined) and a batch of prices,
// return the updated entry. lowestSeen/highestSeen stay all-time; averagePrice
// and marketSampleSize reflect the rolling window only.
function computeUpdatedBaseline(
  existing,
  prices,
  checkedAt,
  windowSize = DEFAULT_WINDOW_SIZE
) {
  const validPrices = (prices ?? []).filter(
    (price) => typeof price === "number" && Number.isFinite(price)
  );

  if (validPrices.length === 0) {
    return existing ?? null;
  }

  const priorWindow = Array.isArray(existing?.window) ? existing.window : [];
  const window = [...priorWindow, ...validPrices].slice(-windowSize);

  const sum = window.reduce((total, price) => total + price, 0);
  const averagePrice = Number((sum / window.length).toFixed(2));

  const lowestSeen = Math.min(existing?.lowestSeen ?? Infinity, ...validPrices);
  const highestSeen = Math.max(existing?.highestSeen ?? -Infinity, ...validPrices);

  return {
    averagePrice,
    marketSampleSize: window.length,
    lowestSeen,
    highestSeen,
    window,
    updatedAt: checkedAt,
  };
}

function updateBaseline(store, watchName, prices, checkedAt) {
  const baselines = readBaselines();
  const key = getBaselineKey(store, watchName);

  const updated = computeUpdatedBaseline(baselines[key], prices, checkedAt);
  if (!updated) {
    return baselines[key] ?? null;
  }

  baselines[key] = updated;
  writeBaselines(baselines);
  return updated;
}

module.exports = { updateBaseline, getBaseline, computeUpdatedBaseline };

const {
  readBaselines: readBaselinesFromStore,
  writeBaselines: writeBaselinesToStore,
} = require("./repositories/baseline-repository");

const root = require("path").join(__dirname, "..");

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

function updateBaseline(result) {
  if (result.price === null) return null;

  const baselines = readBaselines();
  const key = getBaselineKey(result.store, result.watchName);
  const existing = baselines[key];

  if (!existing) {
    baselines[key] = {
      averagePrice: result.price,
      marketSampleSize: 1,
      lowestSeen: result.price,
      highestSeen: result.price,
      updatedAt: result.checkedAt,
    };
  } else {
    const marketSampleSize = existing.marketSampleSize + 1;
    const averagePrice =
      (existing.averagePrice * existing.marketSampleSize + result.price) /
      marketSampleSize;

    baselines[key] = {
      averagePrice: Number(averagePrice.toFixed(2)),
      marketSampleSize,
      lowestSeen: Math.min(existing.lowestSeen, result.price),
      highestSeen: Math.max(existing.highestSeen, result.price),
      updatedAt: result.checkedAt,
    };
  }

  writeBaselines(baselines);
  return baselines[key];
}

module.exports = { updateBaseline, getBaseline };

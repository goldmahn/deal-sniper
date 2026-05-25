const fs = require("fs");
const path = require("path");

const baselinesPath = path.join(__dirname, "..", "data", "baselines.json");

function readBaselines() {
  if (!fs.existsSync(baselinesPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
  } catch {
    return {};
  }
}

function writeBaselines(baselines) {
  fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + "\n");
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

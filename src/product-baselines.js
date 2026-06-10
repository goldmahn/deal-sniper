const {
  readProductBaselines: readProductBaselinesFromStore,
  writeProductBaselines: writeProductBaselinesToStore,
} = require("./repositories/product-baseline-repository");
const { computeUpdatedBaseline } = require("./baselines");

const root = require("path").join(__dirname, "..");

function readProductBaselines() {
  return readProductBaselinesFromStore(root);
}

function writeProductBaselines(baselines) {
  writeProductBaselinesToStore(root, baselines);
}

function getProductBaselineKey(store, productKey) {
  return `${store}:${productKey}`;
}

function getProductBaseline(store, productKey) {
  if (!productKey) {
    return null;
  }

  const baselines = readProductBaselines();
  return baselines[getProductBaselineKey(store, productKey)] ?? null;
}

function updateProductBaseline(store, productKey, price, checkedAt) {
  if (!productKey || price === null) {
    return null;
  }

  const baselines = readProductBaselines();
  const key = getProductBaselineKey(store, productKey);
  const updated = computeUpdatedBaseline(baselines[key], [price], checkedAt);

  if (!updated) {
    return baselines[key] ?? null;
  }

  baselines[key] = updated;
  writeProductBaselines(baselines);
  return updated;
}

function updateProductBaselinesFromListings(listings) {
  const updates = new Map();

  for (const listing of listings) {
    if (!listing.productKey || listing.price === null) {
      continue;
    }

    const updated = updateProductBaseline(
      listing.store,
      listing.productKey,
      listing.price,
      listing.checkedAt
    );
    updates.set(listing.productKey, updated);
  }

  return updates;
}

module.exports = {
  getProductBaseline,
  getProductBaselineKey,
  updateProductBaseline,
  updateProductBaselinesFromListings,
  readProductBaselines,
};

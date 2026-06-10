const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateAnomaly,
  evaluateManualTarget,
} = require("../src/anomaly-engine");

function makeListing(overrides = {}) {
  return {
    price: 100,
    validationPassed: true,
    identityConfidence: "high",
    productKey: "newegg:item:TEST1",
    store: "newegg",
    watchName: "DDR5 32GB Newegg Test",
    title: "DDR5 32GB Desktop Memory Model TEST-123",
    url: "https://www.newegg.com/p/TEST1",
    targetPrice: null,
    ...overrides,
  };
}

function makeBaseline(averagePrice, marketSampleSize = 10) {
  return { averagePrice, marketSampleSize, lowestSeen: averagePrice, highestSeen: averagePrice };
}

test("severe anomaly fires at 70% below product baseline", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 30 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, true);
  assert.equal(result.severity, "severe");
  assert.equal(result.baselineSource, "product");
  assert.equal(result.dropPercent, 70);
});

test("critical anomaly fires at 85% below product baseline", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 15 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, true);
  assert.equal(result.severity, "critical");
  assert.equal(result.baselineSource, "product");
  assert.equal(result.dropPercent, 85);
});

test("absurd anomaly fires at 90% below product baseline", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 10 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, true);
  assert.equal(result.severity, "absurd");
  assert.equal(result.baselineSource, "product");
  assert.equal(result.dropPercent, 90);
});

test("ordinary 15-40% discounts do not fire", () => {
  for (const price of [60, 75, 85]) {
    const result = evaluateAnomaly({
      listing: makeListing({ price }),
      productBaseline: makeBaseline(100, 12),
      watchBaseline: makeBaseline(100, 12),
    });

    assert.equal(result.shouldAlert, false, `price ${price} should not alert`);
  }
});

test("low-confidence identity does not fire", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ identityConfidence: "medium", price: 10 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, false);
});

test("missing productKey does not fire", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ productKey: null, price: 10 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, false);
});

test("failed validation does not fire", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ validationPassed: false, price: 10 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.equal(result.shouldAlert, false);
});

test("product baseline is preferred over watch baseline", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 30 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(200, 12),
  });

  assert.equal(result.shouldAlert, true);
  assert.equal(result.severity, "severe");
  assert.equal(result.baselineSource, "product");
  assert.equal(result.baselineAverage, 100);
});

test("watch baseline fallback only fires at absurd threshold", () => {
  const youngProduct = makeBaseline(100, 5);
  const watch = makeBaseline(100, 12);

  const severeOnly = evaluateAnomaly({
    listing: makeListing({ price: 30 }),
    productBaseline: youngProduct,
    watchBaseline: watch,
  });
  assert.equal(severeOnly.shouldAlert, false);

  const absurd = evaluateAnomaly({
    listing: makeListing({ price: 10 }),
    productBaseline: youngProduct,
    watchBaseline: watch,
  });
  assert.equal(absurd.shouldAlert, true);
  assert.equal(absurd.severity, "absurd");
  assert.equal(absurd.baselineSource, "watch");
});

test("manual targetPrice override is separate from anomaly detection", () => {
  const anomaly = evaluateAnomaly({
    listing: makeListing({ price: 75, targetPrice: 80 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });
  const manual = evaluateManualTarget({
    listing: makeListing({ price: 75, targetPrice: 80 }),
  });

  assert.equal(anomaly.shouldAlert, false);
  assert.equal(manual.shouldAlert, true);
  assert.match(manual.explanation, /manual target/i);
});

test("anomaly explanation includes drop percent and baseline source", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 10 }),
    productBaseline: makeBaseline(100, 12),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.match(result.explanation, /90%/);
  assert.match(result.explanation, /this product/i);
});

test("watch fallback explanation references watch/category baseline", () => {
  const result = evaluateAnomaly({
    listing: makeListing({ price: 10 }),
    productBaseline: makeBaseline(100, 5),
    watchBaseline: makeBaseline(100, 12),
  });

  assert.match(result.explanation, /watch\/category fallback baseline/i);
});

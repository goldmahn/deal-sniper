const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeUpdatedBaseline } = require("../src/baselines");

const AT = "2026-05-29T00:00:00.000Z";

test("creates a fresh baseline from the first batch of prices", () => {
  const entry = computeUpdatedBaseline(undefined, [100, 120, 80], AT);
  assert.equal(entry.averagePrice, 100); // (100+120+80)/3
  assert.equal(entry.marketSampleSize, 3);
  assert.equal(entry.lowestSeen, 80);
  assert.equal(entry.highestSeen, 120);
  assert.deepEqual(entry.window, [100, 120, 80]);
  assert.equal(entry.updatedAt, AT);
});

test("averages the whole market, not just the cheapest listing", () => {
  // Regression for the old behavior that fed only the minimum price in.
  const entry = computeUpdatedBaseline(undefined, [60, 200], AT);
  assert.equal(entry.averagePrice, 130);
});

test("rolls: old prices age out once the window is exceeded", () => {
  const start = computeUpdatedBaseline(undefined, [10, 10], AT, 3);
  const next = computeUpdatedBaseline(start, [40, 40], AT, 3);
  // window capped at 3 -> [10, 40, 40], not all four
  assert.deepEqual(next.window, [10, 40, 40]);
  assert.equal(next.marketSampleSize, 3);
  assert.equal(next.averagePrice, 30);
});

test("lowestSeen / highestSeen remain all-time even after they leave the window", () => {
  const start = computeUpdatedBaseline(undefined, [500], AT, 2);
  const next = computeUpdatedBaseline(start, [100, 110], AT, 2);
  assert.deepEqual(next.window, [100, 110]); // 500 aged out of the window
  assert.equal(next.lowestSeen, 100);
  assert.equal(next.highestSeen, 500); // but still remembered all-time
});

test("ignores null / non-finite prices and returns existing entry when batch empty", () => {
  const existing = computeUpdatedBaseline(undefined, [100], AT);
  const unchanged = computeUpdatedBaseline(existing, [null, NaN], AT);
  assert.deepEqual(unchanged, existing);
  assert.equal(computeUpdatedBaseline(undefined, [], AT), null);
});

test("migrates a legacy entry that has no window array", () => {
  const legacy = {
    averagePrice: 369.99,
    marketSampleSize: 1,
    lowestSeen: 369.99,
    highestSeen: 369.99,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const entry = computeUpdatedBaseline(legacy, [300], AT, 50);
  assert.deepEqual(entry.window, [300]);
  assert.equal(entry.averagePrice, 300);
  assert.equal(entry.lowestSeen, 300); // min(369.99, 300)
  assert.equal(entry.highestSeen, 369.99); // all-time high preserved
});

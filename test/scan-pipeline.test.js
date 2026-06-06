const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  pickWatchCandidate,
  shouldAlert,
  validateListings,
  enrichIdentity,
  dedupeListings,
  selectCandidate,
  annotateHistoryRow,
  evaluateAlert,
} = require("../src/scan-pipeline");

test("pickWatchCandidate returns the lowest-priced listing", () => {
  const candidate = pickWatchCandidate([
    { price: 100 },
    { price: 70 },
    { price: 85 },
  ]);
  assert.equal(candidate.price, 70);
});

test("pickWatchCandidate skips null prices and returns null when none priced", () => {
  assert.equal(pickWatchCandidate([{ price: null }, { price: null }]), null);
  assert.equal(pickWatchCandidate([]), null);

  const candidate = pickWatchCandidate([{ price: null }, { price: 42 }]);
  assert.equal(candidate.price, 42);
});

test("shouldAlert fires when price meets the target", () => {
  assert.equal(shouldAlert({ price: 75, targetPrice: 80 }, null), true);
  assert.equal(shouldAlert({ price: 85, targetPrice: 80 }, null), false);
});

test("shouldAlert ignores null prices and absent targets", () => {
  assert.equal(shouldAlert({ price: null, targetPrice: 80 }, null), false);
  assert.equal(shouldAlert({ price: 50, targetPrice: null }, null), false);
});

test("shouldAlert anomaly path requires sample size >= 10 and a >=45% drop", () => {
  const ripeBaseline = { marketSampleSize: 10, averagePrice: 100 };

  // 54 <= 55 -> alert; 56 > 55 -> no alert
  assert.equal(shouldAlert({ price: 54, targetPrice: null }, ripeBaseline), true);
  assert.equal(shouldAlert({ price: 56, targetPrice: null }, ripeBaseline), false);

  // Not enough samples yet -> no anomaly alert
  const youngBaseline = { marketSampleSize: 9, averagePrice: 100 };
  assert.equal(shouldAlert({ price: 10, targetPrice: null }, youngBaseline), false);
});

test("validateListings annotates each row with validation outcome", () => {
  const results = [
    { title: "DDR5 32GB (2 x 16GB)" },
    { title: "DDR4 32GB (2 x 16GB)" },
  ];
  validateListings(results, { requirements: { generation: "DDR5" } });
  assert.equal(results[0].validationPassed, true);
  assert.equal(results[1].validationPassed, false);
});

test("enrichIdentity + dedupeListings produce candidate pool and counts", () => {
  const results = [
    {
      store: "newegg",
      validationPassed: true,
      url: "https://www.newegg.com/p/N82E1/x",
      title: "DDR5 32GB",
      price: 100,
    },
    {
      store: "newegg",
      validationPassed: true,
      url: "https://www.newegg.com/p/N82E1/y",
      title: "DDR5 32GB",
      price: 80,
    },
    {
      store: "newegg",
      validationPassed: false,
      url: "https://www.newegg.com/p/N82E2/z",
      title: "nope",
      price: 5,
    },
  ];
  enrichIdentity(results);
  const { validCount, keptForCandidate, duplicatesCollapsed } =
    dedupeListings(results);

  assert.equal(validCount, 2);
  assert.equal(duplicatesCollapsed, 1);
  assert.equal(keptForCandidate.length, 1);

  const candidate = selectCandidate(keptForCandidate);
  assert.equal(candidate.price, 80);
});

test("annotateHistoryRow marks the candidate row and snapshots baseline", () => {
  const candidate = {
    store: "newegg",
    watchName: "W",
    url: "https://www.newegg.com/p/N82E1/y",
    productKey: "newegg:item:N82E1",
    price: 80,
  };
  const baseline = { averagePrice: 120.5, marketSampleSize: 11 };

  const candidateRow = { url: candidate.url };
  annotateHistoryRow(candidateRow, candidate, baseline);
  assert.equal(candidateRow.isWatchCandidate, true);
  assert.equal(candidateRow.baselineAverage, 120.5);
  assert.equal(candidateRow.marketSampleSize, 11);
  assert.equal(candidateRow.alertStateKey, "newegg:W:newegg:item:N82E1");
  assert.equal(candidateRow.alertStateKeySource, "productKey");

  const otherRow = { url: "https://www.newegg.com/p/N82E1/other" };
  annotateHistoryRow(otherRow, candidate, baseline);
  assert.equal(otherRow.isWatchCandidate, false);
  assert.equal(otherRow.alert, false);
  assert.equal(otherRow.alertStateKey, undefined);
});

test("annotateHistoryRow handles the no-candidate case", () => {
  const row = { url: "https://x" };
  annotateHistoryRow(row, null, null);
  assert.equal(row.isWatchCandidate, false);
  assert.equal(row.baselineAverage, null);
  assert.equal(row.marketSampleSize, 0);
  assert.equal(row.alert, false);
});

test("evaluateAlert stores the boolean outcome on the row", () => {
  const row = {};
  const fired = evaluateAlert(row, { price: 75, targetPrice: 80 }, null);
  assert.equal(fired, true);
  assert.equal(row.alert, true);
});

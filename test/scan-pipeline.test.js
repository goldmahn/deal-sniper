const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWatches } = require("../src/repositories/watches-repository");
const {
  pickWatchCandidate,
  validateListings,
  enrichIdentity,
  dedupeListings,
  selectCandidate,
  annotateHistoryRow,
  formatAnomalyAlert,
  formatManualAlert,
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

test("annotateHistoryRow marks candidate row and attaches anomaly alert metadata", () => {
  const candidate = {
    store: "newegg",
    watchName: "W",
    url: "https://www.newegg.com/p/N82E1/y",
    productKey: "newegg:item:N82E1",
    price: 10,
  };
  const baseline = { averagePrice: 120.5, marketSampleSize: 11 };
  const alertOutcome = {
    alert: true,
    alertType: "anomaly",
    alertSeverity: "absurd",
    alertExplanation: "Current price is 90% below recent observed baseline for this product (absurd pricing anomaly).",
    alertDropPercent: 90,
    alertBaselineSource: "product",
    alertBaselineAverage: 100,
    alertBaselineSampleSize: 12,
    alertStateKey: "newegg:W:newegg:item:N82E1",
    alertStateKeySource: "productKey",
    telegramSent: true,
  };

  const candidateRow = { url: candidate.url };
  annotateHistoryRow(candidateRow, candidate, baseline, alertOutcome);
  assert.equal(candidateRow.isWatchCandidate, true);
  assert.equal(candidateRow.baselineAverage, 120.5);
  assert.equal(candidateRow.marketSampleSize, 11);
  assert.equal(candidateRow.alert, true);
  assert.equal(candidateRow.alertType, "anomaly");
  assert.equal(candidateRow.alertSeverity, "absurd");
  assert.equal(candidateRow.telegramSent, true);

  const otherRow = { url: "https://www.newegg.com/p/N82E1/other" };
  annotateHistoryRow(otherRow, candidate, baseline);
  assert.equal(otherRow.isWatchCandidate, false);
  assert.equal(otherRow.alert, false);
});

test("annotateHistoryRow handles the no-candidate case", () => {
  const row = { url: "https://x" };
  annotateHistoryRow(row, null, null);
  assert.equal(row.isWatchCandidate, false);
  assert.equal(row.baselineAverage, null);
  assert.equal(row.marketSampleSize, 0);
  assert.equal(row.alert, false);
});

test("formatAnomalyAlert includes severity, baseline, drop, and explanation", () => {
  const listing = {
    watchName: "DDR5 32GB Newegg Test",
    price: 10,
    title: "Test RAM",
    url: "https://www.newegg.com/p/1",
  };
  const evaluation = {
    severity: "absurd",
    baselineAverage: 100,
    baselineSampleSize: 12,
    baselineSource: "product",
    dropPercent: 90,
    explanation: "Current price is 90% below recent observed baseline for this product (absurd pricing anomaly).",
  };

  const message = formatAnomalyAlert(listing, evaluation);
  assert.match(message, /PRICING ANOMALY \(ABSURD\)/);
  assert.match(message, /Baseline: \$100 \(product, 12 samples\)/);
  assert.match(message, /Drop: 90%/);
  assert.match(message, /Test RAM/);
});

test("formatManualAlert is labeled separately from anomaly alerts", () => {
  const listing = {
    watchName: "DDR5 32GB Newegg Test",
    price: 75,
    targetPrice: 80,
    title: "Test RAM",
    url: "https://www.newegg.com/p/1",
  };
  const evaluation = {
    explanation: "Price $75 is at or below manual target $80.",
  };

  const message = formatManualAlert(listing, evaluation);
  assert.match(message, /MANUAL PRICE TARGET/);
  assert.doesNotMatch(message, /PRICING ANOMALY/);
  assert.match(message, /Manual target: \$80/);
});

test("validateListings enforces 4TB NVMe watch requirements from data/products.json", () => {
  const root = path.join(__dirname, "..");
  const watch = loadWatches(root).find(
    (entry) => entry.name === "4TB NVMe SSD Newegg Category"
  );

  assert.ok(watch);
  assert.equal(watch.requirements.storageCapacityTB, 4);

  const rejectTitles = [
    "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe 1.4 PCIe 4.0 Gen4 Gaming SSD, Speed Up to 7400MB/s, 3D TLC NAND, Internal Solid State Disk Compatible for PS5",
    "SANDISK Optimus™ GX 7100M PCIe® 4.0 x4 M.2 2230 NVMe™ 1TB SSD 3D NAND TLC Internal Solid State Drive (SSD) SDSP71100TAT-000E0",
    "SANDISK Optimus™ GX 7100M PCIe® 4.0 x4 M.2 2230 NVMe™ 2TB SSD 3D NAND TLC Internal Solid State Drive (SSD) SDSP71200TAT-000E0",
  ];

  for (const title of rejectTitles) {
    const results = [{ title }];
    validateListings(results, watch);
    assert.equal(results[0].validationPassed, false, title);
  }

  const passResults = [
    {
      title:
        "Western Digital 4TB WD Blue SN5000 NVMe SSD, PCIe Gen 4.0, up to 5,500 MB/s Read Speeds Internal Solid State Drive (SSD)",
    },
  ];
  validateListings(passResults, watch);
  assert.equal(passResults[0].validationPassed, true);
});

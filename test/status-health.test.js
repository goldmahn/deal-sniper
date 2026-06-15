const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");

const {
  summarizeProductBaselines,
  loadProductBaselinesSummary,
  scanLogTextForAlertTypes,
  scanLogFilesForAlertTypes,
  formatProductBaselineKey,
  buildAnomalyEngineHealthLines,
  readRecentLogTail,
} = require("../src/status-health");

test("summarizeProductBaselines counts qualified products and price variation", () => {
  const summary = summarizeProductBaselines(
    {
      "newegg:newegg:item:A": {
        marketSampleSize: 12,
        averagePrice: 100,
        lowestSeen: 90,
        highestSeen: 110,
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      "newegg:newegg:item:B": {
        marketSampleSize: 5,
        averagePrice: 200,
        lowestSeen: 200,
        highestSeen: 200,
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      "newegg:newegg:item:C": {
        marketSampleSize: 50,
        averagePrice: 50,
        lowestSeen: 50,
        highestSeen: 75,
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
    },
    10
  );

  assert.equal(summary.count, 3);
  assert.equal(summary.qualifiedCount, 2);
  assert.equal(summary.maxSampleSize, 50);
  assert.equal(summary.priceVariedCount, 2);
  assert.equal(summary.mostRecentUpdatedAt, "2026-06-03T00:00:00.000Z");
  assert.equal(summary.top5[0].key, "newegg:newegg:item:C");
});

test("loadProductBaselinesSummary reports missing file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-status-"));
  const loaded = loadProductBaselinesSummary(root, 10);
  assert.equal(loaded.exists, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("loadProductBaselinesSummary reads valid product baselines", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-status-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data", "product-baselines.json"),
    JSON.stringify({
      "newegg:newegg:item:TEST": {
        marketSampleSize: 11,
        averagePrice: 99,
        lowestSeen: 99,
        highestSeen: 99,
        updatedAt: "2026-06-10T00:00:00.000Z",
      },
    })
  );

  const loaded = loadProductBaselinesSummary(root, 10);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.summary.count, 1);
  assert.equal(loaded.summary.qualifiedCount, 1);

  fs.rmSync(root, { recursive: true, force: true });
});

test("scanLogTextForAlertTypes detects anomaly and manual markers", () => {
  assert.deepEqual(scanLogTextForAlertTypes(""), {
    hasAnomaly: false,
    hasManual: false,
  });

  assert.deepEqual(
    scanLogTextForAlertTypes("DEAL SNIPER — PRICING ANOMALY (CRITICAL)"),
    { hasAnomaly: true, hasManual: false }
  );

  assert.deepEqual(
    scanLogTextForAlertTypes("DEAL SNIPER — MANUAL PRICE TARGET\nother"),
    { hasAnomaly: false, hasManual: true }
  );
});

test("scanLogFilesForAlertTypes merges results across files", () => {
  const merged = scanLogFilesForAlertTypes([
    "plain scan log",
    "PRICING ANOMALY (SEVERE)",
    "MANUAL PRICE TARGET",
  ]);

  assert.equal(merged.hasAnomaly, true);
  assert.equal(merged.hasManual, true);
});

test("formatProductBaselineKey shortens Newegg item ids", () => {
  assert.equal(
    formatProductBaselineKey("newegg:newegg:item:N82E16820982007"),
    "N82E16820982007"
  );
});

test("buildAnomalyEngineHealthLines renders concise health section", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-status-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data", "product-baselines.json"),
    JSON.stringify({
      "newegg:newegg:item:TOP": {
        marketSampleSize: 20,
        averagePrice: 400,
        lowestSeen: 390,
        highestSeen: 410,
        updatedAt: "2026-06-10T12:00:00.000Z",
      },
    })
  );

  const lines = buildAnomalyEngineHealthLines({
    root,
    minSamples: 10,
    logTexts: ["PRICING ANOMALY (ABSURD)"],
  });

  assert.match(lines.join("\n"), /product-baselines\.json: present \(1 products\)/);
  assert.match(lines.join("\n"), /Qualified for product-level anomaly \(>=10 samples\): 1\/1/);
  assert.match(lines.join("\n"), /Top 5 by sample size:/);
  assert.match(lines.join("\n"), /TOP samples=20 avg=\$400/);
  assert.match(lines.join("\n"), /PRICING ANOMALY: seen in recent logs/);
  assert.match(lines.join("\n"), /MANUAL PRICE TARGET: not seen in recent logs/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("readRecentLogTail returns only the last N lines", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-status-"));
  const logPath = path.join(root, "tail.log");
  fs.writeFileSync(logPath, "a\nb\nc\nd\n");

  assert.equal(readRecentLogTail(logPath, 2), "c\nd");

  fs.rmSync(root, { recursive: true, force: true });
});

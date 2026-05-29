const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const baselineRepo = require("../src/repositories/baseline-repository");
const alertStateRepo = require("../src/repositories/alert-state-repository");
const watchesRepo = require("../src/repositories/watches-repository");

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dealsniper-test-"));
  fs.mkdirSync(path.join(root, "data"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("readBaselines returns {} when the file does not exist", () => {
  assert.deepEqual(baselineRepo.readBaselines(root), {});
});

test("baselines survive a write/read round-trip", () => {
  const data = { "newegg:W": { averagePrice: 99.5, marketSampleSize: 3 } };
  baselineRepo.writeBaselines(root, data);
  assert.deepEqual(baselineRepo.readBaselines(root), data);
});

test("readBaselines recovers from a corrupt file by returning {}", () => {
  fs.writeFileSync(baselineRepo.getBaselinesPath(root), "{ not json");
  assert.deepEqual(baselineRepo.readBaselines(root), {});
});

test("alert state returns {} when missing and round-trips when written", () => {
  assert.deepEqual(alertStateRepo.readAlertState(root), {});
  const data = {
    "newegg:W:newegg:item:X": { lastAlertedAt: "2026-05-01T00:00:00.000Z", lastAlertedPrice: 70 },
  };
  alertStateRepo.writeAlertState(root, data);
  assert.deepEqual(alertStateRepo.readAlertState(root), data);
});

test("readAlertState recovers from a corrupt file", () => {
  fs.writeFileSync(alertStateRepo.getAlertStatePath(root), "garbage");
  assert.deepEqual(alertStateRepo.readAlertState(root), {});
});

test("loadWatches parses the products.json array", () => {
  const watches = [{ name: "W", store: "newegg", url: "https://x" }];
  fs.writeFileSync(
    watchesRepo.getWatchesPath(root),
    JSON.stringify(watches)
  );
  assert.deepEqual(watchesRepo.loadWatches(root), watches);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyNvmeSegment,
  assessExpectedCapacity,
  summarizeSegmentPrices,
  buildRecommendation,
} = require("../src/nvme-segment-classifier");

test("classifies consumer NVMe drives", () => {
  const result = classifyNvmeSegment(
    "Western Digital 4TB WD Blue SN5000 NVMe SSD, PCIe Gen 4.0"
  );
  assert.equal(result.segment, "Consumer NVMe");
});

test("classifies gaming / enthusiast NVMe drives", () => {
  const byBlack = classifyNvmeSegment(
    "WD_BLACK 4TB SN850X NVMe Internal Gaming SSD Solid State Drive"
  );
  assert.equal(byBlack.segment, "Gaming / Enthusiast NVMe");

  const byGen5 = classifyNvmeSegment(
    "SAMSUNG SSD 9100 PRO 4TB, PCIe 5.0x4 M.2 2280"
  );
  assert.equal(byGen5.segment, "Gaming / Enthusiast NVMe");
});

test("classifies enterprise / workstation NVMe drives", () => {
  const result = classifyNvmeSegment(
    "Micron 7450 PRO 4TB NVMe U.3 Datacenter SSD"
  );
  assert.equal(result.segment, "Enterprise / Workstation NVMe");
});

test("assessExpectedCapacity flags non-4TB listings", () => {
  const wrongGb = assessExpectedCapacity(
    "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe 1.4 PCIe 4.0 Gen4 Gaming SSD",
    4
  );
  assert.equal(wrongGb.status, "wrong_capacity");

  const wrongTb = assessExpectedCapacity(
    "SANDISK Optimus GX 7100M PCIe 4.0 x4 M.2 2230 NVMe 1TB SSD",
    4
  );
  assert.equal(wrongTb.status, "wrong_capacity");

  const ok = assessExpectedCapacity(
    "Crucial P310 M.2 2280 4TB PCI-Express 4.0 x4 NVMe Internal SSD",
    4
  );
  assert.equal(ok.status, "matches_expected");
});

test("summarizeSegmentPrices computes count, range, and average", () => {
  const stats = summarizeSegmentPrices([
    { price: 100 },
    { price: 200 },
    { price: 300 },
  ]);
  assert.equal(stats.count, 3);
  assert.equal(stats.min, 100);
  assert.equal(stats.max, 300);
  assert.equal(stats.average, 200);
});

test("buildRecommendation prioritizes validation cleanup when capacity is wrong", () => {
  const recommendation = buildRecommendation(
    {
      "Consumer NVMe": { count: 3, average: 450 },
      "Gaming / Enthusiast NVMe": { count: 4, average: 800 },
      "Enterprise / Workstation NVMe": { count: 0 },
    },
    {
      capacityAssessment: { status: "wrong_capacity" },
    }
  );
  assert.equal(recommendation.choice, "validation_first");
});

test("buildRecommendation suggests consumer vs enthusiast split when bands separate", () => {
  const recommendation = buildRecommendation(
    {
      "Consumer NVMe": { count: 3, average: 470 },
      "Gaming / Enthusiast NVMe": { count: 4, average: 780 },
      "Enterprise / Workstation NVMe": { count: 0 },
    },
    {
      capacityAssessment: { status: "matches_expected" },
    }
  );
  assert.equal(recommendation.choice, "C");
});

test("recommendBaselineCleanup suggests rebuild when polluted low persists in window", () => {
  const { recommendBaselineCleanup } = require("../src/storage-capacity");
  const recommendation = recommendBaselineCleanup({
    baseline: {
      lowestSeen: 104.99,
      window: Array(6).fill(104.99).concat(Array(44).fill(479.99)),
    },
    validListingCount: 25,
    pollutedListingCount: 4,
    pollutedPrices: [104.99, 299.99, 599.99, 699.99],
  });

  assert.equal(recommendation.choice, "B");
});

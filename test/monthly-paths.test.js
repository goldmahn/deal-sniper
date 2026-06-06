const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  yearMonth,
  priceHistoryPath,
  dealsniperLogPath,
} = require("../src/monthly-paths");

test("yearMonth formats as YYYY-MM with zero padding", () => {
  assert.equal(yearMonth(new Date("2026-01-09T00:00:00Z")), "2026-01");
  assert.equal(yearMonth(new Date("2026-11-30T00:00:00Z")), "2026-11");
});

test("priceHistoryPath builds the monthly data file path", () => {
  const p = priceHistoryPath("/root", "2026-05");
  assert.equal(p, path.join("/root", "data", "price-history-2026-05.jsonl"));
});

test("dealsniperLogPath builds the monthly log file path", () => {
  const p = dealsniperLogPath("/root", "2026-05");
  assert.equal(p, path.join("/root", "logs", "dealsniper-2026-05.log"));
});

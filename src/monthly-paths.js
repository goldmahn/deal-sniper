const path = require("path");

function yearMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function priceHistoryPath(root, ym = yearMonth()) {
  return path.join(root, "data", `price-history-${ym}.jsonl`);
}

function dealsniperLogPath(root, ym = yearMonth()) {
  return path.join(root, "logs", `dealsniper-${ym}.log`);
}

const LEGACY_PRICE_HISTORY = "data/price-history.jsonl";
const LEGACY_LOG = "logs/dealsniper.log";

module.exports = {
  yearMonth,
  priceHistoryPath,
  dealsniperLogPath,
  LEGACY_PRICE_HISTORY,
  LEGACY_LOG,
};

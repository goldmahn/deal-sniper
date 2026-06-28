const { HEALTH } = require("../../src/health/levels");

const SCAN_WINDOW = {
  start: "2026-06-24T22:56:21.467Z",
  end: "2026-06-24T22:56:43.237Z",
};

const LOG_ALL_GREEN = `
[2026-06-24T22:56:21.467Z] Scan started watches=1 headless=true
[2026-06-24T22:56:43.237Z] Scan ended durationSec=21.8 watches=1 listingsScraped=10 listingsValid=10 duplicatesCollapsed=0 candidates=1 alerts=0 telegramSends=0
`;

const WATCH = {
  name: "Test NVMe Watch",
  store: "newegg",
  requirements: {
    storageCapacityTB: 2,
    mustInclude: ["NVMe"],
  },
};

function makeHistoryRow(overrides = {}) {
  return {
    checkedAt: SCAN_WINDOW.end,
    watchName: WATCH.name,
    store: "newegg",
    title: "SanDisk 2TB NVMe M.2 Internal SSD",
    price: 249.99,
    validationPassed: true,
    isWatchCandidate: true,
    productKey: "newegg:item:GOOD",
    identityConfidence: "high",
    dedupeRole: "kept",
    ...overrides,
  };
}

function makeHealthyBatchHistory() {
  return Array.from({ length: 4 }, (_, index) => ({
    checkedAt: `2026-06-24T22:${40 + index * 15}:00.000Z`,
    listingsScraped: 10,
    listingsValid: 10,
    validationRate: 1,
    candidateFound: true,
    duplicatesCollapsed: 0,
  }));
}

function makeBaseline(overrides = {}) {
  return {
    averagePrice: 250,
    marketSampleSize: 10,
    lowestSeen: 236.99,
    highestSeen: 299.99,
    updatedAt: SCAN_WINDOW.end,
    ...overrides,
  };
}

module.exports = {
  HEALTH,
  SCAN_WINDOW,
  LOG_ALL_GREEN,
  WATCH,
  makeHistoryRow,
  makeHealthyBatchHistory,
  makeBaseline,
};

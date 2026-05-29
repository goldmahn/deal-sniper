const fs = require("fs");
const { priceHistoryPath } = require("../monthly-paths");

function appendObservation(root, record) {
  const historyPath = priceHistoryPath(root);
  fs.appendFileSync(historyPath, JSON.stringify(record) + "\n");
}

module.exports = { appendObservation };

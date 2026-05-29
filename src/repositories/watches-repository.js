const fs = require("fs");
const path = require("path");

const WATCHES_FILE = "products.json";

function getWatchesPath(root) {
  return path.join(root, "data", WATCHES_FILE);
}

function loadWatches(root) {
  const watchesPath = getWatchesPath(root);
  const raw = fs.readFileSync(watchesPath, "utf8");
  return JSON.parse(raw);
}

module.exports = { loadWatches, getWatchesPath, WATCHES_FILE };

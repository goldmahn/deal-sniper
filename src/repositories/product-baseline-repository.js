const fs = require("fs");
const path = require("path");

const PRODUCT_BASELINES_FILE = "product-baselines.json";

function getProductBaselinesPath(root = path.join(__dirname, "..", "..")) {
  return path.join(root, "data", PRODUCT_BASELINES_FILE);
}

function readProductBaselines(root) {
  const baselinesPath = getProductBaselinesPath(root);

  if (!fs.existsSync(baselinesPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
  } catch {
    return {};
  }
}

function writeProductBaselines(root, baselines) {
  const baselinesPath = getProductBaselinesPath(root);
  fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + "\n");
}

module.exports = {
  readProductBaselines,
  writeProductBaselines,
  getProductBaselinesPath,
  PRODUCT_BASELINES_FILE,
};

const fs = require("fs");
const path = require("path");

const BASELINES_FILE = "baselines.json";

function getBaselinesPath(root = path.join(__dirname, "..", "..")) {
  return path.join(root, "data", BASELINES_FILE);
}

function readBaselines(root) {
  const baselinesPath = getBaselinesPath(root);

  if (!fs.existsSync(baselinesPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
  } catch {
    return {};
  }
}

function writeBaselines(root, baselines) {
  const baselinesPath = getBaselinesPath(root);
  fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + "\n");
}

module.exports = {
  readBaselines,
  writeBaselines,
  getBaselinesPath,
  BASELINES_FILE,
};

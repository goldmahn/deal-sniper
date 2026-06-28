const fs = require("fs");

const { getBaselinesPath } = require("../repositories/baseline-repository");
const {
  getProductBaselinesPath,
  PRODUCT_BASELINES_FILE,
} = require("../repositories/product-baseline-repository");
const { BASELINES_FILE } = require("../repositories/baseline-repository");

function inspectJsonFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return {
      label,
      exists: false,
      readable: false,
      parseable: false,
      error: "missing",
    };
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return {
      label,
      exists: true,
      readable: false,
      parseable: false,
      error: "not readable",
    };
  }

  try {
    JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      label,
      exists: true,
      readable: true,
      parseable: true,
      error: null,
    };
  } catch (error) {
    return {
      label,
      exists: true,
      readable: true,
      parseable: false,
      error: error.message,
    };
  }
}

function inspectBaselineFiles(root) {
  const watchBaselines = inspectJsonFile(getBaselinesPath(root), BASELINES_FILE);
  const productBaselines = inspectJsonFile(
    getProductBaselinesPath(root),
    PRODUCT_BASELINES_FILE
  );

  return {
    watchBaselines,
    productBaselines,
  };
}

module.exports = {
  inspectJsonFile,
  inspectBaselineFiles,
};

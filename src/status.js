const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const {
  yearMonth,
  priceHistoryPath,
  dealsniperLogPath,
  LEGACY_PRICE_HISTORY,
  LEGACY_LOG,
} = require("./monthly-paths");
const { getLogPath } = require("./logger");
const {
  buildAnomalyEngineHealthLines,
  collectRecentAlertLogTexts,
} = require("./status-health");
const { PRODUCT_BASELINES_FILE } = require("./repositories/product-baseline-repository");

const root = path.join(__dirname, "..");

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileInfo(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return `${relativePath}: missing`;
  }

  const { size, mtime } = fs.statSync(fullPath);
  return `${relativePath}: ${formatBytes(size)} (modified ${mtime.toISOString()})`;
}

const ym = yearMonth();
const currentHistoryRel = path.relative(root, priceHistoryPath(root, ym));
const currentLogRel = path.relative(root, dealsniperLogPath(root, ym));

console.log("=== Deal Sniper Status ===\n");
console.log(`Current month: ${ym}\n`);

function findWatchProcesses() {
  try {
    if (process.platform === "win32") {
      // Match node.exe processes whose command line includes watch.js. Filtering
      // on Name='node.exe' avoids matching this PowerShell invocation itself.
      const psCommand =
        "Get-CimInstance Win32_Process -Filter \\\"name='node.exe'\\\" | " +
        "Where-Object { $_.CommandLine -like '*watch.js*' } | " +
        "ForEach-Object { ([string]$_.ProcessId) + ' ' + $_.CommandLine }";
      return execSync(`powershell -NoProfile -Command "${psCommand}"`, {
        encoding: "utf8",
      }).trim();
    }

    return execSync('pgrep -fl "src/watch.js"', { encoding: "utf8" }).trim();
  } catch {
    // pgrep exits 1 (and PowerShell may error) when there is no match.
    return "";
  }
}

let watchRunning = false;
const matches = findWatchProcesses();

if (matches) {
  watchRunning = true;
  console.log("Watch process: RUNNING");
  for (const line of matches.split("\n")) {
    console.log(`  ${line.trim()}`);
  }
}

if (!watchRunning) {
  console.log("Watch process: not running");
}

console.log("\n--- Latest log (last 15 lines) ---");
const logPath = getLogPath();
if (fs.existsSync(logPath)) {
  const lines = fs.readFileSync(logPath, "utf8").trimEnd().split("\n");
  const tail = lines.slice(-15);
  if (tail.length === 0) {
    console.log("(empty)");
  } else {
    for (const line of tail) {
      console.log(line);
    }
  }
} else {
  console.log("(no log file yet — run a scan first)");
}

console.log("\n--- Data files (current month) ---");
for (const relativePath of [
  currentHistoryRel,
  currentLogRel,
  "data/baselines.json",
  path.join("data", PRODUCT_BASELINES_FILE),
  "data/alert-state.json",
]) {
  console.log(fileInfo(relativePath));
}

const legacyPaths = [LEGACY_PRICE_HISTORY, LEGACY_LOG];
const legacyPresent = legacyPaths.filter((p) =>
  fs.existsSync(path.join(root, p))
);
if (legacyPresent.length > 0) {
  console.log("\n--- Legacy files (not written to anymore) ---");
  for (const relativePath of legacyPresent) {
    console.log(fileInfo(relativePath));
  }
}

console.log("\n--- Baselines ---");
const baselinesPath = path.join(root, "data", "baselines.json");
if (!fs.existsSync(baselinesPath)) {
  console.log("(none)");
} else {
  try {
    const baselines = JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
    const keys = Object.keys(baselines);

    if (keys.length === 0) {
      console.log("(empty)");
    } else {
      for (const key of keys) {
        const entry = baselines[key];
        console.log(
          `${key}: avg=$${entry.averagePrice} samples=${entry.marketSampleSize} low=$${entry.lowestSeen} high=$${entry.highestSeen} updated=${entry.updatedAt}`
        );
      }
    }
  } catch (error) {
    console.log(`(failed to read baselines: ${error.message})`);
  }
}

console.log("");
for (const line of buildAnomalyEngineHealthLines({
  root,
  logTexts: collectRecentAlertLogTexts(root, {
    monthLogPath: logPath,
  }),
})) {
  console.log(line);
}

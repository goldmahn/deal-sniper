const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const logPath = path.join(root, "logs", "dealsniper.log");

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

console.log("=== Deal Sniper Status ===\n");

let watchRunning = false;
try {
  const matches = execSync('pgrep -fl "src/watch.js"', {
    encoding: "utf8",
  }).trim();

  if (matches) {
    watchRunning = true;
    console.log("Watch process: RUNNING");
    for (const line of matches.split("\n")) {
      console.log(`  ${line}`);
    }
  }
} catch {
  // pgrep exits 1 when no match
}

if (!watchRunning) {
  console.log("Watch process: not running");
}

console.log("\n--- Latest log (last 15 lines) ---");
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

console.log("\n--- Data files ---");
for (const relativePath of [
  "data/baselines.json",
  "data/price-history.jsonl",
  "data/alert-state.json",
  "logs/dealsniper.log",
]) {
  console.log(fileInfo(relativePath));
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

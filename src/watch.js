require("dotenv").config();

const { runScan } = require("./scan");
const { writeLog } = require("./logger");

const pollIntervalMinutes = Number(process.env.POLL_INTERVAL_MINUTES) || 15;
const pollIntervalMs = pollIntervalMinutes * 60 * 1000;

let scanInProgress = false;

function logNextTick() {
  const nextAt = new Date(Date.now() + pollIntervalMs);
  console.log(
    `[watch] Next scan tick at ${nextAt.toISOString()} (in ${pollIntervalMinutes} minutes)`
  );
}

async function runScanTick() {
  if (scanInProgress) {
    console.log(
      `[watch] ${new Date().toISOString()} Skipping tick — previous scan still running`
    );
    writeLog("Watch tick skipped reason=scan_in_progress");
    logNextTick();
    return;
  }

  scanInProgress = true;
  const startedAt = new Date();
  console.log(`[watch] Scan started at ${startedAt.toISOString()}`);

  try {
    await runScan();
  } catch (error) {
    console.error(`[watch] Scan failed: ${error.message}`);
    writeLog(`ERROR Watch tick failed: ${error.message}`);
  } finally {
    scanInProgress = false;
    const endedAt = new Date();
    const durationSec = ((endedAt - startedAt) / 1000).toFixed(1);
    console.log(
      `[watch] Scan ended at ${endedAt.toISOString()} (duration ${durationSec}s)`
    );
    logNextTick();
  }
}

console.log(
  `[watch] Deal Sniper watch mode — poll interval ${pollIntervalMinutes} minutes`
);
writeLog(`Watch mode started intervalMinutes=${pollIntervalMinutes}`);
logNextTick();
runScanTick();
setInterval(runScanTick, pollIntervalMs);

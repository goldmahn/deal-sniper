require("dotenv").config();

const { runScan } = require("./scan");

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
logNextTick();
runScanTick();
setInterval(runScanTick, pollIntervalMs);

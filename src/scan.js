require("dotenv").config();

const { chromium } = require("playwright");
const path = require("path");

const headless = process.env.HEADLESS !== "false";

const { loadWatches } = require("./repositories/watches-repository");
const { appendObservation } = require("./repositories/observation-repository");
const { writeLog } = require("./logger");
const {
  scrapeWatch,
  validateListings,
  enrichIdentity,
  dedupeListings,
  selectCandidate,
  readAndUpdateBaseline,
  annotateHistoryRow,
  evaluateAlert,
  sendAlertIfAllowed,
} = require("./scan-pipeline");

const root = path.join(__dirname, "..");

async function processWatch(page, watch, stats) {
  const scrapeOutcome = await scrapeWatch(page, watch);

  if (scrapeOutcome.unknownStore) {
    console.error(`Unknown store: ${scrapeOutcome.unknownStore}`);
    writeLog(
      `ERROR Unknown store for watch="${watch.name}": ${scrapeOutcome.unknownStore}`
    );
    return;
  }

  let results = scrapeOutcome.results;
  stats.listingsScraped += results.length;

  results = validateListings(results, watch);
  results = enrichIdentity(results);

  const { results: dedupedResults, validCount, keptForCandidate, duplicatesCollapsed } =
    dedupeListings(results);
  results = dedupedResults;

  stats.listingsValid += validCount;
  stats.duplicatesCollapsed += duplicatesCollapsed;

  if (duplicatesCollapsed > 0) {
    writeLog(`Watch "${watch.name}" duplicatesCollapsed=${duplicatesCollapsed}`);
  }

  const candidate = selectCandidate(keptForCandidate);
  if (candidate) {
    stats.candidates += 1;
  }

  const { baselineBefore, watchBaseline } = readAndUpdateBaseline(candidate);

  for (const result of results) {
    annotateHistoryRow(result, candidate, watchBaseline);

    if (result.isWatchCandidate) {
      if (evaluateAlert(result, candidate, baselineBefore)) {
        stats.alerts += 1;
        result.telegramSent = await sendAlertIfAllowed(candidate, stats);
      }
    }

    appendObservation(root, result);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log("\n---\n");
}

async function runScan() {
  const startedAt = Date.now();
  const stats = {
    watches: 0,
    listingsScraped: 0,
    listingsValid: 0,
    candidates: 0,
    alerts: 0,
    telegramSends: 0,
    duplicatesCollapsed: 0,
  };

  let watches;
  try {
    watches = loadWatches(root);
    stats.watches = watches.length;
  } catch (error) {
    writeLog(`ERROR Scan failed to load products: ${error.message}`);
    throw error;
  }

  writeLog(`Scan started watches=${stats.watches} headless=${headless}`);

  let browser;

  try {
    browser = await chromium.launch({
      headless,
      channel: "chromium",
    });

    const page = await browser.newPage();

    for (const watch of watches) {
      try {
        await processWatch(page, watch, stats);
      } catch (error) {
        console.error(`Error checking ${watch.name}:`, error.message);
        writeLog(`ERROR watch="${watch.name}" ${error.message}`);
      }
    }
  } catch (error) {
    writeLog(`ERROR Scan failed: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    writeLog(
      `Scan ended durationSec=${durationSec} watches=${stats.watches} listingsScraped=${stats.listingsScraped} listingsValid=${stats.listingsValid} duplicatesCollapsed=${stats.duplicatesCollapsed} candidates=${stats.candidates} alerts=${stats.alerts} telegramSends=${stats.telegramSends}`
    );
  }
}

module.exports = { runScan };

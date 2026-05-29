const { checkNeweggSearch } = require("./stores/newegg");
const { validateListingTitle } = require("./validation");
const { enrichNeweggListingIdentity } = require("./identity/newegg-ram");
const {
  dedupeValidListingsByProductKey,
  annotateResultsDedupe,
} = require("./identity/dedupe-by-product-key");
const { getBaseline, updateBaseline } = require("./baselines");
const {
  shouldSendTelegramAlert,
  recordAlertSent,
  resolveAlertStateKey,
} = require("./alert-state");
const { sendTelegramMessage } = require("./telegram");

function pickWatchCandidate(results) {
  let best = null;

  for (const result of results) {
    if (result.price === null) continue;
    if (!best || result.price < best.price) {
      best = result;
    }
  }

  return best;
}

function shouldAlert(result, baseline) {
  const price = result.price;
  const targetPrice = result.targetPrice;

  if (price === null) return false;

  const hitsTarget = targetPrice !== null && price <= targetPrice;

  const isAnomalousDrop =
    baseline &&
    baseline.marketSampleSize >= 10 &&
    price <= baseline.averagePrice * 0.55;

  return hitsTarget || isAnomalousDrop;
}

async function scrapeWatch(page, watch) {
  switch (watch.store) {
    case "newegg":
      return { results: await checkNeweggSearch(page, watch) };

    default:
      return { unknownStore: watch.store, results: [] };
  }
}

function validateListings(results, watch) {
  for (const result of results) {
    const validation = validateListingTitle(result.title, watch.requirements);
    result.validationPassed = validation.validationPassed;
    result.validationReasons = validation.validationReasons;
  }

  return results;
}

function enrichIdentity(results) {
  for (const result of results) {
    enrichNeweggListingIdentity(result);
  }

  return results;
}

function dedupeListings(results) {
  const validResults = results.filter((result) => result.validationPassed);

  const { keptForCandidate, keptSet, duplicatesCollapsed } =
    dedupeValidListingsByProductKey(validResults);
  annotateResultsDedupe(results, keptSet);

  return {
    results,
    validCount: validResults.length,
    keptForCandidate,
    duplicatesCollapsed,
  };
}

function selectCandidate(keptForCandidate) {
  return pickWatchCandidate(keptForCandidate);
}

function readAndUpdateBaseline(candidate) {
  if (!candidate) {
    return { baselineBefore: null, watchBaseline: null };
  }

  const baselineBefore = getBaseline(candidate.store, candidate.watchName);
  const baselineAfter = updateBaseline(candidate);
  const watchBaseline = baselineAfter ?? baselineBefore;

  return { baselineBefore, watchBaseline };
}

function annotateHistoryRow(result, candidate, watchBaseline) {
  const isWatchCandidate =
    candidate !== null && result.url === candidate.url;

  result.isWatchCandidate = isWatchCandidate;
  result.baselineAverage = watchBaseline?.averagePrice ?? null;
  result.marketSampleSize = watchBaseline?.marketSampleSize ?? 0;

  if (!isWatchCandidate) {
    result.alert = false;
    return;
  }

  const alertIdentity = resolveAlertStateKey(candidate);
  result.alertStateKey = alertIdentity.alertStateKey;
  result.alertStateKeySource = alertIdentity.alertStateKeySource;
}

function evaluateAlert(result, candidate, baselineBefore) {
  result.alert = shouldAlert(candidate, baselineBefore);
  return result.alert;
}

async function sendAlertIfAllowed(candidate, stats) {
  const { send, reason } = shouldSendTelegramAlert(candidate);

  if (!send) {
    console.log(
      `Telegram alert suppressed (${reason}) for ${candidate.url}`
    );
    return false;
  }

  stats.telegramSends += 1;
  const alertMessage = `🚨 DEAL SNIPER ALERT 🚨

${candidate.watchName}

Price: $${candidate.price}

${candidate.title}

${candidate.url}`;

  console.log("\n🚨 POSSIBLE DEAL ALERT 🚨");
  console.log(alertMessage);

  await sendTelegramMessage(alertMessage);
  recordAlertSent(candidate);

  return true;
}

module.exports = {
  pickWatchCandidate,
  shouldAlert,
  scrapeWatch,
  validateListings,
  enrichIdentity,
  dedupeListings,
  selectCandidate,
  readAndUpdateBaseline,
  annotateHistoryRow,
  evaluateAlert,
  sendAlertIfAllowed,
};

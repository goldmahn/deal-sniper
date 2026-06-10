const { checkNeweggSearch } = require("./stores/newegg");
const { checkCraigslistSearch } = require("./stores/craigslist");
const { validateListingTitle } = require("./validation");
const { enrichNeweggListingIdentity } = require("./identity/newegg-ram");
const {
  dedupeValidListingsByProductKey,
  annotateResultsDedupe,
} = require("./identity/dedupe-by-product-key");
const { getBaseline, updateBaseline } = require("./baselines");
const { getProductBaseline } = require("./product-baselines");
const { evaluateAnomaly, evaluateManualTarget } = require("./anomaly-engine");
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

async function scrapeWatch(page, watch) {
  switch (watch.store) {
    case "newegg":
      return { results: await checkNeweggSearch(page, watch) };

    case "craigslist":
      return { results: await checkCraigslistSearch(page, watch) };

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

function readWatchBaselineBefore(store, watchName) {
  if (!store || !watchName) {
    return null;
  }

  return getBaseline(store, watchName);
}

function updateWatchBaselineAfter(candidate, marketListings) {
  if (!candidate) {
    return null;
  }

  const source =
    marketListings && marketListings.length ? marketListings : [candidate];
  const prices = source
    .map((listing) => listing.price)
    .filter((price) => price !== null);

  return updateBaseline(
    candidate.store,
    candidate.watchName,
    prices,
    candidate.checkedAt
  );
}

function formatAnomalyAlert(listing, evaluation) {
  const sourceLabel =
    evaluation.baselineSource === "product"
      ? "product"
      : "watch fallback";

  return `🚨 DEAL SNIPER — PRICING ANOMALY (${evaluation.severity.toUpperCase()})

${listing.watchName}

Price: $${listing.price}
Baseline: $${evaluation.baselineAverage} (${sourceLabel}, ${evaluation.baselineSampleSize} samples)
Drop: ${evaluation.dropPercent}% below recent observed baseline

${evaluation.explanation}

${listing.title}

${listing.url}`;
}

function formatManualAlert(listing, evaluation) {
  return `📌 DEAL SNIPER — MANUAL PRICE TARGET

${listing.watchName}

Price: $${listing.price}
Manual target: $${listing.targetPrice}

${evaluation.explanation}

${listing.title}

${listing.url}`;
}

async function sendAlertIfAllowed(listing, message, stats) {
  const { send, reason } = shouldSendTelegramAlert(listing);

  if (!send) {
    console.log(
      `Telegram alert suppressed (${reason}) for ${listing.url}`
    );
    return false;
  }

  stats.telegramSends += 1;
  console.log("\n🚨 DEAL SNIPER ALERT 🚨");
  console.log(message);

  await sendTelegramMessage(message);
  recordAlertSent(listing);

  return true;
}

async function processListingAlerts(listings, watchBaselineBefore, stats) {
  const outcomes = new Map();

  for (const listing of listings) {
    const productBaseline = getProductBaseline(
      listing.store,
      listing.productKey
    );
    const anomaly = evaluateAnomaly({
      listing,
      productBaseline,
      watchBaseline: watchBaselineBefore,
    });

    if (anomaly.shouldAlert) {
      stats.alerts += 1;
      const telegramSent = await sendAlertIfAllowed(
        listing,
        formatAnomalyAlert(listing, anomaly),
        stats
      );
      const alertIdentity = resolveAlertStateKey(listing);

      outcomes.set(listing.url, {
        alert: true,
        alertType: "anomaly",
        alertSeverity: anomaly.severity,
        alertExplanation: anomaly.explanation,
        alertDropPercent: anomaly.dropPercent,
        alertBaselineSource: anomaly.baselineSource,
        alertBaselineAverage: anomaly.baselineAverage,
        alertBaselineSampleSize: anomaly.baselineSampleSize,
        alertStateKey: alertIdentity.alertStateKey,
        alertStateKeySource: alertIdentity.alertStateKeySource,
        telegramSent,
      });
      continue;
    }

    const manual = evaluateManualTarget({ listing });
    if (!manual.shouldAlert) {
      continue;
    }

    stats.alerts += 1;
    const telegramSent = await sendAlertIfAllowed(
      listing,
      formatManualAlert(listing, manual),
      stats
    );
    const alertIdentity = resolveAlertStateKey(listing);

    outcomes.set(listing.url, {
      alert: true,
      alertType: "manual",
      alertSeverity: null,
      alertExplanation: manual.explanation,
      alertDropPercent: null,
      alertBaselineSource: null,
      alertBaselineAverage: null,
      alertBaselineSampleSize: null,
      alertStateKey: alertIdentity.alertStateKey,
      alertStateKeySource: alertIdentity.alertStateKeySource,
      telegramSent,
    });
  }

  return outcomes;
}

function annotateHistoryRow(result, candidate, watchBaseline, alertOutcome) {
  const isWatchCandidate =
    candidate !== null && result.url === candidate.url;

  result.isWatchCandidate = isWatchCandidate;
  result.baselineAverage = watchBaseline?.averagePrice ?? null;
  result.marketSampleSize = watchBaseline?.marketSampleSize ?? 0;

  if (!alertOutcome?.alert) {
    result.alert = false;
    return;
  }

  result.alert = true;
  result.alertType = alertOutcome.alertType;
  result.alertSeverity = alertOutcome.alertSeverity;
  result.alertExplanation = alertOutcome.alertExplanation;
  result.alertDropPercent = alertOutcome.alertDropPercent;
  result.alertBaselineSource = alertOutcome.alertBaselineSource;
  result.alertBaselineAverage = alertOutcome.alertBaselineAverage;
  result.alertBaselineSampleSize = alertOutcome.alertBaselineSampleSize;
  result.alertStateKey = alertOutcome.alertStateKey;
  result.alertStateKeySource = alertOutcome.alertStateKeySource;
  result.telegramSent = alertOutcome.telegramSent;
}

module.exports = {
  pickWatchCandidate,
  scrapeWatch,
  validateListings,
  enrichIdentity,
  dedupeListings,
  selectCandidate,
  readWatchBaselineBefore,
  updateWatchBaselineAfter,
  processListingAlerts,
  annotateHistoryRow,
  formatAnomalyAlert,
  formatManualAlert,
  sendAlertIfAllowed,
};

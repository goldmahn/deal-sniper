const MIN_PRODUCT_SAMPLES = Number(process.env.ANOMALY_MIN_PRODUCT_SAMPLES) || 10;
const MIN_WATCH_SAMPLES = Number(process.env.ANOMALY_MIN_WATCH_SAMPLES) || 10;

const SEVERE_RATIO = Number(process.env.ANOMALY_SEVERE_RATIO) || 0.3;
const CRITICAL_RATIO = Number(process.env.ANOMALY_CRITICAL_RATIO) || 0.15;
const ABSURD_RATIO = Number(process.env.ANOMALY_ABSURD_RATIO) || 0.1;

const NO_ALERT = {
  shouldAlert: false,
  severity: null,
  baselineSource: null,
  baselineAverage: null,
  baselineSampleSize: 0,
  dropPercent: null,
  explanation: null,
};

function isValidPrice(price) {
  return typeof price === "number" && Number.isFinite(price);
}

function passesAnomalyGates(listing) {
  return (
    isValidPrice(listing.price) &&
    listing.validationPassed === true &&
    listing.identityConfidence === "high" &&
    Boolean(listing.productKey)
  );
}

function classifySeverity(price, baselineAverage, allowedSeverities) {
  const ratio = price / baselineAverage;

  if (allowedSeverities.includes("absurd") && ratio <= ABSURD_RATIO) {
    return "absurd";
  }
  if (allowedSeverities.includes("critical") && ratio <= CRITICAL_RATIO) {
    return "critical";
  }
  if (allowedSeverities.includes("severe") && ratio <= SEVERE_RATIO) {
    return "severe";
  }

  return null;
}

function buildExplanation(severity, dropPercent, baselineSource) {
  const scope =
    baselineSource === "product"
      ? "this product"
      : "this watch/category fallback baseline";

  return `Current price is ${dropPercent}% below recent observed baseline for ${scope} (${severity} pricing anomaly).`;
}

function evaluateAgainstBaseline(
  listing,
  baseline,
  baselineSource,
  allowedSeverities,
  minSamples
) {
  if (
    !baseline ||
    typeof baseline.averagePrice !== "number" ||
    !Number.isFinite(baseline.averagePrice) ||
    baseline.averagePrice <= 0 ||
    baseline.marketSampleSize < minSamples
  ) {
    return NO_ALERT;
  }

  const severity = classifySeverity(
    listing.price,
    baseline.averagePrice,
    allowedSeverities
  );

  if (!severity) {
    return NO_ALERT;
  }

  const dropPercent = Number(
    ((1 - listing.price / baseline.averagePrice) * 100).toFixed(1)
  );

  return {
    shouldAlert: true,
    severity,
    baselineSource,
    baselineAverage: baseline.averagePrice,
    baselineSampleSize: baseline.marketSampleSize,
    dropPercent,
    explanation: buildExplanation(severity, dropPercent, baselineSource),
  };
}

function evaluateAnomaly({ listing, productBaseline, watchBaseline }) {
  if (!passesAnomalyGates(listing)) {
    return NO_ALERT;
  }

  if (
    productBaseline &&
    productBaseline.marketSampleSize >= MIN_PRODUCT_SAMPLES
  ) {
    return evaluateAgainstBaseline(
      listing,
      productBaseline,
      "product",
      ["severe", "critical", "absurd"],
      MIN_PRODUCT_SAMPLES
    );
  }

  return evaluateAgainstBaseline(
    listing,
    watchBaseline,
    "watch",
    ["absurd"],
    MIN_WATCH_SAMPLES
  );
}

function evaluateManualTarget({ listing }) {
  if (!listing.validationPassed || !isValidPrice(listing.price)) {
    return { shouldAlert: false, explanation: null };
  }

  const targetPrice = listing.targetPrice;
  if (targetPrice == null || listing.price > targetPrice) {
    return { shouldAlert: false, explanation: null };
  }

  return {
    shouldAlert: true,
    explanation: `Price $${listing.price} is at or below manual target $${targetPrice}.`,
  };
}

module.exports = {
  evaluateAnomaly,
  evaluateManualTarget,
  MIN_PRODUCT_SAMPLES,
  MIN_WATCH_SAMPLES,
  SEVERE_RATIO,
  CRITICAL_RATIO,
  ABSURD_RATIO,
};

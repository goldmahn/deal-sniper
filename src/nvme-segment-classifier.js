const SEGMENTS = [
  "Enterprise / Workstation NVMe",
  "Gaming / Enthusiast NVMe",
  "Consumer NVMe",
  "Unknown",
];

const ENTERPRISE_PATTERNS = [
  /\bu\.?2\b/i,
  /\bu\.?3\b/i,
  /\be1\.?s\b/i,
  /\be3\.?s\b/i,
  /\b(datacenter|data\s*center|enterprise|workstation)\b/i,
  /\bserver\b/i,
  /\bmicron\s+(7450|7500|6550|7400|5300|5400)\b/i,
  /\bsolidigm\s+(d7|d5-p|d5-p5530|d7-p5520|d7-ps1010)\b/i,
  /\bsamsung\s+pm\d/i,
  /\bintel\s+(d5|d7|dc)\b/i,
  /\bpm9a3\b/i,
  /\bpm1733\b/i,
  /\bhhhl\b/i,
  /\badd-?in\s+card\b/i,
];

const GAMING_PATTERNS = [
  /\bwd_?black\b/i,
  /\bsn850x?\b/i,
  /\bsn8100\b/i,
  /\bsn770\b/i,
  /\bsamsung\s+(990\s*pro|980\s*pro|9100\s*pro)\b/i,
  /\b9100\s*pro\b/i,
  /\bfirecuda\b/i,
  /\bcrucial\s+t(500|700|705)\b/i,
  /\bt-?force\b/i,
  /\bsabrent\s+rocket\b/i,
  /\bcorsair\s+mp(600|700)\b/i,
  /\bkingston\s+(fury|renegade)\b/i,
  /\bxpg\s+(s70|sx)\b/i,
  /\blegend\s+970\b/i,
  /\bmsi\s+spatium\b/i,
  /\boptimus\s+gx\s+pro\b/i,
  /\bsandisk\s+optimus\s+gx\s+pro\b/i,
  /\bpcie\s*gen\s*5\b/i,
  /\bpcie\s*5\.0\b/i,
  /\bgaming\s+ssd\b/i,
];

const CONSUMER_PATTERNS = [
  /\bwd\s+blue\b/i,
  /\bsn5000\b/i,
  /\bsn5100\b/i,
  /\bsn580\b/i,
  /\bcrucial\s+p3\b/i,
  /\bcrucial\s+p310\b/i,
  /\bkingston\s+nv[23]\b/i,
  /\bteam\s+group\s+mp(33|44)\b/i,
  /\bsilicon\s+power\b/i,
  /\bud(90|85|a60)\b/i,
  /\bklevv\b/i,
  /\bkingspec\b/i,
  /\bteam\s+group\s+g50\b/i,
];

function matchesAny(title, patterns) {
  return patterns.some((pattern) => pattern.test(title));
}

function classifyNvmeSegment(title) {
  const normalized = title ?? "";

  if (matchesAny(normalized, ENTERPRISE_PATTERNS)) {
    return {
      segment: "Enterprise / Workstation NVMe",
      reason: "enterprise/workstation keyword",
    };
  }

  if (matchesAny(normalized, GAMING_PATTERNS)) {
    return {
      segment: "Gaming / Enthusiast NVMe",
      reason: "gaming/enthusiast keyword",
    };
  }

  if (matchesAny(normalized, CONSUMER_PATTERNS)) {
    return {
      segment: "Consumer NVMe",
      reason: "consumer/value keyword",
    };
  }

  return { segment: "Unknown", reason: "no segment keyword matched" };
}

const {
  validateStorageCapacity,
} = require("./storage-capacity");

function assessExpectedCapacity(title, expectedTb = 4) {
  const validation = validateStorageCapacity(title, expectedTb);

  if (validation.validationPassed) {
    return {
      status: "matches_expected",
      summary: `title matches ${expectedTb}TB storage class`,
      primaryBucket: validation.primaryBucket,
    };
  }

  const reasons = validation.validationReasons.join("; ");
  const status = reasons.includes("conflicting capacity")
    ? "wrong_capacity"
    : "missing_capacity";

  return {
    status,
    summary: reasons,
    primaryBucket: validation.primaryBucket,
  };
}

function summarizeSegmentPrices(listings) {
  const prices = listings
    .map((listing) => listing.price)
    .filter((price) => price != null && Number.isFinite(price));

  if (prices.length === 0) {
    return { count: 0, min: null, max: null, average: null };
  }

  const total = prices.reduce((sum, price) => sum + price, 0);

  return {
    count: prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: total / prices.length,
  };
}

function buildRecommendation(segmentSummaries, lowestInvestigation) {
  const consumer = segmentSummaries["Consumer NVMe"] ?? { count: 0 };
  const gaming = segmentSummaries["Gaming / Enthusiast NVMe"] ?? { count: 0 };
  const enterprise =
    segmentSummaries["Enterprise / Workstation NVMe"] ?? { count: 0 };

  const hasCapacityPollution =
    lowestInvestigation?.capacityAssessment?.status === "wrong_capacity";

  if (hasCapacityPollution) {
    return {
      choice: "validation_first",
      text:
        "Fix capacity validation before splitting categories. The baseline low is driven by a non-4TB listing that polluted search results; segmentation alone will not fix the spread.",
    };
  }

  if (enterprise.count >= 2 && consumer.count >= 2) {
    const enterpriseAvg = segmentSummaries["Enterprise / Workstation NVMe"]?.average;
    const consumerAvg = segmentSummaries["Consumer NVMe"]?.average;
    if (
      enterpriseAvg != null &&
      consumerAvg != null &&
      enterpriseAvg - consumerAvg >= 400
    ) {
      return {
        choice: "B",
        text:
          "Split into Consumer NVMe SSDs and Enterprise / Workstation SSDs. Enterprise and consumer clusters show materially different price levels with little overlap.",
      };
    }
  }

  if (
    consumer.count >= 2 &&
    gaming.count >= 2 &&
    enterprise.count === 0
  ) {
    const consumerAvg = segmentSummaries["Consumer NVMe"]?.average;
    const gamingAvg = segmentSummaries["Gaming / Enthusiast NVMe"]?.average;
    if (
      consumerAvg != null &&
      gamingAvg != null &&
      gamingAvg - consumerAvg >= 200
    ) {
      return {
        choice: "C",
        text:
          "Split into Consumer, Enthusiast, and (later) Enterprise watches. Current listings form distinct consumer (~$450–$520) and enthusiast (~$650–$1,330) bands with no enterprise SKUs in the latest batch.",
      };
    }
  }

  return {
    choice: "A",
    text:
      "Keep one unified 4TB NVMe category for now. After excluding mis-capacity listings, the remaining spread may still be wide but represents a single prosumer market band rather than separate enterprise inventory.",
  };
}

module.exports = {
  SEGMENTS,
  classifyNvmeSegment,
  assessExpectedCapacity,
  summarizeSegmentPrices,
  buildRecommendation,
};

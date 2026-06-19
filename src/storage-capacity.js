const CAPACITY_BUCKETS = [
  "512GB",
  "1TB",
  "2TB",
  "4TB",
  "8TB",
  "Unknown",
];

const CAPACITY_TOKEN_PATTERN = /\b(\d+)\s*(TB|GB)\b/gi;

function getAcceptedCapacities(targetTB) {
  return {
    tb: [targetTB],
    gb: [targetTB * 1000, targetTB * 1024],
  };
}

function parseStorageCapacities(title) {
  const normalized = title ?? "";
  const tokens = [];

  for (const match of normalized.matchAll(CAPACITY_TOKEN_PATTERN)) {
    tokens.push({
      value: Number(match[1]),
      unit: match[2].toUpperCase(),
      raw: match[0],
    });
  }

  return tokens;
}

function isAcceptedCapacityToken(token, targetTB) {
  const accepted = getAcceptedCapacities(targetTB);

  if (token.unit === "TB") {
    return token.value === targetTB;
  }

  return accepted.gb.includes(token.value);
}

function validateStorageCapacity(title, targetTB) {
  const tokens = parseStorageCapacities(title);
  const reasons = [];

  if (tokens.length === 0) {
    return {
      validationPassed: false,
      validationReasons: [`missing storage capacity: ${targetTB}TB class`],
      detectedCapacities: [],
      primaryBucket: "Unknown",
    };
  }

  let hasAccepted = false;
  const detectedCapacities = [];

  for (const token of tokens) {
    detectedCapacities.push(token.raw);

    if (isAcceptedCapacityToken(token, targetTB)) {
      hasAccepted = true;
      continue;
    }

    reasons.push(`conflicting capacity: ${token.raw}`);
  }

  if (!hasAccepted) {
    reasons.unshift(`missing storage capacity: ${targetTB}TB class`);
  }

  const conflictingReasons = reasons.filter((reason) =>
    reason.startsWith("conflicting capacity:")
  );

  return {
    validationPassed: hasAccepted && conflictingReasons.length === 0,
    validationReasons: reasons,
    detectedCapacities,
    primaryBucket: classifyCapacityBucket(title),
  };
}

function classifyCapacityBucket(title) {
  const tokens = parseStorageCapacities(title);
  if (tokens.length === 0) {
    return "Unknown";
  }

  const primary = tokens[0];

  if (primary.unit === "TB") {
    if (primary.value === 1) return "1TB";
    if (primary.value === 2) return "2TB";
    if (primary.value === 4) return "4TB";
    if (primary.value === 8) return "8TB";
    return "Unknown";
  }

  if (primary.value === 512) return "512GB";
  if (primary.value === 1000 || primary.value === 1024) return "1TB";
  if (primary.value === 2000 || primary.value === 2048) return "2TB";
  if (primary.value === 4000 || primary.value === 4096) return "4TB";
  if (primary.value === 8000 || primary.value === 8192) return "8TB";

  return "Unknown";
}

function summarizeCapacityBuckets(listings) {
  const summary = Object.fromEntries(
    CAPACITY_BUCKETS.map((bucket) => [bucket, 0])
  );

  for (const listing of listings) {
    const bucket = listing.capacityBucket ?? classifyCapacityBucket(listing.title);
    if (summary[bucket] == null) {
      summary.Unknown += 1;
    } else {
      summary[bucket] += 1;
    }
  }

  return summary;
}

function recommendBaselineCleanup({
  baseline,
  validListingCount,
  pollutedListingCount,
  pollutedPrices = [],
}) {
  if (!baseline) {
    return {
      choice: "A",
      text: "No watch baseline file entry exists yet; future scans can build a clean baseline once validation is hardened.",
    };
  }

  const window = baseline.window ?? [];
  const pollutedPriceSet = new Set(pollutedPrices);
  const repeatedLow =
    window.length > 0
      ? window.filter((price) => price === baseline.lowestSeen).length /
        window.length
      : 0;
  const windowContainsPolluted = window.some((price) =>
    pollutedPriceSet.has(price)
  );
  const pollutionShare =
    validListingCount > 0 ? pollutedListingCount / validListingCount : 0;
  const lowestIsPolluted = pollutedPriceSet.has(baseline.lowestSeen);

  if (
    lowestIsPolluted ||
    windowContainsPolluted ||
    repeatedLow >= 0.1 ||
    pollutionShare >= 0.15
  ) {
    return {
      choice: "B",
      text:
        "Reset/rebuild the 4TB watch baseline. Historical contamination is material: the stored low price comes from a wrong-capacity SKU and the rolling window still contains repeated polluted observations. Self-correction would take many scans and leave lowestSeen polluted.",
      metrics: {
        lowestSeen: baseline.lowestSeen,
        repeatedLowShare: repeatedLow,
        historicalPollutionShare: pollutionShare,
        windowSize: window.length,
        windowContainsPolluted,
      },
    };
  }

  return {
    choice: "A",
    text:
      "Leave the baseline alone and let it self-correct. Pollution appears limited and should age out of the rolling window after validation stops accepting wrong-capacity listings.",
    metrics: {
      lowestSeen: baseline.lowestSeen,
      repeatedLowShare: repeatedLow,
      historicalPollutionShare: pollutionShare,
      windowSize: window.length,
      windowContainsPolluted,
    },
  };
}

module.exports = {
  CAPACITY_BUCKETS,
  CAPACITY_TOKEN_PATTERN,
  getAcceptedCapacities,
  parseStorageCapacities,
  isAcceptedCapacityToken,
  validateStorageCapacity,
  classifyCapacityBucket,
  summarizeCapacityBuckets,
  recommendBaselineCleanup,
};

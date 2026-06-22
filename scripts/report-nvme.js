const fs = require("fs");
const path = require("path");

const { yearMonth, priceHistoryPath } = require("../src/monthly-paths");
const { loadWatches } = require("../src/repositories/watches-repository");
const { validateListingTitle } = require("../src/validation");
const {
  classifyCapacityBucket,
  summarizeCapacityBuckets,
  recommendBaselineCleanup,
  CAPACITY_BUCKETS,
  validateStorageCapacity,
} = require("../src/storage-capacity");
const {
  SEGMENTS,
  classifyNvmeSegment,
  assessExpectedCapacity,
  summarizeSegmentPrices,
  buildRecommendation,
} = require("../src/nvme-segment-classifier");

const WATCH_NAME = "4TB NVMe SSD Newegg Category";
const EXPECTED_CAPACITY_TB = 4;

function loadWatchRequirements(root) {
  const watch = loadWatches(root).find((entry) => entry.name === WATCH_NAME);

  if (!watch?.requirements) {
    throw new Error(`Watch requirements not found for "${WATCH_NAME}"`);
  }

  return watch.requirements;
}

const INVESTIGATION_TARGETS = [
  {
    label: "512GB KingSpec ONEBOOM X400",
    productKey: "newegg:item:0D9-010Y-00004",
  },
  {
    label: "1TB SanDisk Optimus GX 7100M",
    match: (row) => row.title.includes("1TB") && row.title.includes("7100M"),
  },
  {
    label: "2TB SanDisk Optimus GX 7100M",
    match: (row) => row.title.includes("2TB") && row.title.includes("7100M"),
  },
  {
    label: "2TB SanDisk Optimus GX PRO 8100",
    match: (row) => row.title.includes("2TB") && row.title.includes("8100"),
  },
];

function formatMoney(value) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `$${value.toFixed(2)}`;
}

function loadAllWatchRows(root) {
  const historyPath = priceHistoryPath(root, yearMonth());

  if (!fs.existsSync(historyPath)) {
    throw new Error(`Price history not found: ${historyPath}`);
  }

  return fs
    .readFileSync(historyPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.watchName === WATCH_NAME);
}

function loadWatchRows(root) {
  return loadAllWatchRows(root).filter((row) => row.validationPassed === true);
}

function latestScanTimestamp(rows) {
  return rows.reduce(
    (latest, row) => (row.checkedAt > latest ? row.checkedAt : latest),
    ""
  );
}

function dedupeByProductKey(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = row.productKey || row.url;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    if (row.dedupeRole === "kept" && existing.dedupeRole !== "kept") {
      byKey.set(key, row);
      continue;
    }

    if (row.checkedAt > existing.checkedAt) {
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort((left, right) => left.price - right.price);
}

function loadWatchBaseline(root) {
  const baselinesPath = path.join(root, "data", "baselines.json");

  if (!fs.existsSync(baselinesPath)) {
    return null;
  }

  const baselines = JSON.parse(fs.readFileSync(baselinesPath, "utf8"));
  return baselines[`newegg:${WATCH_NAME}`] ?? null;
}

function classifyListing(row, watchRequirements) {
  const classification = classifyNvmeSegment(row.title);
  const capacityAssessment = assessExpectedCapacity(
    row.title,
    EXPECTED_CAPACITY_TB
  );
  const currentValidation = validateListingTitle(row.title, watchRequirements);
  const capacityBucket =
    capacityAssessment.primaryBucket ?? classifyCapacityBucket(row.title);

  return {
    ...row,
    segment: classification.segment,
    segmentReason: classification.reason,
    capacityAssessment,
    capacityBucket,
    currentValidationPassed: currentValidation.validationPassed,
    currentValidationReasons: currentValidation.validationReasons,
  };
}

function investigateHistoricalTargets(allRows, watchRequirements) {
  const latestBatchAt = latestScanTimestamp(allRows);
  const findings = [];

  for (const target of INVESTIGATION_TARGETS) {
    const rows = allRows.filter((row) => {
      if (target.productKey) {
        return row.productKey === target.productKey;
      }
      return target.match(row);
    });

    if (rows.length === 0) {
      findings.push({ label: target.label, found: false });
      continue;
    }

    const latestBatchRow = rows.find((row) => row.checkedAt === latestBatchAt);
    const latest = latestBatchRow ?? rows[rows.length - 1];
    const inLatestBatch = latestBatchRow != null;
    const passCount = rows.filter((row) => row.validationPassed).length;
    const failCount = rows.length - passCount;
    const storageValidation = validateStorageCapacity(latest.title, 4);
    const currentValidation = validateListingTitle(
      latest.title,
      watchRequirements
    );

    findings.push({
      label: target.label,
      found: true,
      inLatestBatch,
      latestBatchAt,
      title: latest.title,
      price: latest.price,
      productKey: latest.productKey,
      url: latest.url,
      historicalPassCount: passCount,
      historicalFailCount: failCount,
      scrapedValidationPassed: latest.validationPassed,
      scrapedValidationReasons: latest.validationReasons ?? [],
      storageValidation,
      currentValidation,
      capacityBucket: classifyCapacityBucket(latest.title),
    });
  }

  return findings;
}

function printInvestigation(findings) {
  console.log("--- Validation investigation (history-backed) ---\n");

  for (const finding of findings) {
    console.log(finding.label);
    if (!finding.found) {
      console.log("  Not found in current month history.");
      console.log("");
      continue;
    }

    console.log(`  Historical rows: ${finding.historicalPassCount} passed, ${finding.historicalFailCount} failed`);
    if (finding.inLatestBatch) {
      console.log(
        `  Latest scan batch (${finding.latestBatchAt}) validationPassed: ${finding.scrapedValidationPassed}`
      );
    } else {
      console.log(
        `  Not in latest scan batch (${finding.latestBatchAt}); last seen validationPassed: ${finding.scrapedValidationPassed}`
      );
    }
    if (finding.scrapedValidationReasons.length > 0) {
      console.log(
        `  Latest scraped reasons: ${finding.scrapedValidationReasons.join("; ")}`
      );
    }
    console.log(`  Capacity bucket: ${finding.capacityBucket}`);
    console.log(
      `  Storage validator now: ${finding.storageValidation.validationPassed ? "PASS" : "FAIL"} (${finding.storageValidation.validationReasons.join("; ")})`
    );
    console.log(
      `  Full watch validation now: ${finding.currentValidation.validationPassed ? "PASS" : "FAIL"} (${finding.currentValidation.validationReasons.join("; ")})`
    );
    console.log(`  Title: ${finding.title}`);
    console.log(`  Price: ${formatMoney(finding.price)}`);
    console.log(`  productKey: ${finding.productKey ?? "(none)"}`);
    console.log(`  URL: ${finding.url}`);

    let cause = "search-result contamination";
    if (
      finding.inLatestBatch &&
      finding.scrapedValidationPassed &&
      !finding.currentValidation.validationPassed
    ) {
      cause = "stale validation module cache in long-running watch process";
    } else if (
      !finding.inLatestBatch &&
      finding.scrapedValidationPassed &&
      !finding.currentValidation.validationPassed
    ) {
      cause =
        "historical scrape before storageCapacityTB enforcement (SKU absent from latest batch)";
    } else if (
      finding.inLatestBatch &&
      !finding.scrapedValidationPassed &&
      !finding.currentValidation.validationPassed
    ) {
      cause = "correctly rejected in latest scan batch";
    }
    console.log(`  Likely cause: ${cause}`);
    console.log("");
  }

  console.log(
    "Summary: polluted listings lack a true 4TB capacity token. Older history rows may show validationPassed=true from before storageCapacityTB enforcement or from a stale watch process that had not reloaded validation.js. Compare latest-batch rows when a SKU is still present."
  );
  console.log("");
}

function printCapacityBreakdown(summary) {
  console.log("--- Capacity breakdown ---\n");
  for (const bucket of CAPACITY_BUCKETS) {
    console.log(`${bucket}: ${summary[bucket] ?? 0}`);
  }
  console.log("");
}

function investigateLowestPrice(listings) {
  const priced = listings.filter((listing) => listing.price != null);
  if (priced.length === 0) {
    return null;
  }

  const lowest = priced.reduce((min, listing) =>
    listing.price < min.price ? listing : min
  );

  let verdict = "legitimate_4tb";
  const capacityStatus = lowest.capacityAssessment.status;

  if (capacityStatus === "wrong_capacity" || capacityStatus === "missing_capacity") {
    verdict = "misclassified_item";
  } else if (!lowest.currentValidationPassed) {
    verdict = "misclassified_item";
  } else if (lowest.price < 250) {
    verdict = "marketplace_anomaly";
  }

  return { listing: lowest, verdict };
}

function verdictLabel(verdict) {
  switch (verdict) {
    case "legitimate_4tb":
      return "Legitimate 4TB NVMe SSD";
    case "misclassified_item":
      return "Misclassified item (wrong capacity or search pollution)";
    case "marketplace_anomaly":
      return "Marketplace anomaly (price unusually low for segment)";
    case "parsing_issue":
      return "Parsing issue";
    default:
      return verdict;
  }
}

function printSegmentSummary(segmentSummaries) {
  for (const segment of SEGMENTS) {
    const stats = segmentSummaries[segment];

    console.log(segment);
    console.log(`  Count: ${stats.count}`);
    console.log(`  Avg: ${formatMoney(stats.average)}`);
    if (stats.count === 0) {
      console.log("  Range: n/a");
    } else {
      console.log(`  Range: ${formatMoney(stats.min)} - ${formatMoney(stats.max)}`);
    }
    console.log("");
  }
}

function printListingTable(listings) {
  for (const segment of SEGMENTS) {
    const segmentListings = listings.filter((listing) => listing.segment === segment);
    if (segmentListings.length === 0) {
      continue;
    }

    console.log(`--- ${segment} ---`);
    for (const listing of segmentListings) {
      console.log(
        `  ${formatMoney(listing.price)} | ${listing.capacityBucket} | ${listing.segmentReason} | ${listing.title}`
      );
      console.log(`    ${listing.productKey ?? "(no productKey)"}`);
      console.log(`    ${listing.url}`);
      if (listing.capacityAssessment.status !== "matches_expected") {
        console.log(`    capacity: ${listing.capacityAssessment.summary}`);
      }
      if (!listing.currentValidationPassed) {
        console.log(
          `    current validation: FAIL (${listing.currentValidationReasons.join("; ")})`
        );
      }
    }
    console.log("");
  }
}

function printRecommendation(recommendation) {
  console.log("--- Segment split recommendation ---");
  if (recommendation.choice === "validation_first") {
    console.log("Priority: tighten validation before category split");
    console.log(recommendation.text);
    console.log("");
    console.log(
      "After validation cleanup, re-run this report. If consumer vs enthusiast bands remain separated by ~$200+, consider option C."
    );
    return;
  }

  console.log(`Option ${recommendation.choice}) ${recommendation.text}`);
}

function printBaselineRecommendation(recommendation) {
  console.log("");
  console.log("--- Baseline cleanup recommendation ---");
  console.log(`Option ${recommendation.choice}) ${recommendation.text}`);
  if (recommendation.metrics) {
    console.log(
      `Metrics: lowestSeen=${formatMoney(recommendation.metrics.lowestSeen)}, repeatedLowShare=${(recommendation.metrics.repeatedLowShare * 100).toFixed(1)}%, historicalPollutionShare=${(recommendation.metrics.historicalPollutionShare * 100).toFixed(1)}%, windowSize=${recommendation.metrics.windowSize}, windowContainsPolluted=${recommendation.metrics.windowContainsPolluted}`
    );
  }
}

function runReport(root = path.join(__dirname, "..")) {
  const watchRequirements = loadWatchRequirements(root);
  const allRows = loadAllWatchRows(root);
  const rows = allRows.filter((row) => row.validationPassed === true);
  if (rows.length === 0) {
    throw new Error(`No valid listings found for watch "${WATCH_NAME}"`);
  }

  const scanBatchAt = latestScanTimestamp(rows);
  const batchRows = rows.filter((row) => row.checkedAt === scanBatchAt);
  const classify = (row) => classifyListing(row, watchRequirements);
  const listings = dedupeByProductKey(batchRows).map(classify);
  const historicalUnique = dedupeByProductKey(rows).map(classify);
  const watchBaseline = loadWatchBaseline(root);
  const investigation = investigateHistoricalTargets(allRows, watchRequirements);

  const segmentSummaries = Object.fromEntries(
    SEGMENTS.map((segment) => [
      segment,
      summarizeSegmentPrices(
        listings.filter((listing) => listing.segment === segment)
      ),
    ])
  );

  const capacityBreakdown = summarizeCapacityBuckets(listings);
  const pollutedHistorical = historicalUnique.filter(
    (listing) => !listing.currentValidationPassed
  );
  const pollutedPrices = pollutedHistorical
    .map((listing) => listing.price)
    .filter((price) => price != null);

  const lowestInvestigation = investigateLowestPrice(listings);
  const segmentRecommendation = buildRecommendation(segmentSummaries, {
    capacityAssessment: lowestInvestigation?.listing?.capacityAssessment,
  });
  const baselineRecommendation = recommendBaselineCleanup({
    baseline: watchBaseline,
    validListingCount: historicalUnique.length,
    pollutedListingCount: pollutedHistorical.length,
    pollutedPrices,
  });

  console.log("=== 4TB NVMe SSD Watch — Segment Report ===\n");
  console.log(`Watch: ${WATCH_NAME}`);
  console.log(`Source: ${path.relative(root, priceHistoryPath(root, yearMonth()))}`);
  console.log(`Latest scan batch: ${scanBatchAt}`);
  console.log(`Unique valid products in latest batch (deduped): ${listings.length}`);
  console.log(`Unique historically valid products (deduped): ${historicalUnique.length}`);
  console.log("");

  printInvestigation(investigation);

  if (watchBaseline) {
    console.log("--- Watch baseline (reference) ---");
    console.log(`Average: ${formatMoney(watchBaseline.averagePrice)}`);
    console.log(`Low: ${formatMoney(watchBaseline.lowestSeen)}`);
    console.log(`High: ${formatMoney(watchBaseline.highestSeen)}`);
    console.log(`Samples: ${watchBaseline.marketSampleSize}`);
    console.log(`Updated: ${watchBaseline.updatedAt}`);
    console.log("");
  }

  printCapacityBreakdown(capacityBreakdown);

  console.log("--- Pricing by segment ---\n");
  printSegmentSummary(segmentSummaries);
  printListingTable(listings);

  if (lowestInvestigation) {
    const { listing, verdict } = lowestInvestigation;
    console.log("--- Lowest price investigation ---");
    console.log(`Lowest observed: ${formatMoney(listing.price)}`);
    console.log(`Title: ${listing.title}`);
    console.log(`Price: ${formatMoney(listing.price)}`);
    console.log(`productKey: ${listing.productKey ?? "(none)"}`);
    console.log(`URL: ${listing.url}`);
    console.log(`Capacity bucket: ${listing.capacityBucket}`);
    console.log(`Capacity check: ${listing.capacityAssessment.summary}`);
    console.log(`Verdict: ${verdictLabel(verdict)}`);
    console.log("");
  }

  const capacityPollution = listings.filter(
    (listing) => listing.capacityAssessment.status === "wrong_capacity"
  );
  if (capacityPollution.length > 0) {
    console.log("--- Capacity anomalies in latest batch ---");
    for (const listing of capacityPollution) {
      console.log(
        `  ${formatMoney(listing.price)} | ${listing.capacityBucket} | ${listing.capacityAssessment.summary}`
      );
      console.log(`    ${listing.title}`);
    }
    console.log("");
  }

  printRecommendation(segmentRecommendation);
  printBaselineRecommendation(baselineRecommendation);

  return {
    scanBatchAt,
    listings,
    segmentSummaries,
    capacityBreakdown,
    lowestInvestigation,
    segmentRecommendation,
    baselineRecommendation,
    investigation,
  };
}

if (require.main === module) {
  try {
    runReport();
  } catch (error) {
    console.error("Report failed:", error.message);
    process.exit(1);
  }
}

module.exports = { runReport, WATCH_NAME };

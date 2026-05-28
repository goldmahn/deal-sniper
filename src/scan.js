require("dotenv").config();

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const headless = process.env.HEADLESS !== "false";

const { updateBaseline, getBaseline } = require("./baselines");
const { shouldSendTelegramAlert, recordAlertSent } = require("./alert-state");
const { sendTelegramMessage } = require("./telegram");
const { checkNeweggSearch } = require("./stores/newegg");
const { validateListingTitle } = require("./validation");
const { writeLog } = require("./logger");
const { priceHistoryPath } = require("./monthly-paths");

const root = path.join(__dirname, "..");
const productsPath = path.join(root, "data", "products.json");

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

async function runScan() {
  const startedAt = Date.now();
  const stats = {
    watches: 0,
    listingsScraped: 0,
    listingsValid: 0,
    candidates: 0,
    alerts: 0,
    telegramSends: 0,
  };

  let products;
  try {
    products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
    stats.watches = products.length;
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

    for (const product of products) {
      try {
        let results = [];

        switch (product.store) {
          case "newegg":
            results = await checkNeweggSearch(page, product);
            break;

          default:
            console.error(`Unknown store: ${product.store}`);
            writeLog(`ERROR Unknown store for watch="${product.name}": ${product.store}`);
            continue;
        }

        stats.listingsScraped += results.length;

        for (const result of results) {
          const validation = validateListingTitle(
            result.title,
            product.requirements
          );
          result.validationPassed = validation.validationPassed;
          result.validationReasons = validation.validationReasons;
        }

        const validResults = results.filter(
          (result) => result.validationPassed
        );
        stats.listingsValid += validResults.length;

        const candidate = pickWatchCandidate(validResults);
        if (candidate) {
          stats.candidates += 1;
        }
        const baselineBefore = candidate
          ? getBaseline(candidate.store, candidate.watchName)
          : null;
        const baselineAfter = candidate ? updateBaseline(candidate) : null;
        const watchBaseline = baselineAfter ?? baselineBefore;

        for (const result of results) {
          const isWatchCandidate =
            candidate !== null && result.url === candidate.url;

          result.isWatchCandidate = isWatchCandidate;
          result.baselineAverage = watchBaseline?.averagePrice ?? null;
          result.marketSampleSize = watchBaseline?.marketSampleSize ?? 0;

          if (isWatchCandidate) {
            result.alert = shouldAlert(candidate, baselineBefore);

            if (result.alert) {
              stats.alerts += 1;
              const { send, reason } = shouldSendTelegramAlert(candidate);
              result.telegramSent = send;

              if (send) {
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
              } else {
                console.log(
                  `Telegram alert suppressed (${reason}) for ${candidate.url}`
                );
              }
            }
          } else {
            result.alert = false;
          }

          fs.appendFileSync(
            priceHistoryPath(root),
            JSON.stringify(result) + "\n"
          );

          console.log(JSON.stringify(result, null, 2));
        }

        console.log("\n---\n");
      } catch (error) {
        console.error(`Error checking ${product.name}:`, error.message);
        writeLog(`ERROR watch="${product.name}" ${error.message}`);
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
      `Scan ended durationSec=${durationSec} watches=${stats.watches} listingsScraped=${stats.listingsScraped} listingsValid=${stats.listingsValid} candidates=${stats.candidates} alerts=${stats.alerts} telegramSends=${stats.telegramSends}`
    );
  }
}

module.exports = { runScan };

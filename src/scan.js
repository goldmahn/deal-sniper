const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const { updateBaseline, getBaseline } = require("./baselines");
const { shouldSendTelegramAlert, recordAlertSent } = require("./alert-state");
const { sendTelegramMessage } = require("./telegram");
const { checkNeweggSearch } = require("./stores/newegg");
const { validateListingTitle } = require("./validation");

const productsPath = path.join(__dirname, "..", "data", "products.json");
const historyPath = path.join(__dirname, "..", "data", "price-history.jsonl");

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
  const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));

  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
  });

  const page = await browser.newPage();

  try {
    for (const product of products) {
      try {
        let results = [];

        switch (product.store) {
          case "newegg":
            results = await checkNeweggSearch(page, product);
            break;

          default:
            console.error(`Unknown store: ${product.store}`);
            continue;
        }

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
        const candidate = pickWatchCandidate(validResults);
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
              const { send, reason } = shouldSendTelegramAlert(candidate);
              result.telegramSent = send;

              if (send) {
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

          fs.appendFileSync(historyPath, JSON.stringify(result) + "\n");

          console.log(JSON.stringify(result, null, 2));
        }

        console.log("\n---\n");
      } catch (error) {
        console.error(`Error checking ${product.name}:`, error.message);
      }
    }
  } finally {
    await browser.close();
  }
}

module.exports = { runScan };

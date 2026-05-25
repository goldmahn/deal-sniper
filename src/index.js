const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const { updateBaseline } = require("./baselines");
const { sendTelegramMessage } = require("./telegram");
const { checkNeweggSearch } = require("./stores/newegg");

const productsPath = path.join(__dirname, "..", "data", "products.json");
const historyPath = path.join(__dirname, "..", "data", "price-history.jsonl");

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

(async () => {
  const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));

  const browser = await chromium.launch({
    headless: false,
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
          continue;
      }

      for (const result of results) {
      const baseline = updateBaseline(result);
result.baselineAverage = baseline?.averagePrice ?? null;
result.marketSampleSize = baseline?.marketSampleSize ?? 0;
result.alert = shouldAlert(result, baseline);

        fs.appendFileSync(historyPath, JSON.stringify(result) + "\n");

        console.log(JSON.stringify(result, null, 2));

        if (result.alert) {
          const alertMessage = `🚨 DEAL SNIPER ALERT 🚨

${result.watchName}

Price: $${result.price}

${result.title}

${result.url}`;

          console.log("\n🚨 POSSIBLE DEAL ALERT 🚨");
          console.log(alertMessage);

          await sendTelegramMessage(alertMessage);
        }
      }

      console.log("\n---\n");
    } catch (error) {
      console.error(`Error checking ${product.name}:`, error.message);
    }
  }

  await browser.close();
})();

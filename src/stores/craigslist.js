const { parsePrice } = require("../price");
const { writeLog } = require("../logger");

// Craigslist has churned through several search-results layouts. Target the
// JS gallery, the static (no-JS) list, and the legacy rows so a markup change
// on one does not zero out the scrape.
const RESULT_SELECTOR =
  "li.cl-search-result, li.cl-static-search-result, li.result-row";

// Pure: turn raw scraped rows into observation rows.
function mapCraigslistItems(
  rawItems,
  product,
  now = () => new Date().toISOString()
) {
  return rawItems
    .filter((item) => item.title && item.url)
    .map((item) => ({
      checkedAt: now(),
      watchName: product.name,
      store: "craigslist",
      title: item.title,
      url: item.url,
      price: parsePrice(item.priceText),
      targetPrice: product.targetPrice ?? null,
      shippingText: "",
      locationText: item.locationText ?? "",
    }));
}

async function checkCraigslistSearch(page, product) {
  await page.goto(product.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  try {
    await page.waitForSelector(RESULT_SELECTOR, { timeout: 15000 });
  } catch {
    // Reported below rather than failing silently.
  }

  const count = await page.locator(RESULT_SELECTOR).count();

  if (count === 0) {
    writeLog(
      `WARN craigslist scrape found 0 results watch="${product.name}" likely=selector_change_or_no_results url=${product.url}`
    );
  }

  const rawItems = await page.locator(RESULT_SELECTOR).evaluateAll((cards) =>
    cards.slice(0, 20).map((card) => {
      const link =
        card.querySelector(
          "a.cl-app-anchor, a.posting-title, a.result-title, a.titlestring"
        ) || card.querySelector("a[href]");

      const titleEl =
        card.querySelector(
          ".label, .title, .result-title, .titlestring, .posting-title .label"
        ) || link;

      const priceEl = card.querySelector(".priceinfo, .price, .result-price");
      const locationEl = card.querySelector(
        ".location, .meta, .result-hood, .supertitle"
      );

      return {
        title: titleEl?.innerText?.trim() || link?.innerText?.trim() || null,
        url: link?.href ?? null,
        priceText: priceEl?.innerText?.trim() ?? "",
        locationText: locationEl?.innerText?.trim() ?? "",
      };
    })
  );

  return mapCraigslistItems(rawItems, product);
}

module.exports = { checkCraigslistSearch, mapCraigslistItems };

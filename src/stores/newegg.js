const { combinePrice } = require("../price");
const { writeLog } = require("../logger");

// Pure: turn raw card data scraped from the page into observation rows.
function mapNeweggItems(rawItems, product, now = () => new Date().toISOString()) {
  return rawItems
    .filter(
      (item) => item.title && item.url && (item.priceWhole || item.priceFraction)
    )
    .map((item) => ({
      checkedAt: now(),
      watchName: product.name,
      store: "newegg",
      title: item.title,
      url: item.url,
      price: combinePrice(item.priceWhole, item.priceFraction),
      targetPrice: product.targetPrice ?? null,
      shippingText: item.shippingText ?? "",
    }));
}

async function looksBlocked(page) {
  try {
    const title = (await page.title()).toLowerCase();
    return /captcha|robot|are you a human|access denied|blocked|unusual traffic/.test(
      title
    );
  } catch {
    return false;
  }
}

async function checkNeweggSearch(page, product) {
  await page.goto(product.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  try {
    await page.waitForSelector(".item-cell", { timeout: 15000 });
  } catch {
    // No cards appeared — could be no results, a markup change, or a block.
    // Reported below so it is not silently indistinguishable from "no deals".
  }

  const cellCount = await page.locator(".item-cell").count();

  if (cellCount === 0) {
    const reason = (await looksBlocked(page))
      ? "bot_block_or_captcha"
      : "selector_change_or_no_results";
    writeLog(
      `WARN newegg scrape found 0 .item-cell watch="${product.name}" likely=${reason} url=${product.url}`
    );
  }

  const rawItems = await page.locator(".item-cell").evaluateAll((cards) =>
    cards.slice(0, 10).map((card) => {
      const titleEl = card.querySelector(".item-title");
      return {
        title: titleEl?.innerText?.trim() ?? null,
        url: titleEl?.href ?? null,
        priceWhole: card.querySelector(".price-current strong")?.innerText ?? "",
        priceFraction: card.querySelector(".price-current sup")?.innerText ?? "",
        shippingText: card.querySelector(".price-ship")?.innerText?.trim() ?? "",
      };
    })
  );

  return mapNeweggItems(rawItems, product);
}

module.exports = { checkNeweggSearch, mapNeweggItems };

function extractPrice(text) {
  const match = text.match(/\$?[\d,]+(?:\.\d{2})?/);
  return match ? Number(match[0].replace(/[$,]/g, "")) : null;
}

async function checkNeweggSearch(page, product) {
  await page.goto(product.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const items = await page.locator(".item-cell").evaluateAll((cards) =>
    cards.slice(0, 10).map((card) => {
      const title = card.querySelector(".item-title")?.innerText?.trim() ?? null;
      const url = card.querySelector(".item-title")?.href ?? null;

      const priceWhole =
        card.querySelector(".price-current strong")?.innerText ?? "";
      const priceFraction =
        card.querySelector(".price-current sup")?.innerText ?? "";

      const priceText = `${priceWhole}${priceFraction}`;
      const shippingText =
        card.querySelector(".price-ship")?.innerText?.trim() ?? "";

      return { title, url, priceText, shippingText };
    })
  );

  return items
    .filter((item) => item.title && item.url && item.priceText)
    .map((item) => ({
      checkedAt: new Date().toISOString(),
      watchName: product.name,
      store: "newegg",
      title: item.title,
      url: item.url,
      price: extractPrice(item.priceText),
      targetPrice: product.targetPrice ?? null,
      shippingText: item.shippingText,
    }));
}

module.exports = { checkNeweggSearch };

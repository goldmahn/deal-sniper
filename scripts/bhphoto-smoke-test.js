require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const CATEGORY_URL =
  "https://www.bhphotovideo.com/c/buy/Computer-Memory/ci/13341";

const SKU_REG_PATH = /\/c\/product\/(\d+-REG)\//i;

const headed = process.argv.includes("--headed");
const headless = headed ? false : process.env.HEADLESS !== "false";
const profileDir = path.join(__dirname, "..", ".playwright", "bhphoto-profile");

const CHALLENGE_PATTERN =
  /just a moment|performing security verification|cloudflare|turnstile|verify you are human|access denied|unusual traffic|ray id:/i;

function extractProductsFromDom() {
  const skuPattern = /\/c\/product\/(\d+-REG)\//i;
  const seen = new Set();
  const products = [];

  for (const anchor of document.querySelectorAll('a[href*="/c/product/"]')) {
    const href = anchor.href.split("?")[0];
    const match = href.match(skuPattern);
    if (!match) continue;

    const sku = match[1];
    if (seen.has(sku)) continue;

    const title = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title || title.length < 10) continue;
    if (/quick view|compare|wish list|add to cart|write a review/i.test(title)) {
      continue;
    }

    let price = null;
    const container =
      anchor.closest("article, li, [data-selenium], .product, .item") ??
      anchor.parentElement?.parentElement;

    if (container) {
      const priceMatch = (container.innerText || "").match(
        /\$\s*([\d,]+(?:\.\d{2})?)/
      );
      if (priceMatch) {
        price = Number(priceMatch[1].replace(/,/g, ""));
      }
    }

    seen.add(sku);
    products.push({
      sku,
      title,
      url: href,
      price,
      urlMatchesSkuReg: skuPattern.test(href),
    });
  }

  return products;
}

function parseProductsFromHtml(html) {
  const products = [];
  const seen = new Set();
  const linkPattern =
    /href="(\/c\/product\/(\d+-REG)\/[^"]+)"/gi;

  for (const match of html.matchAll(linkPattern)) {
    const sku = match[2];
    if (seen.has(sku)) continue;
    seen.add(sku);

    products.push({
      sku,
      title: null,
      url: `https://www.bhphotovideo.com${match[1].split("?")[0]}`,
      price: null,
      urlMatchesSkuReg: true,
    });
  }

  return products;
}

async function runSmokeTest() {
  console.log("=== B&H Photo Smoke Test ===\n");
  console.log(
    `Mode: ${headed ? "headed (persistent profile)" : "headless (persistent profile)"}`
  );
  console.log(`Profile: ${profileDir}`);
  console.log(`URL: ${CATEGORY_URL}\n`);

  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    channel: "chromium",
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  let response;

  try {
    response = await page.goto(CATEGORY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    const httpStatus = response?.status() ?? null;
    const bodyText = await page.locator("body").innerText();
    const pageTitle = await page.title();
    const html = await page.content();
    const challengeDetected =
      CHALLENGE_PATTERN.test(bodyText) ||
      CHALLENGE_PATTERN.test(pageTitle);

    let products = await page.evaluate(extractProductsFromDom);

    if (products.length === 0) {
      products = parseProductsFromHtml(html);
    }

    const productCardCount = products.length;
    const sample = products.slice(0, 5);
    const skuRegMatches = sample.filter((p) => p.urlMatchesSkuReg).length;

    console.log(`HTTP status: ${httpStatus ?? "unknown"}`);
    console.log(`Final URL: ${finalUrl}`);
    console.log(
      `Cloudflare/Turnstile/challenge detected: ${challengeDetected ? "yes" : "no"}`
    );
    console.log(`Product cards found: ${productCardCount}`);

    console.log("\nFirst 5 titles:");
    if (sample.length === 0) {
      console.log("  (none)");
    } else {
      for (const product of sample) {
        console.log(`  - ${product.title ?? "(title not parsed)"}`);
      }
    }

    console.log("\nFirst 5 prices:");
    if (sample.length === 0) {
      console.log("  (none)");
    } else {
      for (const product of sample) {
        console.log(
          `  - ${product.price != null ? `$${product.price}` : "(not parsed)"}`
        );
      }
    }

    console.log("\nFirst 5 product URLs:");
    if (sample.length === 0) {
      console.log("  (none)");
    } else {
      for (const product of sample) {
        console.log(`  - ${product.url}`);
      }
    }

    console.log("\nProduct URL format (/c/product/{sku}-REG/):");
    if (sample.length === 0) {
      console.log("  (no URLs to check)");
    } else {
      for (const product of sample) {
        console.log(
          `  - ${product.urlMatchesSkuReg ? "yes" : "no"}: ${product.url}`
        );
      }
      console.log(`  Summary: ${skuRegMatches}/${sample.length} match pattern`);
    }

    if (challengeDetected || productCardCount === 0) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  runSmokeTest().catch((error) => {
    console.error("Smoke test failed:", error.message);
    process.exit(1);
  });
}

module.exports = { runSmokeTest, CATEGORY_URL, SKU_REG_PATH };

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const FACETS = {
  desktopMemory: "4294966965",
  ddr5: "4294815592",
  ddr4: "4294818366",
  crucialBrand: "4294821695",
};

const DEFAULT_STORE_ID = "181";

const headed = process.argv.includes("--headed");
const headless = headed ? false : process.env.HEADLESS !== "false";
const storeId = process.env.MICROCENTER_STORE_ID || DEFAULT_STORE_ID;
const profileDir = path.join(__dirname, "..", ".playwright", "microcenter-profile");

const CHALLENGE_PATTERN =
  /just a moment|performing security verification|cloudflare|verify you are human|access denied|unusual traffic|ray id:/i;

function buildSearchUrl() {
  const params = new URLSearchParams({
    N: `${FACETS.desktopMemory}+${FACETS.ddr5}`,
    NTK: "all",
    sortby: "pricelow",
    rpp: "96",
  });

  return `https://www.microcenter.com/search/search_results.aspx?${params.toString()}`;
}

function describeUrlFilters(url) {
  const parsed = new URL(url);
  const nParam = parsed.searchParams.get("N") || "";
  const facets = nParam.split("+").map((value) => value.trim()).filter(Boolean);

  return {
    facets,
    hasDesktopMemory: facets.includes(FACETS.desktopMemory),
    hasDdr5: facets.includes(FACETS.ddr5),
    hasCrucialBrand: facets.includes(FACETS.crucialBrand),
    categoryLabel: parsed.searchParams.get("cat") || null,
  };
}

function parseEmbeddedProducts(html) {
  const products = [];
  const pattern =
    /\{\s*'name':\s*'((?:\\'|[^'])*)',\s*'id':\s*'(\d+)',\s*'price':\s*'([\d,\.]+)'/g;

  for (const match of html.matchAll(pattern)) {
    products.push({
      id: match[2],
      title: match[1].replace(/\\'/g, "'"),
      price: Number(match[3].replace(/,/g, "")),
    });
  }

  return products;
}

function extractProductsFromDom() {
  const seen = new Set();
  const products = [];

  for (const anchor of document.querySelectorAll('a[href*="/product/"]')) {
    const href = anchor.href.split("?")[0];
    const idMatch = href.match(/\/product\/(\d+)\//);
    if (!idMatch) continue;

    const id = idMatch[1];
    if (seen.has(id)) continue;

    const title = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title || title.length < 15) continue;
    if (/quick view|compare item|add sku|wishlist/i.test(title)) continue;

    seen.add(id);
    products.push({ id, title, url: href, price: null });
  }

  return products;
}

async function runSmokeTest() {
  const searchUrl = buildSearchUrl();

  console.log("=== Micro Center Smoke Test ===\n");
  console.log(
    `Store ID: ${storeId}${process.env.MICROCENTER_STORE_ID ? "" : " (default Denver)"}`
  );
  console.log(`Mode: ${headed ? "headed (persistent profile)" : "headless (persistent profile)"}`);
  console.log(`Profile: ${profileDir}`);
  console.log(`Intended URL: ${searchUrl}`);
  console.log(
    "Facet note: 4294815592 = DDR5 memory type; 4294821695 = Crucial brand (old smoke URL bug)\n"
  );

  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    channel: "chromium",
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: "storeSelected",
      value: String(storeId),
      domain: ".microcenter.com",
      path: "/",
    },
    {
      name: "myStore",
      value: "true",
      domain: ".microcenter.com",
      path: "/",
    },
  ]);

  const page = context.pages()[0] ?? (await context.newPage());
  let response;

  try {
    response = await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    const filters = describeUrlFilters(finalUrl);
    const httpStatus = response?.status() ?? null;
    const bodyText = await page.locator("body").innerText();
    const html = await page.content();
    const challengeDetected = CHALLENGE_PATTERN.test(bodyText);

    let products = parseEmbeddedProducts(html);
    if (products.length === 0) {
      products = await page.evaluate(extractProductsFromDom);
    }

    const productCardCount = products.length;
    const titles = products.slice(0, 5).map((p) => p.title);
    const prices = products
      .slice(0, 5)
      .map((p) => (p.price != null ? `$${p.price}` : "(not parsed)"));

    console.log(`HTTP status: ${httpStatus ?? "unknown"}`);
    console.log(`Final URL: ${finalUrl}`);
    console.log(
      `Active facets: ${filters.facets.join(" + ") || "(none parsed from N=)"}`
    );
    console.log(
      `Filter check: desktopMemory=${filters.hasDesktopMemory} ddr5=${filters.hasDdr5} crucialBrand=${filters.hasCrucialBrand}`
    );
    if (filters.categoryLabel) {
      console.log(`Category label: ${filters.categoryLabel}`);
    }
    if (filters.hasCrucialBrand) {
      console.log(
        "WARNING: Crucial brand facet detected — results are brand-filtered, not DDR5 category-wide."
      );
    }
    console.log(`Cloudflare/challenge detected: ${challengeDetected ? "yes" : "no"}`);
    console.log(`Product cards found: ${productCardCount}`);
    console.log("\nFirst 5 titles:");
    if (titles.length === 0) {
      console.log("  (none)");
    } else {
      for (const title of titles) {
        console.log(`  - ${title}`);
      }
    }
    console.log("\nFirst 5 prices:");
    if (prices.length === 0) {
      console.log("  (none)");
    } else {
      for (const price of prices) {
        console.log(`  - ${price}`);
      }
    }

    if (
      challengeDetected ||
      productCardCount === 0 ||
      filters.hasCrucialBrand ||
      !filters.hasDdr5
    ) {
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

module.exports = {
  runSmokeTest,
  buildSearchUrl,
  describeUrlFilters,
  FACETS,
};

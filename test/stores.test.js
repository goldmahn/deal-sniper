const { test } = require("node:test");
const assert = require("node:assert/strict");

const { mapNeweggItems } = require("../src/stores/newegg");
const { mapCraigslistItems } = require("../src/stores/craigslist");

const FIXED_NOW = () => "2026-05-29T00:00:00.000Z";

test("mapNeweggItems builds observation rows with correct prices", () => {
  const rows = mapNeweggItems(
    [
      { title: "DDR5 32GB", url: "https://newegg.com/p/A", priceWhole: "79", priceFraction: "99", shippingText: "Free Shipping" },
      { title: "DDR5 64GB", url: "https://newegg.com/p/B", priceWhole: "129", priceFraction: ".49", shippingText: "" },
    ],
    { name: "W", targetPrice: 80 },
    FIXED_NOW
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].price, 79.99); // not 7999
  assert.equal(rows[1].price, 129.49);
  assert.equal(rows[0].store, "newegg");
  assert.equal(rows[0].watchName, "W");
  assert.equal(rows[0].targetPrice, 80);
  assert.equal(rows[0].checkedAt, "2026-05-29T00:00:00.000Z");
});

test("mapNeweggItems drops rows missing title, url, or any price part", () => {
  const rows = mapNeweggItems(
    [
      { title: null, url: "https://x", priceWhole: "10", priceFraction: "00" },
      { title: "T", url: null, priceWhole: "10", priceFraction: "00" },
      { title: "T", url: "https://x", priceWhole: "", priceFraction: "" },
    ],
    { name: "W" },
    FIXED_NOW
  );
  assert.equal(rows.length, 0);
});

test("mapCraigslistItems parses prices and carries location", () => {
  const rows = mapCraigslistItems(
    [
      { title: "DDR5 kit", url: "https://sfbay.craigslist.org/d/1.html", priceText: "$60", locationText: "oakland" },
      { title: "RAM lot", url: "https://sfbay.craigslist.org/d/2.html", priceText: "", locationText: "" },
    ],
    { name: "CL", targetPrice: 60 },
    FIXED_NOW
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].store, "craigslist");
  assert.equal(rows[0].price, 60);
  assert.equal(rows[0].locationText, "oakland");
  assert.equal(rows[1].price, null); // no price posted
  assert.equal(rows[0].targetPrice, 60);
});

test("mapCraigslistItems drops rows without a title or url", () => {
  const rows = mapCraigslistItems(
    [
      { title: null, url: "https://x", priceText: "$5" },
      { title: "T", url: null, priceText: "$5" },
    ],
    { name: "CL" },
    FIXED_NOW
  );
  assert.equal(rows.length, 0);
});

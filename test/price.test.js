const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parsePrice, combinePrice } = require("../src/price");

test("parsePrice handles currency symbols, commas, and decimals", () => {
  assert.equal(parsePrice("$79.99"), 79.99);
  assert.equal(parsePrice("1,234.56"), 1234.56);
  assert.equal(parsePrice("$100"), 100);
  assert.equal(parsePrice(" $ 49 "), 49);
});

test("parsePrice returns null for non-numeric or missing input", () => {
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(undefined), null);
  assert.equal(parsePrice("free"), null);
  assert.equal(parsePrice(""), null);
});

test("combinePrice handles a fraction with a leading dot", () => {
  assert.equal(combinePrice("79", ".99"), 79.99);
});

test("combinePrice handles a fraction WITHOUT a leading dot (the 100x bug)", () => {
  // This is the regression: "79" + "99" must be 79.99, not 7999.
  assert.equal(combinePrice("79", "99"), 79.99);
  assert.equal(combinePrice("1,234", "56"), 1234.56);
});

test("combinePrice handles a whole price with no fraction", () => {
  assert.equal(combinePrice("100", ""), 100);
  assert.equal(combinePrice("100", null), 100);
});

test("combinePrice strips stray symbols from the whole part", () => {
  assert.equal(combinePrice("$1,499", ".00"), 1499);
});

test("combinePrice returns null when there are no dollars", () => {
  assert.equal(combinePrice("", ".99"), null);
  assert.equal(combinePrice(null, null), null);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { getProductBaselineKey } = require("../src/product-baselines");

test("product baseline key uses store and productKey", () => {
  assert.equal(
    getProductBaselineKey("newegg", "newegg:item:N82E16820982007"),
    "newegg:newegg:item:N82E16820982007"
  );
});

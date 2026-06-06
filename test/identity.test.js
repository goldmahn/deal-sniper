const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  enrichNeweggListingIdentity,
  buildProductIdentity,
  extractNeweggItemId,
  extractModelNumber,
  normalizeNeweggUrl,
} = require("../src/identity/newegg-ram");

test("extractNeweggItemId pulls the id from a /p/ path", () => {
  assert.equal(
    extractNeweggItemId("https://www.newegg.com/p/N82E16820982308?Item=abc"),
    "N82E16820982308"
  );
});

test("extractNeweggItemId returns null for missing or non-/p/ urls", () => {
  assert.equal(extractNeweggItemId(null), null);
  assert.equal(extractNeweggItemId("https://www.newegg.com/d/pl?d=ddr5"), null);
  assert.equal(extractNeweggItemId("not a url"), null);
});

test("extractModelNumber normalizes case and strips trailing punctuation", () => {
  assert.equal(extractModelNumber("Corsair RAM Model cmk32gx5m2."), "CMK32GX5M2");
  assert.equal(extractModelNumber("G.Skill Model F5-6000J3038F16G"), "F5-6000J3038F16G");
});

test("extractModelNumber returns null when no model token present", () => {
  assert.equal(extractModelNumber("Generic DDR5 32GB Kit"), null);
  assert.equal(extractModelNumber(null), null);
});

test("normalizeNeweggUrl drops query string and hash", () => {
  assert.equal(
    normalizeNeweggUrl("https://www.newegg.com/p/N82E16820982308?Item=9SIA&x=1#reviews"),
    "https://www.newegg.com/p/N82E16820982308"
  );
});

test("buildProductIdentity prefers item id, then model, then url", () => {
  const byItem = buildProductIdentity({
    url: "https://www.newegg.com/p/N82E16820982308?Item=x",
    title: "Corsair Model CMK32 DDR5",
  });
  assert.equal(byItem.productKey, "newegg:item:N82E16820982308");
  assert.equal(byItem.productKeySource, "newegg_item_id");
  assert.equal(byItem.identityConfidence, "high");

  const byModel = buildProductIdentity({
    url: "https://www.newegg.com/d/pl?d=ddr5",
    title: "Corsair Model CMK32GX5M2 DDR5",
  });
  assert.equal(byModel.productKey, "newegg:model:CMK32GX5M2");
  assert.equal(byModel.productKeySource, "model_number");
  assert.equal(byModel.identityConfidence, "medium");

  const byUrl = buildProductIdentity({
    url: "https://www.newegg.com/d/pl?d=ddr5",
    title: "Generic DDR5 32GB",
  });
  assert.equal(byUrl.productKey, "newegg:url:https://www.newegg.com/d/pl");
  assert.equal(byUrl.productKeySource, "normalized_url");
  assert.equal(byUrl.identityConfidence, "low");
});

test("buildProductIdentity reports none when nothing is extractable", () => {
  const identity = buildProductIdentity({ url: null, title: null });
  assert.equal(identity.productKey, null);
  assert.equal(identity.productKeySource, "none");
});

test("enrichNeweggListingIdentity mutates newegg listings and skips others", () => {
  const newegg = {
    store: "newegg",
    url: "https://www.newegg.com/p/N82E16820982308",
    title: "x",
  };
  enrichNeweggListingIdentity(newegg);
  assert.equal(newegg.productKey, "newegg:item:N82E16820982308");

  const other = { store: "amazon", url: "https://amazon.com/p/123", title: "x" };
  enrichNeweggListingIdentity(other);
  assert.equal(other.productKey, undefined);
});

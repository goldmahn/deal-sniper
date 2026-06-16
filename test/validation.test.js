const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateListingTitle } = require("../src/validation");

test("no requirements always passes", () => {
  const result = validateListingTitle("anything goes", undefined);
  assert.equal(result.validationPassed, true);
  assert.deepEqual(result.validationReasons, []);
});

test("passes when title satisfies every requirement", () => {
  const result = validateListingTitle(
    "Corsair Vengeance DDR5 32GB (2 x 16GB) DDR5 6000",
    {
      generation: "DDR5",
      totalCapacityGB: 32,
      allowedKitLayouts: ["2x16"],
      excludeTerms: ["SO-DIMM", "Laptop"],
    }
  );
  assert.equal(result.validationPassed, true);
  assert.deepEqual(result.validationReasons, []);
});

test("flags missing generation", () => {
  const result = validateListingTitle("Some DDR4 32GB (2 x 16GB) kit", {
    generation: "DDR5",
  });
  assert.equal(result.validationPassed, false);
  assert.match(result.validationReasons[0], /missing generation/);
});

test("capacity match requires a word boundary (320GB != 32GB)", () => {
  const ok = validateListingTitle("DDR5 32GB kit", { totalCapacityGB: 32 });
  assert.equal(ok.validationPassed, true);

  const wrong = validateListingTitle("DDR5 320GB kit", { totalCapacityGB: 32 });
  assert.equal(wrong.validationPassed, false);
});

test("kit layout accepts parenthesized and bare forms", () => {
  for (const title of [
    "DDR5 (2 x 16GB)",
    "DDR5 2 x 16GB",
    "DDR5 2x16GB",
  ]) {
    const result = validateListingTitle(title, { allowedKitLayouts: ["2x16"] });
    assert.equal(result.validationPassed, true, `expected pass for: ${title}`);
  }
});

test("kit layout accepts any of several allowed layouts", () => {
  const result = validateListingTitle("DDR5 64GB (4 x 16GB)", {
    allowedKitLayouts: ["2x32", "4x16"],
  });
  assert.equal(result.validationPassed, true);
});

test("exclude terms reject the listing", () => {
  const result = validateListingTitle("DDR5 32GB SO-DIMM Laptop memory", {
    excludeTerms: ["SO-DIMM", "Laptop"],
  });
  assert.equal(result.validationPassed, false);
  assert.equal(result.validationReasons.length, 2);
});

test("exclude terms use word boundaries so Gaming PC does not match PCI Express", () => {
  const gpu = validateListingTitle(
    "ASUS TUF Gaming GeForce RTX 5070 Ti 16GB PCI Express 5.0 Graphics Card",
    { mustInclude: ["RTX", "5070 Ti"], excludeTerms: ["Gaming PC"] }
  );
  assert.equal(gpu.validationPassed, true);

  const prebuilt = validateListingTitle("RTX 5070 Ti Gaming PC Desktop", {
    mustInclude: ["RTX", "5070 Ti"],
    excludeTerms: ["Gaming PC"],
  });
  assert.equal(prebuilt.validationPassed, false);
});

test("accumulates multiple failure reasons", () => {
  const result = validateListingTitle("DDR4 16GB SO-DIMM", {
    generation: "DDR5",
    totalCapacityGB: 32,
    allowedKitLayouts: ["2x16"],
    excludeTerms: ["SO-DIMM"],
  });
  assert.equal(result.validationPassed, false);
  assert.equal(result.validationReasons.length, 4);
});

test("handles null title without throwing", () => {
  const result = validateListingTitle(null, { generation: "DDR5" });
  assert.equal(result.validationPassed, false);
});

test("mustInclude requires every listed term", () => {
  const pass = validateListingTitle(
    "ASUS TUF Gaming GeForce RTX 5070 Ti 16GB GDDR7",
    { mustInclude: ["RTX", "5070 Ti"] }
  );
  assert.equal(pass.validationPassed, true);

  const missingTi = validateListingTitle("MSI GeForce RTX 5070 12GB", {
    mustInclude: ["RTX", "5070 Ti"],
  });
  assert.equal(missingTi.validationPassed, false);
  assert.match(missingTi.validationReasons[0], /5070 Ti/);
});

test("mustInclude accepts compact multi-word terms without spaces", () => {
  const result = validateListingTitle("Gigabyte RTX5070Ti Gaming OC 16G", {
    mustInclude: ["RTX", "5070 Ti"],
  });
  assert.equal(result.validationPassed, true);
});

test("mustInclude works alongside RAM generation rules", () => {
  const result = validateListingTitle("Corsair Vengeance DDR5 32GB (2 x 16GB)", {
    generation: "DDR5",
    totalCapacityGB: 32,
    allowedKitLayouts: ["2x16"],
    mustInclude: ["DDR5"],
  });
  assert.equal(result.validationPassed, true);
});

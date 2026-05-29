const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  dedupeValidListingsByProductKey,
  annotateResultsDedupe,
  pickGroupWinner,
} = require("../src/identity/dedupe-by-product-key");

test("pickGroupWinner: lower price wins", () => {
  const a = { price: 100 };
  const b = { price: 80 };
  assert.equal(pickGroupWinner(a, 0, b, 1), b);
  assert.equal(pickGroupWinner(b, 0, a, 1), b);
});

test("pickGroupWinner: a priced listing beats a null-priced one", () => {
  const priced = { price: 100 };
  const noPrice = { price: null };
  assert.equal(pickGroupWinner(noPrice, 0, priced, 1), priced);
  assert.equal(pickGroupWinner(priced, 0, noPrice, 1), priced);
});

test("pickGroupWinner: ties and double-null break toward the earlier index", () => {
  const first = { price: 50 };
  const second = { price: 50 };
  assert.equal(pickGroupWinner(first, 0, second, 1), first);

  const n1 = { price: null };
  const n2 = { price: null };
  assert.equal(pickGroupWinner(n1, 0, n2, 1), n1);
});

test("dedupe collapses same productKey to the cheapest and counts duplicates", () => {
  const valid = [
    { productKey: "k1", price: 100 },
    { productKey: "k1", price: 80 },
    { productKey: "k2", price: 200 },
  ];
  const { keptForCandidate, keptSet, duplicatesCollapsed } =
    dedupeValidListingsByProductKey(valid);

  assert.equal(duplicatesCollapsed, 1);
  assert.equal(keptForCandidate.length, 2);
  assert.ok(keptSet.has(valid[1]), "cheaper k1 listing kept");
  assert.ok(!keptSet.has(valid[0]), "pricier k1 listing dropped");
  assert.ok(keptSet.has(valid[2]), "k2 kept");
});

test("dedupe keeps every listing that has no productKey", () => {
  const valid = [
    { price: 100 },
    { price: 80 },
  ];
  const { keptForCandidate, duplicatesCollapsed } =
    dedupeValidListingsByProductKey(valid);
  assert.equal(duplicatesCollapsed, 0);
  assert.equal(keptForCandidate.length, 2);
});

test("annotateResultsDedupe tags kept / duplicate / not_applicable", () => {
  const kept = { validationPassed: true, productKey: "k1", price: 80 };
  const dup = { validationPassed: true, productKey: "k1", price: 100 };
  const noKey = { validationPassed: true, price: 50 };
  const invalid = { validationPassed: false, productKey: "k9" };

  const results = [kept, dup, noKey, invalid];
  const { keptSet } = dedupeValidListingsByProductKey([kept, dup, noKey]);
  annotateResultsDedupe(results, keptSet);

  assert.equal(kept.dedupeRole, "kept");
  assert.equal(kept.dedupeGroupKey, "k1");
  assert.equal(dup.dedupeRole, "duplicate");
  assert.equal(noKey.dedupeRole, "kept");
  assert.equal(invalid.dedupeRole, "not_applicable");
});

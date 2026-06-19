const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStorageCapacities,
  isAcceptedCapacityToken,
  validateStorageCapacity,
  classifyCapacityBucket,
  getAcceptedCapacities,
} = require("../src/storage-capacity");
const { validateListingTitle } = require("../src/validation");

const NVME_4TB_REQUIREMENTS = {
  storageCapacityTB: 4,
  mustInclude: ["NVMe"],
  excludeTerms: [
    "External",
    "Portable",
    "Enclosure",
    "Adapter",
    "Dock",
    "SATA",
    "2.5",
    "HDD",
    "Hard Drive",
    "Refurbished",
    "Open Box",
    "Used",
  ],
};

test("getAcceptedCapacities includes decimal and binary GB equivalents", () => {
  assert.deepEqual(getAcceptedCapacities(4), {
    tb: [4],
    gb: [4000, 4096],
  });
  assert.deepEqual(getAcceptedCapacities(2), {
    tb: [2],
    gb: [2000, 2048],
  });
});

test("parseStorageCapacities extracts TB and GB tokens with boundaries", () => {
  const tokens = parseStorageCapacities(
    "Samsung 990 PRO 4TB NVMe and 14TB archive drive"
  );
  assert.deepEqual(
    tokens.map((token) => token.raw),
    ["4TB", "14TB"]
  );
});

test("isAcceptedCapacityToken accepts 4TB class equivalents only", () => {
  assert.equal(isAcceptedCapacityToken({ value: 4, unit: "TB" }, 4), true);
  assert.equal(isAcceptedCapacityToken({ value: 4000, unit: "GB" }, 4), true);
  assert.equal(isAcceptedCapacityToken({ value: 4096, unit: "GB" }, 4), true);
  assert.equal(isAcceptedCapacityToken({ value: 512, unit: "GB" }, 4), false);
  assert.equal(isAcceptedCapacityToken({ value: 2, unit: "TB" }, 4), false);
});

test("validateStorageCapacity accepts true 4TB-class titles", () => {
  for (const title of [
    "Crucial P310 M.2 2280 4TB PCI-Express 4.0 x4 NVMe Internal SSD",
    "Enterprise 4096GB NVMe U.2 SSD",
    "Value 4000GB NVMe M.2 SSD",
  ]) {
    const result = validateStorageCapacity(title, 4);
    assert.equal(result.validationPassed, true, title);
  }
});

test("validateStorageCapacity rejects wrong capacities for a 4TB watch", () => {
  const cases = [
    "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe PCIe 4.0 Gen4 Gaming SSD",
    "SANDISK Optimus GX 7100M PCIe 4.0 x4 M.2 2230 NVMe 1TB SSD",
    "SANDISK Optimus GX 7100M PCIe 4.0 x4 M.2 2230 NVMe 2TB SSD",
    "SomeBrand 8TB NVMe M.2 PCIe Internal SSD",
    "SomeBrand 14TB NVMe M.2 PCIe Internal SSD",
    "SomeBrand 24TB NVMe M.2 PCIe Internal SSD",
    "SomeBrand 2048GB NVMe M.2 PCIe Internal SSD",
  ];

  for (const title of cases) {
    const result = validateStorageCapacity(title, 4);
    assert.equal(result.validationPassed, false, title);
  }
});

test("14TB and 24TB do not satisfy a 4TB requirement", () => {
  const fourteen = validateStorageCapacity(
    "SomeBrand 14TB NVMe M.2 PCIe Internal SSD",
    4
  );
  assert.match(fourteen.validationReasons.join(" "), /14TB/);

  const twentyFour = validateStorageCapacity(
    "SomeBrand 24TB NVMe M.2 PCIe Internal SSD",
    4
  );
  assert.match(twentyFour.validationReasons.join(" "), /24TB/);
});

test("mixed accepted and conflicting capacities fail", () => {
  const result = validateStorageCapacity(
    "Combo 4TB plus 2TB NVMe bundle",
    4
  );
  assert.equal(result.validationPassed, false);
  assert.match(result.validationReasons.join(" "), /2TB/);
});

test("classifyCapacityBucket maps parsed capacities to report buckets", () => {
  assert.equal(
    classifyCapacityBucket("KingSpec 512GB M.2 NVMe SSD"),
    "512GB"
  );
  assert.equal(classifyCapacityBucket("SanDisk 1TB NVMe SSD"), "1TB");
  assert.equal(classifyCapacityBucket("SanDisk 2TB NVMe SSD"), "2TB");
  assert.equal(classifyCapacityBucket("WD Blue 4TB NVMe SSD"), "4TB");
  assert.equal(classifyCapacityBucket("Archive 8TB NVMe SSD"), "8TB");
  assert.equal(classifyCapacityBucket("Generic NVMe SSD"), "Unknown");
});

test("4TB NVMe watch requirements reject polluted historical titles", () => {
  const polluted = [
    "KingSpec ONEBOOM X400 2280 512GB M.2 NVMe 1.4 PCIe 4.0 Gen4 Gaming SSD, Speed Up to 7400MB/s, 3D TLC NAND, Internal Solid State Disk Compatible for PS5",
    "SANDISK Optimus™ GX 7100M PCIe® 4.0 x4 M.2 2230 NVMe™ 1TB SSD 3D NAND TLC Internal Solid State Drive (SSD) SDSP71100TAT-000E0",
    "SANDISK Optimus™ GX 7100M PCIe® 4.0 x4 M.2 2230 NVMe™ 2TB SSD 3D NAND TLC Internal Solid State Drive (SSD) SDSP71200TAT-000E0",
  ];

  for (const title of polluted) {
    const result = validateListingTitle(title, NVME_4TB_REQUIREMENTS);
    assert.equal(result.validationPassed, false, title);
  }
});

test("4TB NVMe watch requirements accept legitimate 4TB internal NVMe titles", () => {
  const valid = [
    "Western Digital 4TB WD Blue SN5000 NVMe SSD, PCIe Gen 4.0, up to 5,500 MB/s Read Speeds Internal Solid State Drive (SSD)",
    "Team Group T-FORCE G50 M.2 2280 4TB PCIe 4.0 x4 with NVMe 1.4 TLC Internal Solid State Drive (SSD)",
    "Crucial P310 M.2 2280 4096GB PCI-Express 4.0 x4 NVMe Internal SSD",
  ];

  for (const title of valid) {
    const result = validateListingTitle(title, NVME_4TB_REQUIREMENTS);
    assert.equal(result.validationPassed, true, title);
  }
});

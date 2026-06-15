const { readdirSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

const testDir = join(__dirname, "..", "test");
const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(testDir, name));

if (testFiles.length === 0) {
  console.error("No test files found in test/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);

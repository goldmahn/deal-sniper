const { runScan } = require("./scan");

runScan().catch((error) => {
  console.error("Scan failed:", error.message);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const { dealsniperLogPath } = require("./monthly-paths");

const root = path.join(__dirname, "..");
const logDir = path.join(root, "logs");

function ensureLogDir() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function getLogPath() {
  return dealsniperLogPath(root);
}

function writeLog(message) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(getLogPath(), line);
}

module.exports = { writeLog, getLogPath };

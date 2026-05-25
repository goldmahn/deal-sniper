const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "..", "logs");
const logPath = path.join(logDir, "dealsniper.log");

function ensureLogDir() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function writeLog(message) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, line);
}

module.exports = { writeLog, logPath };

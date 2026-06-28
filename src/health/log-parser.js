const SCAN_STARTED_RE =
  /^\[(?<timestamp>[^\]]+)\] Scan started watches=(?<watches>\d+) headless=(?<headless>true|false)$/;
const SCAN_ENDED_RE =
  /^\[(?<timestamp>[^\]]+)\] Scan ended durationSec=(?<durationSec>[\d.]+) watches=(?<watches>\d+) listingsScraped=(?<listingsScraped>\d+) listingsValid=(?<listingsValid>\d+) duplicatesCollapsed=(?<duplicatesCollapsed>\d+) candidates=(?<candidates>\d+) alerts=(?<alerts>\d+) telegramSends=(?<telegramSends>\d+)$/;
const WATCH_DUPLICATES_RE =
  /^\[(?<timestamp>[^\]]+)\] Watch "(?<watchName>[^"]+)" duplicatesCollapsed=(?<duplicatesCollapsed>\d+)$/;
const WATCH_ERROR_RE =
  /^\[(?<timestamp>[^\]]+)\] ERROR watch="(?<watchName>[^"]+)" (?<message>.+)$/;
const SCAN_ERROR_RE = /^\[(?<timestamp>[^\]]+)\] ERROR Scan failed(?:: (?<message>.+))?$/;

function parseLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let match = trimmed.match(SCAN_STARTED_RE);
  if (match) {
    return {
      type: "scan_started",
      timestamp: match.groups.timestamp,
      watches: Number(match.groups.watches),
      headless: match.groups.headless === "true",
    };
  }

  match = trimmed.match(SCAN_ENDED_RE);
  if (match) {
    return {
      type: "scan_ended",
      timestamp: match.groups.timestamp,
      durationSec: Number(match.groups.durationSec),
      watches: Number(match.groups.watches),
      listingsScraped: Number(match.groups.listingsScraped),
      listingsValid: Number(match.groups.listingsValid),
      duplicatesCollapsed: Number(match.groups.duplicatesCollapsed),
      candidates: Number(match.groups.candidates),
      alerts: Number(match.groups.alerts),
      telegramSends: Number(match.groups.telegramSends),
    };
  }

  match = trimmed.match(WATCH_DUPLICATES_RE);
  if (match) {
    return {
      type: "watch_duplicates",
      timestamp: match.groups.timestamp,
      watchName: match.groups.watchName,
      duplicatesCollapsed: Number(match.groups.duplicatesCollapsed),
    };
  }

  match = trimmed.match(WATCH_ERROR_RE);
  if (match) {
    return {
      type: "watch_error",
      timestamp: match.groups.timestamp,
      watchName: match.groups.watchName,
      message: match.groups.message,
    };
  }

  match = trimmed.match(SCAN_ERROR_RE);
  if (match) {
    return {
      type: "scan_error",
      timestamp: match.groups.timestamp,
      message: match.groups.message ?? "",
    };
  }

  return null;
}

function parseLogContent(text) {
  return (text ?? "")
    .split("\n")
    .map(parseLogLine)
    .filter(Boolean);
}

function getScanEndedEvents(events) {
  return events.filter((event) => event.type === "scan_ended");
}

function getLatestScanEnded(events) {
  const ended = getScanEndedEvents(events);
  return ended.length > 0 ? ended[ended.length - 1] : null;
}

function getScanWindows(events) {
  const windows = [];

  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== "scan_started") {
      continue;
    }

    const ended = events
      .slice(index + 1)
      .find((event) => event.type === "scan_ended");

    if (ended) {
      windows.push({
        start: events[index].timestamp,
        end: ended.timestamp,
      });
    }
  }

  return windows;
}

function countConsecutiveWatchErrors(events, watchName) {
  const windows = getScanWindows(events);
  let consecutive = 0;

  for (let index = windows.length - 1; index >= 0; index -= 1) {
    const window = windows[index];
    const hadError = events.some(
      (event) =>
        event.type === "watch_error" &&
        event.watchName === watchName &&
        event.timestamp >= window.start &&
        event.timestamp <= window.end
    );

    if (!hadError) {
      break;
    }

    consecutive += 1;
  }

  return consecutive;
}

function duplicatesCollapsedByWatch(events) {
  const byWatch = new Map();

  for (const event of events) {
    if (event.type !== "watch_duplicates") {
      continue;
    }
    byWatch.set(event.watchName, event.duplicatesCollapsed);
  }

  return byWatch;
}

module.exports = {
  parseLogLine,
  parseLogContent,
  getScanEndedEvents,
  getLatestScanEnded,
  countConsecutiveWatchErrors,
  duplicatesCollapsedByWatch,
  getScanWindows,
};

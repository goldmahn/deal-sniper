const { HEALTH, statusFromIssues, worstStatus } = require("./levels");

function summarizeFailurePatterns(watchHealthEntries) {
  const counts = new Map();

  for (const entry of watchHealthEntries) {
    for (const issue of entry.issues) {
      counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([code, count]) => ({ code, count }));
}

function buildStoreHealthLayer(watchHealthLayer) {
  const byStore = new Map();

  for (const watch of watchHealthLayer.watches) {
    if (!byStore.has(watch.store)) {
      byStore.set(watch.store, []);
    }
    byStore.get(watch.store).push(watch);
  }

  const stores = [...byStore.entries()].map(([store, watches]) => {
    const healthy = watches.filter((entry) => entry.status === HEALTH.GREEN).length;
    const warning = watches.filter((entry) => entry.status === HEALTH.WARNING).length;
    const critical = watches.filter((entry) => entry.status === HEALTH.CRITICAL).length;
    const durations = watches
      .map((entry) => entry.metrics.scanDurationSec)
      .filter((value) => value != null);
    const averageScanDuration =
      durations.length > 0
        ? Number(
            (durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(
              1
            )
          )
        : null;

    return {
      store,
      totalWatches: watches.length,
      healthyWatches: healthy,
      warningWatches: warning,
      criticalWatches: critical,
      averageScanDuration,
      status: worstStatus(...watches.map((entry) => entry.status)),
      failurePatterns: summarizeFailurePatterns(watches),
    };
  });

  return {
    status: worstStatus(...stores.map((entry) => entry.status)),
    stores,
  };
}

module.exports = {
  summarizeFailurePatterns,
  buildStoreHealthLayer,
};

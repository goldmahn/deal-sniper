const HEALTH = {
  GREEN: "GREEN",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
};

const HEALTH_RANK = {
  [HEALTH.GREEN]: 0,
  [HEALTH.WARNING]: 1,
  [HEALTH.CRITICAL]: 2,
};

function worstStatus(...statuses) {
  return statuses.reduce((worst, status) => {
    const normalized = HEALTH[status] ? status : HEALTH.GREEN;
    return HEALTH_RANK[normalized] > HEALTH_RANK[worst] ? normalized : worst;
  }, HEALTH.GREEN);
}

function statusFromIssues(issues = []) {
  if (issues.some((issue) => issue.severity === HEALTH.CRITICAL)) {
    return HEALTH.CRITICAL;
  }
  if (issues.some((issue) => issue.severity === HEALTH.WARNING)) {
    return HEALTH.WARNING;
  }
  return HEALTH.GREEN;
}

module.exports = {
  HEALTH,
  HEALTH_RANK,
  worstStatus,
  statusFromIssues,
};

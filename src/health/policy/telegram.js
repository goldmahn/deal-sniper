const { HEALTH } = require("../levels");
const { POLICY_CLASS, CONFIDENCE } = require("./classes");

function isDigestOnlyIssue(issue) {
  return (
    issue.policyClass === POLICY_CLASS.QUALITY ||
    issue.policyClass === POLICY_CLASS.HISTORICAL
  );
}

function shouldPageImmediately(issue) {
  if (isDigestOnlyIssue(issue)) {
    return false;
  }

  if (issue.policyClass !== POLICY_CLASS.CRITICAL_OPERATIONAL) {
    return false;
  }

  if (issue.confidence === CONFIDENCE.LOW) {
    return false;
  }

  if (issue.severity === HEALTH.CRITICAL) {
    return true;
  }

  return issue.confidence === CONFIDENCE.HIGH;
}

function shouldPageWithThreshold(issue) {
  if (isDigestOnlyIssue(issue)) {
    return false;
  }

  if (issue.policyClass === POLICY_CLASS.WARNING_OPERATIONAL) {
    return true;
  }

  if (
    issue.policyClass === POLICY_CLASS.CRITICAL_OPERATIONAL &&
    issue.severity === HEALTH.WARNING &&
    issue.confidence === CONFIDENCE.MEDIUM
  ) {
    return true;
  }

  return false;
}

function shouldTrackInAlertState(issue) {
  return shouldPageImmediately(issue) || shouldPageWithThreshold(issue);
}

module.exports = {
  isDigestOnlyIssue,
  shouldPageImmediately,
  shouldPageWithThreshold,
  shouldTrackInAlertState,
};

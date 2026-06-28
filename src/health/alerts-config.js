require("dotenv").config();

function loadHealthAlertsConfig(env = process.env) {
  const enabled = env.HEALTH_ALERTS_ENABLED !== "false";

  return {
    enabled,
    dailyDigestHour: Number(env.HEALTH_DAILY_DIGEST_HOUR) || 20,
    warningConsecutive: Number(env.HEALTH_WARNING_CONSECUTIVE) || 3,
    warningCooldownMs:
      (Number(env.HEALTH_WARNING_COOLDOWN_HOURS) || 24) * 60 * 60 * 1000,
    criticalCooldownMs:
      (Number(env.HEALTH_CRITICAL_COOLDOWN_MINUTES) || 60) * 60 * 1000,
  };
}

module.exports = { loadHealthAlertsConfig };

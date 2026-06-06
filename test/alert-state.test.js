const { test } = require("node:test");
const assert = require("node:assert/strict");

const { resolveAlertStateKey } = require("../src/alert-state");

// Note: shouldSendTelegramAlert / recordAlertSent read and write the real
// data/alert-state.json (fixed root), so they are not exercised here to avoid
// mutating live data. The cooldown read-modify-write behavior is covered at the
// repository layer in repositories.test.js. resolveAlertStateKey is pure.

test("resolveAlertStateKey prefers productKey when present", () => {
  const { alertStateKey, alertStateKeySource } = resolveAlertStateKey({
    store: "newegg",
    watchName: "DDR5 32GB",
    productKey: "newegg:item:N82E1",
    url: "https://www.newegg.com/p/N82E1",
  });
  assert.equal(alertStateKey, "newegg:DDR5 32GB:newegg:item:N82E1");
  assert.equal(alertStateKeySource, "productKey");
});

test("resolveAlertStateKey falls back to url without a productKey", () => {
  const { alertStateKey, alertStateKeySource } = resolveAlertStateKey({
    store: "newegg",
    watchName: "DDR5 32GB",
    url: "https://www.newegg.com/p/N82E1",
  });
  assert.equal(alertStateKey, "newegg:DDR5 32GB:https://www.newegg.com/p/N82E1");
  assert.equal(alertStateKeySource, "url");
});

// Shared price parsing helpers used by store adapters.
//
// Newegg renders a price as a whole-dollar <strong> plus a fractional <sup>.
// The <sup> sometimes includes the leading dot (".99") and sometimes does not
// ("99"); naive concatenation turned $79.99 into $7999. combinePrice handles
// both shapes. parsePrice handles a single free-form string (e.g. Craigslist).

function parsePrice(text) {
  if (text == null) return null;

  const match = String(text).match(/[\d,]+(?:\.\d{1,2})?/);
  if (!match) return null;

  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function combinePrice(whole, fraction) {
  const dollars = String(whole ?? "").replace(/[^\d]/g, "");
  if (!dollars) return null;

  const cents = String(fraction ?? "")
    .replace(/[^\d]/g, "")
    .slice(0, 2);

  if (!cents) return parsePrice(dollars);

  return parsePrice(`${dollars}.${cents.padEnd(2, "0")}`);
}

module.exports = { parsePrice, combinePrice };

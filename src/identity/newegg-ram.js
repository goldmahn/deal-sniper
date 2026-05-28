function extractNeweggItemId(url) {
  if (!url) return null;

  try {
    const match = new URL(url).pathname.match(/\/p\/([^/]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractModelNumber(title) {
  if (!title) return null;

  const match = title.match(/\bModel\s+([A-Z0-9][A-Z0-9._-]+)/i);
  if (!match) return null;

  return match[1].replace(/[.,;]+$/, "").toUpperCase();
}

function normalizeNeweggUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildProductIdentity({ url, title }) {
  const neweggItemId = extractNeweggItemId(url);
  const modelNumber = extractModelNumber(title);
  const normalizedUrl = normalizeNeweggUrl(url);

  let productKey = null;
  let productKeySource = "none";
  let identityConfidence = "low";

  if (neweggItemId) {
    productKey = `newegg:item:${neweggItemId}`;
    productKeySource = "newegg_item_id";
    identityConfidence = "high";
  } else if (modelNumber) {
    productKey = `newegg:model:${modelNumber}`;
    productKeySource = "model_number";
    identityConfidence = "medium";
  } else if (normalizedUrl) {
    productKey = `newegg:url:${normalizedUrl}`;
    productKeySource = "normalized_url";
    identityConfidence = "low";
  }

  return {
    neweggItemId,
    modelNumber,
    normalizedUrl,
    productKey,
    productKeySource,
    identityConfidence,
  };
}

function enrichNeweggListingIdentity(listing) {
  if (listing.store !== "newegg") {
    return listing;
  }

  return Object.assign(listing, buildProductIdentity(listing));
}

module.exports = {
  enrichNeweggListingIdentity,
  buildProductIdentity,
  extractNeweggItemId,
  extractModelNumber,
  normalizeNeweggUrl,
};

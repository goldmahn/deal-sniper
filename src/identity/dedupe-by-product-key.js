function pickGroupWinner(incumbent, incumbentIndex, challenger, challengerIndex) {
  const incumbentPrice = incumbent.price;
  const challengerPrice = challenger.price;

  if (incumbentPrice === null && challengerPrice === null) {
    return incumbentIndex <= challengerIndex ? incumbent : challenger;
  }
  if (incumbentPrice === null) return challenger;
  if (challengerPrice === null) return incumbent;
  if (challengerPrice < incumbentPrice) return challenger;
  if (incumbentPrice < challengerPrice) return incumbent;
  return incumbentIndex <= challengerIndex ? incumbent : challenger;
}

function dedupeValidListingsByProductKey(validResults) {
  const groupWinners = new Map();
  const noKeyKept = [];
  let duplicatesCollapsed = 0;

  for (let i = 0; i < validResults.length; i++) {
    const listing = validResults[i];
    const key = listing.productKey;

    if (!key) {
      noKeyKept.push(listing);
      continue;
    }

    const current = groupWinners.get(key);
    if (!current) {
      groupWinners.set(key, { listing, index: i });
      continue;
    }

    duplicatesCollapsed += 1;
    const winner = pickGroupWinner(
      current.listing,
      current.index,
      listing,
      i
    );
    const winnerIndex = winner === listing ? i : current.index;
    groupWinners.set(key, { listing: winner, index: winnerIndex });
  }

  const keptForCandidate = [
    ...noKeyKept,
    ...Array.from(groupWinners.values(), (entry) => entry.listing),
  ];
  const keptSet = new Set(keptForCandidate);

  return { keptForCandidate, keptSet, duplicatesCollapsed };
}

function annotateListingDedupe(listing, keptSet) {
  if (!listing.validationPassed) {
    listing.dedupeRole = "not_applicable";
    return;
  }

  if (!listing.productKey) {
    listing.dedupeRole = "kept";
    return;
  }

  listing.dedupeGroupKey = listing.productKey;
  listing.dedupeRole = keptSet.has(listing) ? "kept" : "duplicate";
}

function annotateResultsDedupe(results, keptSet) {
  for (const listing of results) {
    annotateListingDedupe(listing, keptSet);
  }
}

module.exports = {
  dedupeValidListingsByProductKey,
  annotateResultsDedupe,
  pickGroupWinner,
};

function titleHasCapacityGB(title, capacityGB) {
  const pattern = new RegExp(`\\b${capacityGB}\\s*gb\\b`, "i");
  return pattern.test(title);
}

function titleMatchesKitLayout(title, layout) {
  const parts = layout.toLowerCase().split("x");
  if (parts.length !== 2) return false;

  const modules = parts[0].trim();
  const perModuleGB = parts[1].trim();
  const pattern = new RegExp(
    `\\(\\s*${modules}\\s*x\\s*${perModuleGB}\\s*gb\\s*\\)|` +
      `\\b${modules}\\s*x\\s*${perModuleGB}\\s*gb\\b|` +
      `\\b${modules}x${perModuleGB}\\s*gb\\b`,
    "i"
  );

  return pattern.test(title);
}

function validateListingTitle(title, requirements) {
  if (!requirements) {
    return { validationPassed: true, validationReasons: [] };
  }

  const reasons = [];
  const normalizedTitle = title ?? "";

  if (requirements.generation) {
    const generation = requirements.generation.toLowerCase();
    if (!normalizedTitle.toLowerCase().includes(generation)) {
      reasons.push(`missing generation: ${requirements.generation}`);
    }
  }

  if (requirements.totalCapacityGB != null) {
    if (!titleHasCapacityGB(normalizedTitle, requirements.totalCapacityGB)) {
      reasons.push(`missing capacity: ${requirements.totalCapacityGB}GB`);
    }
  }

  if (requirements.allowedKitLayouts?.length) {
    const hasLayout = requirements.allowedKitLayouts.some((layout) =>
      titleMatchesKitLayout(normalizedTitle, layout)
    );

    if (!hasLayout) {
      reasons.push(
        `missing kit layout (allowed: ${requirements.allowedKitLayouts.join(", ")})`
      );
    }
  }

  if (requirements.excludeTerms?.length) {
    const titleLower = normalizedTitle.toLowerCase();

    for (const term of requirements.excludeTerms) {
      if (titleLower.includes(term.toLowerCase())) {
        reasons.push(`excluded term: ${term}`);
      }
    }
  }

  return {
    validationPassed: reasons.length === 0,
    validationReasons: reasons,
  };
}

module.exports = { validateListingTitle };

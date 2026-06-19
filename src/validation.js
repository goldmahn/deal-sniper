const { validateStorageCapacity } = require("./storage-capacity");

function titleHasCapacityGB(title, capacityGB) {
  const pattern = new RegExp(`\\b${capacityGB}\\s*gb\\b`, "i");
  return pattern.test(title);
}

function titleIncludesTerm(title, term) {
  const titleLower = title.toLowerCase();
  const termLower = term.toLowerCase();

  if (titleLower.includes(termLower)) {
    return true;
  }

  if (/\s/.test(termLower)) {
    const compactTitle = titleLower.replace(/\s+/g, "");
    const compactTerm = termLower.replace(/\s+/g, "");
    return compactTitle.includes(compactTerm);
  }

  return false;
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

function titleHasExcludedTerm(title, term) {
  const titleLower = title.toLowerCase();
  const termLower = term.toLowerCase();
  const escaped = termLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i");

  return pattern.test(titleLower);
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

  if (requirements.storageCapacityTB != null) {
    const capacityValidation = validateStorageCapacity(
      normalizedTitle,
      requirements.storageCapacityTB
    );

    if (!capacityValidation.validationPassed) {
      reasons.push(...capacityValidation.validationReasons);
    }
  }

  if (requirements.mustInclude?.length) {
    for (const term of requirements.mustInclude) {
      if (!titleIncludesTerm(normalizedTitle, term)) {
        reasons.push(`missing required term: ${term}`);
      }
    }
  }

  if (requirements.excludeTerms?.length) {
    for (const term of requirements.excludeTerms) {
      if (titleHasExcludedTerm(normalizedTitle, term)) {
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

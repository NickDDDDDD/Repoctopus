function portable(value) {
  return value.replaceAll('\\', '/');
}

function matches(path, rule) {
  const candidate = portable(path).toLocaleLowerCase('en-US');
  const target = portable(rule.path).toLocaleLowerCase('en-US');
  return candidate === target || (rule.match === 'tree' && candidate.startsWith(`${target}/`));
}

export function evaluateLegacyWorkflowProductBoundary(input) {
  const findings = [];
  const rules = input.rules ?? [];
  const productPaths = [...new Set([...(input.headPaths ?? []), ...(input.indexPaths ?? [])])];
  for (const rule of rules) {
    if (
      !rule ||
      typeof rule.path !== 'string' ||
      !['file', 'tree'].includes(rule.match) ||
      rule.ownership !== 'external-exclusive'
    ) {
      findings.push('Invalid legacy workflow path ownership rule');
      continue;
    }
    for (const productPath of productPaths) {
      if (matches(productPath, rule)) {
        findings.push(
          `${productPath}: external Host path must not enter the Repoctopus product tree (${rule.path})`,
        );
      }
    }
  }
  return findings.sort();
}

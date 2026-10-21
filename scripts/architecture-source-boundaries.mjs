function matches(target, pattern) {
  return pattern.endsWith('/**') ? target.startsWith(pattern.slice(0, -2)) : target === pattern;
}

function occurrences(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, 'gu'))].length;
}

export function evaluateSourceBoundaries(sources, rules) {
  const findings = [];

  for (const rule of rules ?? []) {
    if (
      typeof rule.id !== 'string' ||
      typeof rule.pattern !== 'string' ||
      typeof rule.message !== 'string' ||
      !Array.isArray(rule.allowed) ||
      (rule.targets !== undefined && !Array.isArray(rule.targets))
    ) {
      findings.push('Invalid architecture source boundary rule');
      continue;
    }

    let totalMatches = 0;
    for (const source of sources) {
      if (rule.targets && !rule.targets.some((target) => matches(source.path, target))) continue;
      const count = occurrences(source.contents, rule.pattern);
      totalMatches += count;
      if (count > 0 && !rule.allowed.some((allowed) => matches(source.path, allowed))) {
        findings.push(`${source.path}: ${rule.id}: ${rule.message}`);
      }
    }

    if (rule.exactMatches !== undefined && totalMatches !== rule.exactMatches) {
      findings.push(
        `${rule.id}: expected exactly ${rule.exactMatches} source match(es), found ${totalMatches}`,
      );
    }
  }

  return findings;
}

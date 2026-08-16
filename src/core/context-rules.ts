import type { Cet4Entry, LocalContextRule, LocalContextWindow } from "./types";

/**
 * Evaluates small, declarative local rules. It intentionally has no model,
 * dictionary service, regex injection, or network dependency.
 */
export function matchesLocalContextRule(rule: LocalContextRule, context: LocalContextWindow): boolean {
  if (rule.kind === "leftSuffix") return context.left.endsWith(rule.value);
  if (rule.kind === "rightPrefix") return context.right.startsWith(rule.value);

  // Legacy hints that include the target are complete phrases. Only accept a
  // phrase occurrence that overlaps this exact target span: a plain
  // `text.includes` could otherwise let an earlier identical word pick the
  // sense for a later one. A few older hints are target-free collocation
  // clues (for example 发出 + 撞击声); retain their bounded-window behaviour
  // until they can be migrated to an explicit directional rule.
  const target = context.text.slice(context.targetStart, context.targetEnd);
  if (!rule.value.includes(target)) return context.text.includes(rule.value);
  let position = context.text.indexOf(rule.value);
  while (position >= 0) {
    const end = position + rule.value.length;
    if (position < context.targetEnd && end > context.targetStart) return true;
    position = context.text.indexOf(rule.value, position + 1);
  }
  return false;
}

/** Context hints remain readable data while the rule engine is rolled out. */
export function entryHasLocalEvidence(entry: Cet4Entry, context: LocalContextWindow): boolean {
  const rules: LocalContextRule[] = [
    ...(entry.contextRules ?? []),
    ...(entry.contextHints ?? []).map((value) => ({ kind: "contains" as const, value })),
  ];
  return rules.some((rule) => matchesLocalContextRule(rule, context));
}

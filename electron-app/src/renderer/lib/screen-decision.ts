import type { ScreenCriterionInfo } from '@/types/generated/rpc';

export type CriterionDecision = 'in' | 'out' | 'TODO';

export function canIncludeDecision(
  criteria: Record<string, ScreenCriterionInfo>,
  decisions: Record<string, CriterionDecision>,
): boolean {
  if (Object.keys(criteria).length === 0) return false;
  if (Object.values(decisions).some((value) => value === 'out')) return false;
  const inclusionNames = Object.keys(criteria).filter(
    (name) => criteria[name]?.criterion_type !== 'exclusion_criterion',
  );
  return inclusionNames.length > 0 && inclusionNames.every((name) => decisions[name] === 'in');
}

export function canExcludeDecision(
  criteria: Record<string, ScreenCriterionInfo>,
  decisions: Record<string, CriterionDecision>,
): boolean {
  if (Object.keys(criteria).length === 0) return false;
  if (Object.values(decisions).some((value) => value === 'out')) return true;
  return Object.values(decisions).every((value) => value === 'TODO');
}

export function deriveScreenDecision(
  criteria: Record<string, ScreenCriterionInfo>,
  decisions: Record<string, CriterionDecision>,
): 'include' | 'exclude' | null {
  if (canIncludeDecision(criteria, decisions)) return 'include';
  if (canExcludeDecision(criteria, decisions)) return 'exclude';
  return null;
}

export function formatCriteriaString(
  decisions: Record<string, CriterionDecision>,
): string {
  return Object.entries(decisions)
    .filter(([, value]) => value !== 'TODO')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
}

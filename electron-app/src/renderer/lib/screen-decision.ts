import type { ScreenCriterionDefinition } from '@/types/api';

export type CriterionDecision = 'in' | 'out' | 'TODO';

export function deriveScreenDecision(
  criteria: Record<string, ScreenCriterionDefinition>,
  decisions: Record<string, CriterionDecision>,
): 'include' | 'exclude' | null {
  if (Object.keys(criteria).length === 0) return null;
  if (Object.values(decisions).some((value) => value === 'out')) return 'exclude';
  const inclusionNames = Object.keys(criteria).filter(
    (name) => criteria[name]?.criterion_type !== 'exclusion_criterion',
  );
  if (inclusionNames.length > 0 && inclusionNames.every((name) => decisions[name] === 'in')) {
    return 'include';
  }
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

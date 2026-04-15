import type { ReconciliationPreviewItem } from '@/types/api';

export type ReviewerRole = 'reviewer_a' | 'reviewer_b';
export type ReconcileKind = 'prescreen' | 'screen';

const INCLUDE_STATUSES: Record<ReconcileKind, string> = {
  prescreen: 'rev_prescreen_included',
  screen: 'rev_included',
};

const EXCLUDE_STATUSES: Record<ReconcileKind, string> = {
  prescreen: 'rev_prescreen_excluded',
  screen: 'rev_excluded',
};

export function reviewerStatusMatchesDecision(
  status: string,
  decision: 'include' | 'exclude',
  kind: ReconcileKind,
): boolean {
  const target = decision === 'include' ? INCLUDE_STATUSES[kind] : EXCLUDE_STATUSES[kind];
  return status === target;
}

export function reviewerStatusToDecision(
  status: string,
  kind: ReconcileKind,
): 'include' | 'exclude' | null {
  if (status === INCLUDE_STATUSES[kind]) return 'include';
  if (status === EXCLUDE_STATUSES[kind]) return 'exclude';
  return null;
}

export function selectedReviewerFor(
  item: ReconciliationPreviewItem,
  decision: 'include' | 'exclude',
  kind: ReconcileKind,
): ReviewerRole | null {
  const match = item.reviewers.find((reviewer) =>
    reviewerStatusMatchesDecision(reviewer.status, decision, kind),
  );
  return match ? (match.role as ReviewerRole) : null;
}

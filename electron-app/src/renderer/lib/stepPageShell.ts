import { WORKFLOW_STEPS } from '../types/project';
import type { WorkflowStep } from '../types/project';

export function resolveNextStepRoute(
  step: WorkflowStep | null,
  projectId: string | null,
  nextOverride?: string,
): string | null {
  if (nextOverride) {
    const overrideStep = WORKFLOW_STEPS.find((s) => s.id === nextOverride);
    if (overrideStep) return projectId ? `/project/${projectId}/${overrideStep.route}` : null;
    return nextOverride;
  }
  if (!step || !projectId) return null;
  const idx = WORKFLOW_STEPS.findIndex((s) => s.id === step);
  if (idx === -1 || idx === WORKFLOW_STEPS.length - 1) return null;
  const next = WORKFLOW_STEPS[idx + 1];
  return `/project/${projectId}/${next.route}`;
}

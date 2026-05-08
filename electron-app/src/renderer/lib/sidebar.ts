import { WORKFLOW_STEPS } from '../types/project';

export const PIPELINE_STEPS = WORKFLOW_STEPS.filter((s) => s.id !== 'review_definition');

import { describe, it, expect } from 'vitest';
import { PIPELINE_STEPS } from './sidebar';
import { WORKFLOW_STEPS } from '../types/project';

describe('PIPELINE_STEPS', () => {
  it('does not include review_definition', () => {
    expect(PIPELINE_STEPS.some((s) => s.id === 'review_definition')).toBe(false);
  });

  it('WORKFLOW_STEPS includes review_definition', () => {
    expect(WORKFLOW_STEPS.some((s) => s.id === 'review_definition')).toBe(true);
  });

  it('contains all pipeline steps in order', () => {
    const ids = PIPELINE_STEPS.map((s) => s.id);
    expect(ids).toEqual(['search', 'preprocessing', 'prescreen', 'pdfs', 'screen', 'data']);
  });
});

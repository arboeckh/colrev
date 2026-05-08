import { describe, it, expect } from 'vitest';
import { resolveNextStepRoute } from './stepPageShell';

describe('resolveNextStepRoute', () => {
  it('returns the next pipeline step route', () => {
    expect(resolveNextStepRoute('search', 'proj-1')).toBe('/project/proj-1/preprocessing');
  });

  it('returns search after review_definition', () => {
    expect(resolveNextStepRoute('review_definition', 'proj-1')).toBe('/project/proj-1/search');
  });

  it('covers all pipeline step transitions', () => {
    const transitions: [string, string][] = [
      ['review_definition', '/project/p/search'],
      ['search', '/project/p/preprocessing'],
      ['preprocessing', '/project/p/prescreen'],
      ['prescreen', '/project/p/pdfs'],
      ['pdfs', '/project/p/screen'],
      ['screen', '/project/p/data'],
    ];
    for (const [step, expected] of transitions) {
      expect(resolveNextStepRoute(step as never, 'p')).toBe(expected);
    }
  });

  it('returns null for the last step (data)', () => {
    expect(resolveNextStepRoute('data', 'proj-1')).toBeNull();
  });

  it('returns null when step is null', () => {
    expect(resolveNextStepRoute(null, 'proj-1')).toBeNull();
  });

  it('returns null when projectId is null', () => {
    expect(resolveNextStepRoute('search', null)).toBeNull();
  });

  it('uses nextOverride when provided, ignoring step order', () => {
    expect(resolveNextStepRoute('search', 'proj-1', '/custom/path')).toBe('/custom/path');
  });

  it('uses nextOverride even for last step', () => {
    expect(resolveNextStepRoute('data', 'proj-1', '/somewhere')).toBe('/somewhere');
  });

  it('resolves a step-ID nextOverride to its full route', () => {
    expect(resolveNextStepRoute(null, 'proj-1', 'search')).toBe('/project/proj-1/search');
  });

  it('resolves step-ID nextOverride for null step without projectId', () => {
    expect(resolveNextStepRoute(null, null, 'search')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { describeGitFailure, isGitFailureCode } from './gitFailure';

describe('describeGitFailure', () => {
  it('turns a non-fast-forward push into "Pull first", not stderr', () => {
    const copy = describeGitFailure('push', 'REJECTED_FETCH_FIRST');
    expect(copy.title).toBe('Pull first');
    expect(copy.remedy).toBe('pull');
    expect(copy.detail).not.toContain('error:');
  });

  it('points auth failures at signing in again', () => {
    expect(describeGitFailure('push', 'AUTH_FAILED')).toMatchObject({
      title: 'Sign in again',
      remedy: 'signIn',
    });
  });

  it('reports offline without offering a remedy button', () => {
    const copy = describeGitFailure('fetch', 'OFFLINE');
    expect(copy.title).toBe("You're offline");
    expect(copy.remedy).toBeUndefined();
  });

  it('passes unclassified stderr through under a per-operation title', () => {
    expect(describeGitFailure('pull', 'fatal: something odd')).toEqual({
      title: 'Pull failed',
      detail: 'fatal: something odd',
    });
    expect(describeGitFailure('push', undefined).detail).toBe('Unknown error');
  });
});

describe('isGitFailureCode', () => {
  it('separates codes from stderr', () => {
    expect(isGitFailureCode('OFFLINE')).toBe(true);
    expect(isGitFailureCode('fatal: unable to access')).toBe(false);
    expect(isGitFailureCode(undefined)).toBe(false);
  });
});

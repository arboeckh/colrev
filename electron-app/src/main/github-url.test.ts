import { describe, it, expect } from 'vitest';
import { parseFakeRemote, parseOwnerRepo } from './github-url';

describe('parseOwnerRepo', () => {
  it('parses HTTPS and SSH github.com remotes', () => {
    expect(parseOwnerRepo('https://github.com/alice/review.git')).toEqual({
      owner: 'alice',
      repo: 'review',
    });
    expect(parseOwnerRepo('git@github.com:alice/review.git')).toEqual({
      owner: 'alice',
      repo: 'review',
    });
  });

  it('rejects local paths', () => {
    expect(parseOwnerRepo('/tmp/bare-remote/alice/review.git')).toBeNull();
  });
});

describe('parseFakeRemote', () => {
  it('parses POSIX bare-remote paths', () => {
    expect(parseFakeRemote('/tmp/colrev-e2e/t/bare-remote/alice/review.git')).toEqual({
      owner: 'alice',
      repo: 'review',
    });
  });

  it('parses Windows bare-remote paths with either separator', () => {
    const expected = { owner: 'alice', repo: 'review' };
    expect(parseFakeRemote('D:\\tmp\\colrev-e2e\\t\\bare-remote\\alice\\review.git')).toEqual(
      expected,
    );
    expect(parseFakeRemote('D:/tmp/colrev-e2e/t/bare-remote/alice/review.git')).toEqual(expected);
  });

  it('rejects relative paths', () => {
    expect(parseFakeRemote('bare-remote/alice/review.git')).toBeNull();
  });
});

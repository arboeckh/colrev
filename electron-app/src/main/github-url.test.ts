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

  it('keeps the dots in a repo name', () => {
    expect(parseOwnerRepo('https://github.com/o/my.review.git')).toEqual({
      owner: 'o',
      repo: 'my.review',
    });
    expect(parseOwnerRepo('https://github.com/o/lit-review-v1.2.git')).toEqual({
      owner: 'o',
      repo: 'lit-review-v1.2',
    });
    expect(parseOwnerRepo('https://github.com/o/lit-review-v1.2')).toEqual({
      owner: 'o',
      repo: 'lit-review-v1.2',
    });
    expect(parseOwnerRepo('git@github.com:o/my.review.git')).toEqual({
      owner: 'o',
      repo: 'my.review',
    });
  });

  it('accepts a trailing slash and a URL without .git', () => {
    expect(parseOwnerRepo('https://github.com/o/review/')).toEqual({ owner: 'o', repo: 'review' });
    expect(parseOwnerRepo('https://github.com/o/review.git/')).toEqual({
      owner: 'o',
      repo: 'review',
    });
    expect(parseOwnerRepo('https://github.com/o/review')).toEqual({ owner: 'o', repo: 'review' });
  });

  it('rejects dot-only and empty repo segments', () => {
    expect(parseOwnerRepo('https://github.com/o/..')).toBeNull();
    expect(parseOwnerRepo('https://github.com/o/')).toBeNull();
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

  it('keeps dots in bare-remote repo names', () => {
    expect(parseFakeRemote('/tmp/bare-remote/alice/my.review.git')).toEqual({
      owner: 'alice',
      repo: 'my.review',
    });
  });

  it('rejects relative paths', () => {
    expect(parseFakeRemote('bare-remote/alice/review.git')).toBeNull();
  });
});

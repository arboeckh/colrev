/**
 * Tagging for a release, against real git (dugite) in temp repositories:
 * a retry after a partial failure must reuse the tag, and only the release's
 * own tag is pushed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { gitCreateTag, gitPushTag } from './git-manager';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();

describe('release tags', () => {
  let root: string;
  let project: string;
  let remote: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tags-'));
    remote = path.join(root, 'remote.git');
    project = path.join(root, 'project');
    fs.mkdirSync(remote);
    fs.mkdirSync(project);
    git(remote, 'init', '--bare');
    git(project, 'init', '-b', 'main');
    fs.writeFileSync(path.join(project, 'a.txt'), '1');
    git(project, 'add', '.');
    git(project, 'commit', '-m', 'one');
    git(project, 'remote', 'add', 'origin', remote);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const remoteTags = () => git(remote, 'tag', '--list').split('\n').filter(Boolean);

  it('creates an annotated tag', async () => {
    expect(await gitCreateTag(project, 'v1.0', 'Release 1')).toEqual({ success: true });
    expect(git(project, 'cat-file', '-t', 'v1.0')).toBe('tag');
  });

  it('reuses a tag that already points at the current commit', async () => {
    await gitCreateTag(project, 'v1.0', 'Release 1');
    const before = git(project, 'rev-parse', 'v1.0');

    expect(await gitCreateTag(project, 'v1.0', 'Release 1')).toEqual({ success: true });
    expect(git(project, 'rev-parse', 'v1.0')).toBe(before);
  });

  it('refuses a tag that points at a different commit, and does not move it', async () => {
    await gitCreateTag(project, 'v1.0', 'Release 1');
    const before = git(project, 'rev-parse', 'v1.0');
    fs.writeFileSync(path.join(project, 'a.txt'), '2');
    git(project, 'commit', '-am', 'two');

    const result = await gitCreateTag(project, 'v1.0', 'Release 1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('different commit');
    expect(git(project, 'rev-parse', 'v1.0')).toBe(before);
  });

  it.each(['-d', '--force', 'has space', 'a..b', ''])('rejects the tag name %j', async (name) => {
    expect((await gitCreateTag(project, name, 'm')).success).toBe(false);
    expect((await gitPushTag(project, name, null)).success).toBe(false);
  });

  it('pushes only the release tag, not every local tag', async () => {
    git(project, 'tag', 'unrelated-local-tag');
    await gitCreateTag(project, 'v1.0', 'Release 1');

    expect(await gitPushTag(project, 'v1.0', null)).toEqual({ success: true });

    expect(remoteTags()).toEqual(['v1.0']);
  });

  it('can push a tag the remote already has (retry after the release call failed)', async () => {
    await gitCreateTag(project, 'v1.0', 'Release 1');
    await gitPushTag(project, 'v1.0', null);

    expect(await gitCreateTag(project, 'v1.0', 'Release 1')).toEqual({ success: true });
    expect(await gitPushTag(project, 'v1.0', null)).toEqual({ success: true });
    expect(remoteTags()).toEqual(['v1.0']);
  });
});

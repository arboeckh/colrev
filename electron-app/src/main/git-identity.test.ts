import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  gitConfigHome,
  gitIdentityFor,
  renderGitConfig,
  writeGitIdentity,
} from './git-identity';

describe('gitIdentityFor', () => {
  it('uses the profile name and public email', () => {
    expect(
      gitIdentityFor({ login: 'alice', name: 'Alice Smith', email: 'alice@uni.edu', id: 42 }),
    ).toEqual({ name: 'Alice Smith', email: 'alice@uni.edu' });
  });

  it("falls back to the login and GitHub's id+login noreply address", () => {
    expect(gitIdentityFor({ login: 'alice', name: null, email: null, id: 42 })).toEqual({
      name: 'alice',
      email: '42+alice@users.noreply.github.com',
    });
  });

  it('uses the login-only noreply address when the id is unknown', () => {
    expect(gitIdentityFor({ login: 'alice', name: '', email: '' }).email).toBe(
      'alice@users.noreply.github.com',
    );
  });

  it('drops characters an unquoted git config value cannot hold', () => {
    expect(
      gitIdentityFor({ login: 'a', name: '  Jo "J" \\ Doe ; x # y\nz ', email: null }).name,
    ).toBe('Jo J Doe x y z');
  });
});

describe('renderGitConfig', () => {
  it('writes a [user] section', () => {
    const text = renderGitConfig({ name: 'Alice Smith', email: 'alice@uni.edu' });
    expect(text).toContain('[user]\n\tname = Alice Smith\n\temail = alice@uni.edu\n');
  });
});

describe('writeGitIdentity', () => {
  let dir: string;
  const file = () => path.join(gitConfigHome(dir), 'git', 'config');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-identity-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes $XDG_CONFIG_HOME/git/config under userData and removes it on sign-out', () => {
    writeGitIdentity(dir, { login: 'alice', name: 'Alice', email: null, id: 7 });
    expect(fs.readFileSync(file(), 'utf-8')).toContain('email = 7+alice@users.noreply.github.com');

    writeGitIdentity(dir, { login: 'bob', name: 'Bob', email: 'bob@x.org' });
    expect(fs.readFileSync(file(), 'utf-8')).toContain('name = Bob');

    writeGitIdentity(dir, null);
    expect(fs.existsSync(file())).toBe(false);
  });
});

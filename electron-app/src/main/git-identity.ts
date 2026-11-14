import * as fs from 'fs';
import * as path from 'path';

/**
 * The git identity (user.name / user.email) the app's commits are made with.
 *
 * colrev refuses to create a review without a global git identity
 * (EnvironmentManager.get_name_mail_from_git, via GitPython), and git needs
 * one to commit. Users of the desktop app usually have neither git nor a
 * ~/.gitconfig, so the app provides the identity of the signed-in GitHub
 * account itself.
 *
 * It does so without touching the user's files: it writes an app-owned
 * config at <userData>/git-config-home/git/config and points XDG_CONFIG_HOME
 * there for the backend and for dugite (see setupGitEnvironment). Both git and
 * GitPython read $XDG_CONFIG_HOME/git/config *before* ~/.gitconfig, so a
 * developer's own ~/.gitconfig identity still wins.
 */

export interface GitIdentitySource {
  login: string;
  name: string | null;
  email: string | null;
  /** GitHub's numeric user id; needed for the noreply address. */
  id?: number;
}

export interface GitIdentity {
  name: string;
  email: string;
}

/** Directory to use as XDG_CONFIG_HOME for every git and backend process. */
export function gitConfigHome(userDataDir: string): string {
  return path.join(userDataDir, 'git-config-home');
}

function gitConfigFile(userDataDir: string): string {
  return path.join(gitConfigHome(userDataDir), 'git', 'config');
}

/**
 * Name: the profile name, else the login. Email: the public profile email,
 * else GitHub's noreply address, which GitHub attributes to the account
 * (the `<id>+<login>` form; plain `<login>@` only for accounts without a
 * known id).
 */
export function gitIdentityFor(user: GitIdentitySource): GitIdentity {
  const name = clean(user.name ?? '') || user.login;
  const publicEmail = clean(user.email ?? '');
  const noreply =
    user.id !== undefined
      ? `${user.id}+${user.login}@users.noreply.github.com`
      : `${user.login}@users.noreply.github.com`;
  return { name, email: publicEmail || noreply };
}

/**
 * Values are written unquoted: GitPython keeps quotes as part of the value.
 * So drop what an unquoted git config value can't hold (quotes, backslashes,
 * comment starters, line breaks) instead of escaping it.
 */
function clean(value: string): string {
  return value.replace(/["\\;#\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderGitConfig(identity: GitIdentity): string {
  return [
    '# Written by the ColRev app from the signed-in GitHub account.',
    '# Changes are overwritten; set user.name/user.email in ~/.gitconfig instead.',
    '[user]',
    `\tname = ${identity.name}`,
    `\temail = ${identity.email}`,
    // Project files are committed with LF on every platform, so a Windows
    // collaborator's commits are byte-identical to a Mac one's: git must not
    // convert line endings (the backend writes LF itself), and long project
    // paths must not fail on Windows.
    '[core]',
    '\tautocrlf = false',
    '\tlongpaths = true',
    '',
  ].join('\n');
}

/**
 * Write the identity for `user`, or remove it when signed out. Never throws:
 * a failure here must not break sign-in; colrev then reports the missing
 * identity itself.
 */
export function writeGitIdentity(userDataDir: string, user: GitIdentitySource | null): void {
  const file = gitConfigFile(userDataDir);
  try {
    if (!user) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderGitConfig(gitIdentityFor(user)), 'utf-8');
  } catch (err) {
    console.error('[git-identity] could not write', file, err);
  }
}

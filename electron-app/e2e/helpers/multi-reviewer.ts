import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { Page } from '@playwright/test';
import { TestWorkspace } from '../lib/test-workspace';
import { ALICE, BOB, DEFAULT_PROJECT_ID } from '../lib/seeders';
import { clickWhenEnabled } from './test-utils';

/**
 * Ensure both alice and bob have a local `dev` branch tracking origin/dev.
 * Idempotent — safe to call when alice is already on dev.
 */
export function createDevBranches(workspace: TestWorkspace): void {
  const aliceProject = path.join(
    workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
  );
  const bobProject = path.join(
    workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
  );

  const branchExists = (cwd: string, name: string): boolean => {
    try {
      execFileSync('git', ['rev-parse', '--verify', name], {
        cwd, stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!branchExists(aliceProject, 'dev')) {
    execFileSync('git', ['checkout', '-b', 'dev'], {
      cwd: aliceProject, stdio: 'pipe',
    });
  } else {
    execFileSync('git', ['checkout', 'dev'], {
      cwd: aliceProject, stdio: 'pipe',
    });
  }
  execFileSync('git', ['push', '-u', 'origin', 'dev'], {
    cwd: aliceProject, stdio: 'pipe',
  });

  execFileSync('git', ['fetch', 'origin'], {
    cwd: bobProject, stdio: 'pipe',
  });
  if (!branchExists(bobProject, 'dev')) {
    execFileSync('git', ['checkout', '-b', 'dev', '--track', 'origin/dev'], {
      cwd: bobProject, stdio: 'pipe',
    });
  } else {
    execFileSync('git', ['checkout', 'dev'], {
      cwd: bobProject, stdio: 'pipe',
    });
    execFileSync('git', ['merge', 'origin/dev', '--ff-only'], {
      cwd: bobProject, stdio: 'pipe',
    });
  }
}

/**
 * Fast-forward dev on the bare remote to alice's reviewer-branch tip and
 * ff-merge it into both reviewers' local dev branches. Stand-in for the
 * not-yet-implemented reconcile-to-dev UI flow.
 *
 * `kind` disambiguates between prescreen and screen reviewer branches when
 * both exist on the same clone. Defaults to picking the most-recently-touched
 * matching branch.
 */
export function reconcileReviewerToDev(
  workspace: TestWorkspace,
  kind?: 'prescreen' | 'screen',
): void {
  const aliceProject = path.join(
    workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
  );
  // Order by committer-date so the latest reviewer branch wins when neither
  // an explicit kind nor a unique match would resolve it.
  const branches = execFileSync(
    'git',
    [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/heads/',
    ],
    { cwd: aliceProject, encoding: 'utf-8' },
  ).trim().split('\n');
  const prefix = kind ? `review/${kind}/` : 'review/';
  const aliceReviewer = branches.find(
    (b) => b.startsWith(prefix) && b.endsWith(`/${ALICE.login}`),
  );
  if (!aliceReviewer) {
    throw new Error(
      `Could not find alice's ${kind ?? ''} reviewer branch in ${aliceProject}`,
    );
  }

  execFileSync('git', ['checkout', 'dev'], { cwd: aliceProject, stdio: 'pipe' });
  execFileSync('git', ['merge', '--ff-only', aliceReviewer], {
    cwd: aliceProject, stdio: 'pipe',
  });
  execFileSync('git', ['push', 'origin', 'dev'], {
    cwd: aliceProject, stdio: 'pipe',
  });

  const bobProject = path.join(
    workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
  );
  if (fs.existsSync(path.join(bobProject, '.git'))) {
    execFileSync('git', ['fetch', 'origin'], { cwd: bobProject, stdio: 'pipe' });
    execFileSync('git', ['checkout', 'dev'], { cwd: bobProject, stdio: 'pipe' });
    execFileSync('git', ['merge', '--ff-only', 'origin/dev'], {
      cwd: bobProject, stdio: 'pipe',
    });
  }
}

/**
 * Flip every record currently at one of `fromStatuses` to `toStatus` in
 * alice's records.bib, then commit + push and ff-merge into bob's dev.
 *
 * Workaround for environments without Docker: pdf_prep needs grobid (Docker)
 * and pdf_prep_man needs interactive CLI, neither of which fit the test
 * harness. Slice 8 only exercises the screen UI, so simulating the upstream
 * pdf_prep transition here keeps the screen flow drivable end-to-end.
 */
export function simulateBibTransition(
  workspace: TestWorkspace,
  fromStatuses: string[],
  toStatus: string,
): number {
  const aliceProject = path.join(
    workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
  );
  const bibPath = path.join(aliceProject, 'data', 'records.bib');
  const original = fs.readFileSync(bibPath, 'utf-8');
  let changed = 0;
  let updated = original;
  for (const from of fromStatuses) {
    const re = new RegExp(
      `(colrev_status\\s*=\\s*\\{)${from}(\\})`, 'g',
    );
    updated = updated.replace(re, (_match, p1, p2) => {
      changed++;
      return `${p1}${toStatus}${p2}`;
    });
  }
  if (changed === 0) return 0;
  fs.writeFileSync(bibPath, updated);
  execFileSync('git', ['add', 'data/records.bib'], {
    cwd: aliceProject, stdio: 'pipe',
  });
  execFileSync(
    'git', ['commit', '-m', `test: simulate ${fromStatuses.join('+')} -> ${toStatus}`],
    { cwd: aliceProject, stdio: 'pipe' },
  );
  syncDevAcrossClones(workspace);
  return changed;
}

/**
 * Push alice's local dev to origin and ff-merge into bob's dev. Use after a
 * stage that committed to dev directly (e.g. pdf_get_man) but never pushed.
 */
export function syncDevAcrossClones(workspace: TestWorkspace): void {
  const aliceProject = path.join(
    workspace.userDataDir, 'projects', ALICE.login, DEFAULT_PROJECT_ID,
  );
  const bobProject = path.join(
    workspace.userDataDir, 'projects', BOB.login, DEFAULT_PROJECT_ID,
  );
  execFileSync('git', ['checkout', 'dev'], { cwd: aliceProject, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', 'dev'], {
    cwd: aliceProject, stdio: 'pipe',
  });
  if (fs.existsSync(path.join(bobProject, '.git'))) {
    execFileSync('git', ['fetch', 'origin'], { cwd: bobProject, stdio: 'pipe' });
    execFileSync('git', ['checkout', 'dev'], { cwd: bobProject, stdio: 'pipe' });
    execFileSync('git', ['merge', '--ff-only', 'origin/dev'], {
      cwd: bobProject, stdio: 'pipe',
    });
  }
}

export type Decision = 'include' | 'exclude';

export interface DecideAllRecordsOptions {
  /** Selector that resolves while a record card is visible. */
  cardTestid: string;
  /** Selector that resolves once the queue is empty. */
  completeTestid: string;
  /** Selector for the element whose text changes when the queue advances. */
  recordIdTestid: string;
  /**
   * Apply one decision. Implementations should leave the page in a state where
   * either the next card has loaded (record-id changed) or the completion
   * sentinel is visible.
   */
  decide: (window: Page, decision: Decision) => Promise<void>;
  /** Cycled through; each call uses pattern[i % pattern.length]. */
  pattern: Decision[];
  /** Per-decision wait timeout for the post-click record-change/complete check. */
  perDecisionTimeout?: number;
}

/**
 * Walk a managed-review queue and apply a decision to every record. Polymorphic
 * across prescreen (separate include/exclude buttons) and screen (criteria
 * checks + derived submit). Returns the include/exclude tally.
 */
export async function decideAllRecords(
  window: Page,
  opts: DecideAllRecordsOptions,
): Promise<{ included: number; excluded: number }> {
  const {
    cardTestid,
    completeTestid,
    recordIdTestid,
    decide,
    pattern,
    perDecisionTimeout = 30_000,
  } = opts;
  let included = 0;
  let excluded = 0;
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await window.waitForSelector(
      `[data-testid="${cardTestid}"], [data-testid="${completeTestid}"]`,
      { timeout: perDecisionTimeout },
    );
    if (
      await window
        .locator(`[data-testid="${completeTestid}"]`)
        .first()
        .isVisible()
    ) {
      break;
    }
    const prevId = (
      await window.textContent(`[data-testid="${recordIdTestid}"]`)
    )?.trim() ?? '';

    const decision = pattern[i % pattern.length];
    await decide(window, decision);
    if (decision === 'include') included++;
    else excluded++;
    i++;

    await window.waitForFunction(
      ({ prev, completeId, idId }) => {
        const complete = document.querySelector(`[data-testid="${completeId}"]`);
        if (complete) return true;
        const idEl = document.querySelector(`[data-testid="${idId}"]`);
        if (!idEl) return false;
        const txt = (idEl.textContent ?? '').trim();
        return txt.length > 0 && txt !== prev;
      },
      { prev: prevId, completeId: completeTestid, idId: recordIdTestid },
      { timeout: perDecisionTimeout },
    );
  }
  return { included, excluded };
}

/** Prescreen: dedicated include/exclude buttons. */
export function prescreenDecide(
  buttonTimeout = 60_000,
): DecideAllRecordsOptions['decide'] {
  return async (window, decision) => {
    const btn = decision === 'include'
      ? '[data-testid="prescreen-btn-include"]'
      : '[data-testid="prescreen-btn-exclude"]';
    await clickWhenEnabled(window, btn, buttonTimeout);
  };
}

/**
 * Screen: toggle a criterion check that produces the desired derived
 * decision, then click the unified submit button. Pass the criterion names
 * defined for this project. The first inclusion criterion is toggled to "in"
 * for include; the first exclusion criterion is toggled to "out" for
 * exclude. Caller guarantees both kinds exist.
 */
export interface ScreenDecideCriteria {
  inclusionName: string;
  exclusionName: string;
}

export function screenDecide(
  criteria: ScreenDecideCriteria,
  buttonTimeout = 60_000,
): DecideAllRecordsOptions['decide'] {
  return async (window, decision) => {
    const target = decision === 'include' ? criteria.inclusionName : criteria.exclusionName;
    // Wait until the criteria checklist for this record is visible.
    await window.waitForSelector(
      `[data-testid="criterion-check-${target}"]`,
      { timeout: buttonTimeout },
    );
    await window.click(`[data-testid="criterion-check-${target}"]`);
    await clickWhenEnabled(
      window, '[data-testid="screen-btn-submit-criteria"]', buttonTimeout,
    );
  };
}

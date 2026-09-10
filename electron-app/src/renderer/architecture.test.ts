/**
 * Architecture invariants, enforced by the build.
 *
 * These are the rules that a reviewer would otherwise have to remember on
 * every PR. Each one encodes a bug class we have actually hit, and each
 * failure message says exactly what to do instead — the point is that a
 * future change either satisfies the invariant or fails CI, never that
 * someone notices.
 *
 * Add a rule here whenever "you must also remember to X" appears in a review.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const RENDERER_ROOT = path.resolve(__dirname);

function sourceFiles(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'test') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue;
      out.push({
        rel: path.relative(RENDERER_ROOT, full).replace(/\\/g, '/'),
        text: fs.readFileSync(full, 'utf8'),
      });
    }
  };
  walk(RENDERER_ROOT);
  return out;
}

const FILES = sourceFiles();

// ---------------------------------------------------------------------------
// 1. The sync coordinator is the only path to the remote
// ---------------------------------------------------------------------------

describe('sync ownership', () => {
  /**
   * `git.__remoteOps` bypasses the coordinator's suspension, debounce,
   * offline handling and conflict escalation. Exactly two files may touch it:
   * the store that defines it and the coordinator that owns the policy.
   */
  const REMOTE_OPS_OWNERS = ['stores/git.ts', 'stores/sync.ts'];

  it('only the sync coordinator reaches the git store’s remote primitives', () => {
    const offenders = FILES.filter(
      (f) =>
        f.text.includes('__remoteOps') &&
        // Tests legitimately stub the primitives; they never ship.
        !f.rel.endsWith('.test.ts') &&
        !REMOTE_OPS_OWNERS.includes(f.rel),
    ).map((f) => f.rel);

    expect(
      offenders,
      'These files call the raw git remote primitives, bypassing the sync ' +
        'coordinator (suspension while a walkthrough is open, the push ' +
        'debounce, offline handling, escalation of a diverged repo). ' +
        'Use useSyncStore().pullNow() / .pushNow() / .fetchNow() / .syncNow() ' +
        'instead. If you genuinely need a new primitive, add it to ' +
        'stores/sync.ts and call that.',
    ).toEqual([]);
  });

  /**
   * Project creation is the one legitimate exception: it pushes a repo that is
   * not the current project, before any project — and therefore any
   * coordinator — exists.
   */
  const DIRECT_IPC_EXEMPT = ['views/LandingPage.vue'];

  it('only the git store talks to the git IPC bridge directly', () => {
    const offenders = FILES.filter(
      (f) =>
        f.rel !== 'stores/git.ts' &&
        !f.rel.endsWith('.test.ts') &&
        !DIRECT_IPC_EXEMPT.includes(f.rel) &&
        /window\.git\.(pull|push|fetch|fastForwardMain)\b/.test(f.text),
    ).map((f) => f.rel);

    expect(
      offenders,
      'Remote git IPC belongs behind the git store, which is itself driven ' +
        'by the sync coordinator. Route this through useSyncStore().',
    ).toEqual([]);
  });

  it('the background sync loop is started from exactly one place', () => {
    const starters = FILES.filter(
      (f) => !f.rel.endsWith('.test.ts') && f.rel !== 'stores/sync.ts' && /\bsync\.start\(\)/.test(f.text),
    ).map((f) => f.rel);

    expect(
      starters,
      'sync.start() must be called only from AppLayout, which owns the ' +
        'project lifecycle. A second caller creates a competing timer that ' +
        'double-fetches and races the first.',
    ).toEqual(['components/layout/AppLayout.vue']);
  });

  it('every started loop is stopped in the same file', () => {
    const appLayout = FILES.find((f) => f.rel === 'components/layout/AppLayout.vue');
    expect(appLayout, 'AppLayout.vue not found').toBeDefined();
    expect(
      appLayout!.text.includes('sync.stop()'),
      'AppLayout starts the sync loop but never stops it — the timer would ' +
        'outlive the project and keep syncing a repo the user has left.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Pages stay fresh across a working-tree replacement
// ---------------------------------------------------------------------------

describe('invalidation seam coverage', () => {
  /**
   * Auto-pull replaces the working tree underneath whatever is on screen. A
   * page that loads project data but never subscribes to the invalidation
   * seam keeps rendering (and, worse, keeps *diffing against*) pre-pull
   * values — the exact bug that made the review-definition page report
   * phantom unsaved changes and hide the pulled protocol URL.
   *
   * Every view that reads project data must therefore handle the seam.
   * Exemptions are explicit and must say why.
   */
  const SEAM_EXEMPT: Record<string, string> = {
    'views/LandingPage.vue':
      'Review list — not scoped to one project’s working tree.',
    'views/SettingsPage.vue':
      'App-level settings (base path, backend); reads the projects store only ' +
      'to name the current review, not to render working-tree data.',
    'views/ProjectOverview.vue':
      'Renders store-derived state only (projects + git snapshot); the seam ' +
      'refreshes those stores itself, so there is nothing page-local to reload.',
  };

  /** Signals that a view renders data read out of the project working tree. */
  const READS_PROJECT_DATA =
    /\b(backend\.call\(|useProjectsStore\(|useReviewDefinitionStore\(|useManagedReviewStore\(|useRecordsStore\()/;

  it('every view that reads project data reloads on a full invalidation', () => {
    const offenders = FILES.filter((f) => f.rel.startsWith('views/') && f.rel.endsWith('.vue'))
      .filter((f) => READS_PROJECT_DATA.test(f.text))
      .filter((f) => !f.text.includes('useProjectDataChanged'))
      .filter((f) => !(f.rel in SEAM_EXEMPT))
      .map((f) => f.rel);

    expect(
      offenders,
      'These views read project data but do not subscribe to the ' +
        'invalidation seam. After an auto-pull, reset or merge they will ' +
        'render pre-pull state. Add useProjectDataChanged((event) => { ... }) ' +
        'and reload on event.full — or, if the view genuinely does not depend ' +
        'on the working tree, add it to SEAM_EXEMPT with a reason.',
    ).toEqual([]);
  });

  it('seam exemptions all refer to files that exist', () => {
    const known = new Set(FILES.map((f) => f.rel));
    const stale = Object.keys(SEAM_EXEMPT).filter((rel) => !known.has(rel));
    expect(
      stale,
      'SEAM_EXEMPT lists files that no longer exist. Remove them so the ' +
        'exemption list cannot quietly grow stale and hide a real gap.',
    ).toEqual([]);
  });
});

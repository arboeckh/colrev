/**
 * Shared serial queue for ALL git operations — both frontend (dugite/IPC) and
 * backend (JSON-RPC → GitPython).  Guarantees mutual exclusion so two callers
 * never hold .git/index.lock at the same time.
 *
 * Re-entrant: if code inside a queued operation calls enqueueGitOp again
 * (e.g. switchBranch → refreshStatus → backend.call('get_git_status')),
 * the inner call runs immediately rather than deadlocking on the queue.
 */

let gitQueue: Promise<unknown> = Promise.resolve();
let depth = 0;

export function enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
  // Already inside a queued operation — run directly to avoid deadlock.
  // Safe because we're already in the queue's exclusive slot.
  if (depth > 0) {
    return fn();
  }

  const wrapped = async () => {
    depth++;
    try {
      return await fn();
    } finally {
      depth--;
    }
  };

  const op = gitQueue.then(wrapped, wrapped); // run even if previous op rejected
  gitQueue = op.then(
    () => {},
    () => {},
  ); // swallow to keep chain alive
  return op;
}

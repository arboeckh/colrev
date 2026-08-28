/**
 * Structured RPC errors in the renderer.
 *
 * The main process returns RPC failures as a serialized envelope (Electron
 * strips custom Error properties at the IPC boundary); the backend store
 * rethrows them as `RpcError` so call sites can branch on `error.code`
 * instead of regex-matching message strings.
 *
 * Code values mirror two sources:
 *  - Python server codes: colrev/ui_jsonrpc/error_handler.py
 *  - Bridge transport codes: electron-app/src/main/colrev-backend.ts
 * Keep all three in sync when adding codes.
 */

export const RPC_ERROR_CODES = {
  // JSON-RPC 2.0 standard
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // CoLRev domain codes (Python server)
  REPO_SETUP_ERROR: -32000,
  OPERATION_ERROR: -32001,
  SERVICE_NOT_AVAILABLE: -32002,
  MISSING_DEPENDENCY: -32003,
  PARAMETER_ERROR: -32004,
  /** Repo not in the required state (uncommitted changes, unresolved merge). */
  PRECONDITION_FAILED: -32005,
  /** A lock (e.g. .git/index.lock) is held by another process. */
  RESOURCE_LOCKED: -32006,
  /** Referenced project/record/source does not exist. */
  NOT_FOUND: -32007,
  // Transport codes (Electron bridge — the server never answered)
  TRANSPORT_CRASHED: -33000,
  TRANSPORT_TIMEOUT: -33001,
  TRANSPORT_STOPPED: -33002,
  TRANSPORT_NOT_RUNNING: -33003,
  TRANSPORT_UNKNOWN: -33099,
} as const;

export interface SerializedRpcError {
  code: number;
  message: string;
  method: string;
  data?: unknown;
}

export type RpcCallEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: SerializedRpcError };

export class RpcError extends Error {
  public readonly code: number;
  public readonly method: string;
  public readonly data?: unknown;

  constructor(serialized: SerializedRpcError) {
    super(serialized.message);
    this.name = 'RpcError';
    this.code = serialized.code;
    this.method = serialized.method;
    this.data = serialized.data;
  }
}

export function isRpcError(err: unknown): err is RpcError {
  return err instanceof RpcError;
}

export function isPreconditionFailed(err: unknown): boolean {
  return isRpcError(err) && err.code === RPC_ERROR_CODES.PRECONDITION_FAILED;
}

export function isBackendCrash(err: unknown): boolean {
  return isRpcError(err) && err.code === RPC_ERROR_CODES.TRANSPORT_CRASHED;
}

/**
 * Message suitable for direct display. Maps well-known codes to actionable
 * phrasing; falls back to the server's message.
 */
export function rpcErrorUserMessage(err: unknown): string {
  if (!isRpcError(err)) {
    return err instanceof Error ? err.message : String(err);
  }
  switch (err.code) {
    case RPC_ERROR_CODES.PRECONDITION_FAILED:
      return 'The project has uncommitted changes — commit or discard them first.';
    case RPC_ERROR_CODES.RESOURCE_LOCKED:
      return 'The repository is locked by another process. Try again in a moment.';
    case RPC_ERROR_CODES.TRANSPORT_CRASHED:
      return 'The backend process crashed while handling this request.';
    case RPC_ERROR_CODES.TRANSPORT_TIMEOUT:
      return `The backend did not answer in time (${err.method}). It may still be working.`;
    default:
      return err.message;
  }
}

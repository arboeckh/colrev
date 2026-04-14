/**
 * Generate TypeScript types from the backend's JSON-RPC schema dump.
 *
 * Input:  src/renderer/types/generated/rpc-schemas.json (emitted by
 *         scripts/export_rpc_schemas.py on the Python side).
 * Output: src/renderer/types/generated/rpc.d.ts
 *
 * The output exports:
 *   - One interface per request and response model.
 *   - An `RPCMethods` discriminated-union-style map used to type
 *     `window.colrev.call<M>(method, params)`.
 *
 * Re-run via `npm run gen-types`. CI compares the file against the committed
 * version and fails if stale.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_PATH = resolve(
  __dirname,
  "../src/renderer/types/generated/rpc-schemas.json",
);
const OUTPUT_PATH = resolve(
  __dirname,
  "../src/renderer/types/generated/rpc.d.ts",
);

type MethodSchema = {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  requires_project: boolean;
  writes: boolean;
};

type SchemaDoc = {
  methods: Record<string, MethodSchema>;
  shared?: Record<string, Record<string, unknown>>;
};

function pascalCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function ensureTitle(
  schema: Record<string, unknown>,
  fallback: string,
): Record<string, unknown> {
  const next = { ...schema };
  if (!next.title || typeof next.title !== "string") {
    next.title = fallback;
  }
  return next;
}

async function main() {
  const raw = readFileSync(SCHEMA_PATH, "utf-8");
  const doc = JSON.parse(raw) as SchemaDoc;

  const methodNames = Object.keys(doc.methods).sort();
  const sharedNames = Object.keys(doc.shared ?? {}).sort();

  const parts: string[] = [];
  parts.push(
    `/* eslint-disable */`,
    `/**`,
    ` * GENERATED FILE — do not edit by hand.`,
    ` * Regenerate via \`npm run gen-types\` after backend handler changes.`,
    ` * Source: src/renderer/types/generated/rpc-schemas.json`,
    ` */`,
    ``,
  );

  // Shared domain types (ProgressEvent, RecordPayload, RecordStateName, etc.)
  for (const name of sharedNames) {
    const schema = ensureTitle(doc.shared![name], name);
    const ts = await compile(schema as any, name, {
      bannerComment: "",
      additionalProperties: true, // RecordPayload has extra='allow'
      declareExternallyReferenced: true,
      unreachableDefinitions: false,
    });
    parts.push(`// shared: ${name}`, ts.trim(), "");
  }

  for (const method of methodNames) {
    const spec = doc.methods[method];
    const reqName = `${pascalCase(method)}Request`;
    const resName = `${pascalCase(method)}Response`;

    const reqSchema = ensureTitle(spec.request, reqName);
    const resSchema = ensureTitle(spec.response, resName);

    const reqTs = await compile(reqSchema as any, reqName, {
      bannerComment: "",
      additionalProperties: false,
      declareExternallyReferenced: true,
      unreachableDefinitions: false,
    });
    const resTs = await compile(resSchema as any, resName, {
      bannerComment: "",
      additionalProperties: false,
      declareExternallyReferenced: true,
      unreachableDefinitions: false,
    });

    parts.push(`// ${method}`, reqTs.trim(), "", resTs.trim(), "");
  }

  // Build the RPCMethods map.
  parts.push(`/** Discriminated map: method name → request/response types. */`);
  parts.push(`export interface RPCMethods {`);
  for (const method of methodNames) {
    const reqName = `${pascalCase(method)}Request`;
    const resName = `${pascalCase(method)}Response`;
    parts.push(`  ${JSON.stringify(method)}: {`);
    parts.push(`    params: ${reqName};`);
    parts.push(`    result: ${resName};`);
    parts.push(`  };`);
  }
  parts.push(`}`);
  parts.push(``);
  parts.push(`export type RPCMethodName = keyof RPCMethods;`);
  parts.push(
    `export type RPCParams<M extends RPCMethodName> = RPCMethods[M]["params"];`,
  );
  parts.push(
    `export type RPCResult<M extends RPCMethodName> = RPCMethods[M]["result"];`,
  );

  const output = parts.join("\n") + "\n";
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${methodNames.length} method types to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

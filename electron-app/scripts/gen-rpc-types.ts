/**
 * Generate TypeScript types from the backend's JSON-RPC schema dump.
 *
 * Input:  src/renderer/types/generated/rpc-schemas.json (emitted by
 *         scripts/export_rpc_schemas.py on the Python side).
 * Output: src/renderer/types/generated/rpc.d.ts
 *
 * The output exports:
 *   - One interface per request and response model, named
 *     `<PascalCase(method)>Request` / `<PascalCase(method)>Response` —
 *     forced, so the names in the `RPCMethods` map always resolve.
 *   - Named interfaces for nested Pydantic models ($defs), emitted once
 *     each; identical re-declarations across methods are deduplicated and
 *     conflicting same-name declarations fail the build.
 *   - An `RPCMethods` map used to type `backend.call(method, params)`.
 *
 * Re-run via `npm run gen-types` (or `gen-types:full` to re-export the
 * schema first). CI compares the file against the committed version and
 * fails if stale.
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

/**
 * Remove `title` from every subschema except the root and the direct values
 * of `$defs`/`definitions`. Pydantic titles every property ("Project Id",
 * "Success", …); json-schema-to-typescript hoists each titled schema into a
 * named top-level alias, which across 70+ methods produces hundreds of
 * duplicate identifiers (`ProjectId`, `Message`, …) whose collisions resolve
 * arbitrarily. Untitled subschemas are inlined instead. Named types survive
 * only for real nested models (the $defs entries).
 */
function stripPropertyTitles(node: unknown, isNamedRoot: boolean): void {
  if (Array.isArray(node)) {
    for (const item of node) stripPropertyTitles(item, false);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (!isNamedRoot) delete obj.title;
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== "object") continue;
    if (key === "$defs" || key === "definitions") {
      for (const def of Object.values(value as Record<string, unknown>)) {
        stripPropertyTitles(def, true);
      }
      continue;
    }
    if (key === "properties" || key === "patternProperties") {
      // The container's keys are field names ("title" included) — only the
      // schema values underneath are subject to stripping.
      for (const propSchema of Object.values(
        value as Record<string, unknown>,
      )) {
        stripPropertyTitles(propSchema, false);
      }
      continue;
    }
    stripPropertyTitles(value, false);
  }
}

/** Split compiled output into top-level declarations, keyed by name. */
function splitDeclarations(
  compiled: string,
): Array<{ name: string; text: string }> {
  const blocks: Array<{ name: string; text: string }> = [];
  const lines = compiled.split("\n");
  let current: string[] = [];
  let currentName: string | null = null;

  const flush = () => {
    if (currentName !== null) {
      blocks.push({ name: currentName, text: current.join("\n").trim() });
    }
    current = [];
    currentName = null;
  };

  let pendingComment: string[] = [];
  for (const line of lines) {
    const m = line.match(/^export (?:interface|type) (\w+)/);
    if (m) {
      flush();
      current = [...pendingComment, line];
      pendingComment = [];
      currentName = m[1];
      continue;
    }
    if (currentName === null) {
      // Leading jsdoc for the next declaration.
      if (line.trim() !== "") pendingComment.push(line);
      else pendingComment = [];
      continue;
    }
    current.push(line);
    // A declaration ends when we return to column 0 with `}` or the
    // type alias line already ended with `;` — handled by next `export`.
  }
  flush();
  return blocks;
}

/** Compare declarations ignoring comments/whitespace (docstrings differ
 * between a $def and its standalone shared export). */
function normalizeDecl(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const raw = readFileSync(SCHEMA_PATH, "utf-8");
  const doc = JSON.parse(raw) as SchemaDoc;

  const methodNames = Object.keys(doc.methods).sort();
  const sharedNames = Object.keys(doc.shared ?? {}).sort();

  const header = [
    `/* eslint-disable */`,
    `/**`,
    ` * GENERATED FILE — do not edit by hand.`,
    ` * Regenerate via \`npm run gen-types:full\` after backend handler changes.`,
    ` * Source: src/renderer/types/generated/rpc-schemas.json`,
    ` */`,
    ``,
  ];

  // name -> { text, normalized, origin } of every emitted declaration.
  const emitted = new Map<
    string,
    { text: string; normalized: string; origin: string }
  >();
  const outputBlocks: string[] = [];

  function addDeclarations(compiled: string, origin: string): void {
    for (const decl of splitDeclarations(compiled)) {
      const normalized = normalizeDecl(decl.text);
      const existing = emitted.get(decl.name);
      if (existing) {
        if (existing.normalized !== normalized) {
          throw new Error(
            `Conflicting type name ${decl.name} ` +
              `emitted by ${origin} differs from the one emitted by ${existing.origin}. ` +
              `Rename one of the Python model classes so the generated names are unique.`,
          );
        }
        continue; // identical re-declaration — skip
      }
      emitted.set(decl.name, { text: decl.text, normalized, origin });
      outputBlocks.push(decl.text);
    }
  }

  // Shared domain types (ProgressEvent, RecordPayload, RecordStateName, etc.)
  for (const name of sharedNames) {
    const schema = structuredClone(doc.shared![name]);
    (schema as Record<string, unknown>).title = name;
    stripPropertyTitles(schema, true);
    const ts = await compile(schema as any, name, {
      bannerComment: "",
      additionalProperties: false,
      declareExternallyReferenced: true,
      unreachableDefinitions: false,
    });
    addDeclarations(ts, `shared:${name}`);
  }

  for (const method of methodNames) {
    const spec = doc.methods[method];
    const reqName = `${pascalCase(method)}Request`;
    const resName = `${pascalCase(method)}Response`;

    for (const [schemaIn, name] of [
      [spec.request, reqName],
      [spec.response, resName],
    ] as const) {
      const schema = structuredClone(schemaIn) as Record<string, unknown>;
      // Force the deterministic name: the RPCMethods map below references
      // it, so the Pydantic class name (e.g. `PDFGetResponse`, or a model
      // shared by several methods) must not leak into the compiled name.
      schema.title = name;
      stripPropertyTitles(schema, true);
      const ts = await compile(schema as any, name, {
        bannerComment: "",
        additionalProperties: false,
        declareExternallyReferenced: true,
        unreachableDefinitions: false,
      });
      addDeclarations(ts, `${method}:${name}`);
    }
  }

  // Sanity check: every name referenced by the map must have been emitted.
  for (const method of methodNames) {
    for (const suffix of ["Request", "Response"]) {
      const name = `${pascalCase(method)}${suffix}`;
      if (!emitted.has(name)) {
        throw new Error(
          `RPCMethods references ${name} but no such declaration was emitted.`,
        );
      }
    }
  }

  // Build the RPCMethods map.
  const mapBlocks: string[] = [];
  mapBlocks.push(
    `/** Discriminated map: method name → request/response types. */`,
  );
  mapBlocks.push(`export interface RPCMethods {`);
  for (const method of methodNames) {
    const reqName = `${pascalCase(method)}Request`;
    const resName = `${pascalCase(method)}Response`;
    mapBlocks.push(`  ${JSON.stringify(method)}: {`);
    mapBlocks.push(`    params: ${reqName};`);
    mapBlocks.push(`    result: ${resName};`);
    mapBlocks.push(`  };`);
  }
  mapBlocks.push(`}`);
  mapBlocks.push(``);
  mapBlocks.push(`export type RPCMethodName = keyof RPCMethods;`);
  mapBlocks.push(
    `export type RPCParams<M extends RPCMethodName> = RPCMethods[M]["params"];`,
  );
  mapBlocks.push(
    `export type RPCResult<M extends RPCMethodName> = RPCMethods[M]["result"];`,
  );

  const output =
    header.join("\n") +
    outputBlocks.join("\n\n") +
    "\n\n" +
    mapBlocks.join("\n") +
    "\n";
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, output);
  console.log(
    `Wrote ${methodNames.length} method types (${emitted.size} declarations) to ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

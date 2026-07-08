#!/usr/bin/env npx tsx
/**
 * Maps changed source files to the Firebase functions that must be redeployed,
 * by deriving the REAL import graph with esbuild (metafile) instead of a
 * hand-maintained map.
 *
 * - Entry points come from `export { fn } from './file'` lines in src/index.ts.
 * - Each entry is bundled (packages external, nothing written) and the
 *   metafile's per-output `inputs` is the exact transitive closure of local
 *   files that function depends on — ../shared included.
 * - A changed file reachable from no entry point cannot affect deployed code;
 *   it is skipped WITH A NOTE on stderr (never silently).
 *
 * Usage:
 *   echo "<changed files, one per line, repo-root-relative>" | npx tsx scripts/changed-functions.ts
 *   npx tsx scripts/changed-functions.ts --orphans   # list src files unreachable from any entry
 *
 * Output: space-separated function names on stdout (empty if none affected).
 * Exit codes: 0 ok, 2 internal error (caller should fall back to full deploy).
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FUNCTIONS_DIR, '..');
const INDEX = path.join(FUNCTIONS_DIR, 'src', 'index.ts');

/** Parse `export { a, b } from './file';` lines into fnName -> entry file. */
function parseEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  const src = fs.readFileSync(INDEX, 'utf-8');
  const re = /export\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    let rel = m[2];
    if (!/\.(ts|js)$/.test(rel)) rel += '.ts';
    const file = path.resolve(path.dirname(INDEX), rel);
    for (const name of names) entries.set(name, file);
  }
  if (entries.size === 0) throw new Error(`no exports parsed from ${INDEX}`);
  return entries;
}

/** repo-root-relative path for an esbuild input path (relative to functions/). */
function normalize(input: string): string {
  return path.relative(REPO_ROOT, path.resolve(FUNCTIONS_DIR, input));
}

async function buildGraph(entries: Map<string, string>): Promise<Map<string, Set<string>>> {
  const result = await esbuild.build({
    entryPoints: [...new Set(entries.values())],
    bundle: true,
    platform: 'node',
    packages: 'external',
    metafile: true,
    write: false,
    outdir: 'out-unused',
    absWorkingDir: FUNCTIONS_DIR,
    logLevel: 'silent',
  });

  // entry file -> its transitive input set (repo-root-relative)
  const entryInputs = new Map<string, Set<string>>();
  for (const out of Object.values(result.metafile.outputs)) {
    if (!out.entryPoint) continue;
    const entryAbs = path.resolve(FUNCTIONS_DIR, out.entryPoint);
    entryInputs.set(entryAbs, new Set(Object.keys(out.inputs).map(normalize)));
  }

  // invert: file -> function names
  const fileToFns = new Map<string, Set<string>>();
  for (const [fn, entryFile] of entries) {
    const inputs = entryInputs.get(entryFile);
    if (!inputs) throw new Error(`no metafile output for entry ${entryFile} (fn ${fn})`);
    for (const file of inputs) {
      if (!fileToFns.has(file)) fileToFns.set(file, new Set());
      fileToFns.get(file)!.add(fn);
    }
  }
  return fileToFns;
}

async function main() {
  const entries = parseEntries();
  const fileToFns = await buildGraph(entries);

  if (process.argv.includes('--orphans')) {
    const srcDir = path.join(FUNCTIONS_DIR, 'src');
    const orphans = fs.readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.relative(REPO_ROOT, path.join(srcDir, f)))
      .filter((rel) => !fileToFns.has(rel));
    if (orphans.length) {
      console.error('src files unreachable from any function entry (dead code?):');
      for (const o of orphans) console.error(`  ${o}`);
    } else {
      console.error('no orphans — every src file is reachable from an entry.');
    }
    return;
  }

  const changed = fs.readFileSync(0, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean);
  const targets = new Set<string>();
  const indexRel = path.relative(REPO_ROOT, INDEX);
  for (const file of changed) {
    if (file === indexRel) {
      // index.ts is the export root, not an entry input — new/removed exports
      // or option changes affect everything.
      for (const fn of entries.keys()) targets.add(fn);
      continue;
    }
    const fns = fileToFns.get(file);
    if (fns) {
      for (const fn of fns) targets.add(fn);
    } else if (/^functions\/src\/.*\.ts$/.test(file) && !file.endsWith('.test.ts')) {
      console.error(`note: ${file} changed but is imported by no function entry — skipping (dead code).`);
    }
    // anything else (tests, scripts/, docs, frontend) is legitimately deploy-irrelevant
  }
  process.stdout.write([...targets].sort().join(' '));
}

main().catch((err) => {
  console.error('changed-functions failed:', err instanceof Error ? err.message : err);
  process.exit(2);
});

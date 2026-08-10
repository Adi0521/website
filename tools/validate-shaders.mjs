#!/usr/bin/env node
/**
 * Shader gate. Runs in CI and pre-commit.
 *
 * This exists because brace-balance and uniform-name checks are NOT
 * verification: a `patch` identifier passed both and still failed to compile
 * in the browser. `patch` is reserved in GLSL ES 3.00 for tessellation, and so
 * are `sample`, `half`, `input`, `output`, `buffer`, `shared`, `filter` and
 * `this` — all words you would reach for without thinking.
 */
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";

const SHADER_DIR = "src/gl/shaders";
const RESERVED = `patch sample subroutine common partition active asm class union enum
typedef template this packed goto inline noinline volatile public static extern external
interface long short half fixed unsigned superp input output filter sizeof cast namespace
using resource attribute varying coherent restrict readonly writeonly noperspective buffer
shared`.split(/\s+/).filter(Boolean);

/** vite-plugin-glsl resolves `#include "x";` at build time. glslang cannot, so
 *  we inline them here and validate exactly what the GPU will receive. */
function resolve(file, seen = new Set()) {
  if (seen.has(file)) throw new Error(`circular include: ${file}`);
  seen.add(file);
  return readFileSync(file, "utf8").replace(
    /^[ \t]*#include\s+["<]([^">]+)[">];?\s*$/gm,
    (_, rel) => resolve(join(dirname(file), rel), new Set(seen))
  );
}

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const targets = walk(SHADER_DIR).filter((f) => [".vert", ".frag"].includes(extname(f)));
const tmp = mkdtempSync(join(tmpdir(), "glsl-"));
let failures = 0;

for (const file of targets) {
  const src = resolve(file);
  const code = stripComments(src);

  for (const w of RESERVED) {
    if (new RegExp(`\\b${w}\\b`).test(code)) {
      console.error(`  [${file}] RESERVED WORD in code: '${w}'`);
      failures++;
    }
  }

  const stage = extname(file).slice(1);
  const out = join(tmp, `x.${stage}`);
  writeFileSync(out, src);
  try {
    execFileSync("glslangValidator", [out], { stdio: "pipe" });
    console.log(`  [${file}] ok (${src.length} bytes after includes)`);
  } catch (e) {
    console.error(`  [${file}] COMPILE FAIL:`);
    for (const line of String(e.stdout ?? e.message).split("\n")) {
      if (line.trim() && !line.startsWith(tmp)) console.error("     " + line);
    }
    failures++;
  }
}

console.log(`\nFAILURES: ${failures}`);
process.exit(failures ? 1 : 0);

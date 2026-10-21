/**
 * The interface is fully translated (no test runner):
 *   node --experimental-strip-types --no-warnings --import ./scripts/register-ts.mjs scripts/check-i18n.mts
 * Fails when Cyrillic appears in the frontend sources outside the Russian dictionary, or when the
 * `ru`/`zh` dictionaries differ from `en` in keys or in the `{placeholders}` of a key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";
import { zh } from "@/lib/i18n/zh";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const DICTS = new Set([join(ROOT, "src", "lib", "i18n", "ru.ts"), join(ROOT, "src", "lib", "i18n", "zh.ts")]);
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
const problems: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mts|mjs|js|css)$/.test(name) ? [path] : [];
  });
}

for (const path of [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts"))]) {
  if (DICTS.has(path)) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (CYRILLIC.test(line)) problems.push(`Cyrillic outside the Russian dictionary: ${relative(ROOT, path)}:${i + 1}: ${line.trim()}`);
    });
}

type Tree = { readonly [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else for (const [k, v] of leaves(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

/** `{name}` and `{name, plural, …}` → the parameter names a string expects. */
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort().join(",");

const english = leaves(en as Tree);
for (const [name, other0] of [["ru", ru], ["zh", zh]] as const) {
  const other = leaves(other0 as Tree);
  for (const key of english.keys()) if (!other.has(key)) problems.push(`Missing in ${name}.ts: ${key}`);
  for (const key of other.keys()) if (!english.has(key)) problems.push(`Missing in en.ts: ${name}.ts has ${key}`);
  for (const [key, text] of english) {
    const theirs = other.get(key);
    if (theirs !== undefined && placeholders(text) !== placeholders(theirs))
      problems.push(`Different placeholders for ${key}: en {${placeholders(text)}} / ${name} {${placeholders(theirs)}}`);
    if (!text.trim() || (theirs !== undefined && !theirs.trim())) problems.push(`Empty text for ${key}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncheck:i18n failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`ok  ${english.size} keys in en/ru/zh, same placeholders; no Cyrillic outside the dictionaries`);

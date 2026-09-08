// One-off: strip .app--creation / .app--classic / .transcript--creation-scrollbar
// rules from styles.css via postcss (format-preserving). Simplifies
// :not(.app--creation) / :not(.app--classic) compounds.
// Usage: node scripts/strip-dead-layout-css.mjs src/styles.css
import postcss from "postcss";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const src = readFileSync(file, "utf8");
const DEAD = [/\.app--creation/, /\.app--classic/, /\.transcript--creation-scrollbar/];

const ast = postcss.parse(src);

ast.walkRules((rule) => {
  if (rule.parent && rule.parent.type === "atrule" && /^@(?:-webkit-)?keyframes/.test(rule.parent.name)) return;
  const selectors = rule.selectors;
  const alive = selectors.filter((s) => !DEAD.some((re) => re.test(s)));
  if (alive.length === 0) {
    rule.remove();
    return;
  }
  const simplified = alive.map((s) => s.replace(/:not\(\.app--creation\)/g, "").replace(/:not\(\.app--classic\)/g, ""));
  const changed = simplified.length !== selectors.length || simplified.some((s, i) => s !== selectors[i]);
  if (changed) {
    rule.selector = [...new Set(simplified)].join(",\n");
  }
});

const out = ast.toString();
writeFileSync(file, out);
const count = (out.match(/app--creation|app--classic|transcript--creation-scrollbar/g) || []).length;
console.log(`remaining dead tokens: ${count}; size: ${src.length} -> ${out.length}`);

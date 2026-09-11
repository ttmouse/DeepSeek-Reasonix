// Run: tsx src/__tests__/settings-navigation-contract.test.ts

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(resolve(testDir, "../components/SettingsPanel.tsx"), "utf8");
const navigation = readFileSync(resolve(testDir, "../components/SettingsNavigation.tsx"), "utf8");

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string) {
  if (condition) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}\n`);
    failed += 1;
  }
}

console.log("\nsettings navigation contract");

ok(/useEffect\(\(\) => \{[\s\S]*?content\.scrollTop = 0;[\s\S]*?content\.scrollLeft = 0;[\s\S]*?\}, \[tab\]\);/.test(panel), "switching settings pages resets both content scroll axes");
ok(navigation.includes('aria-current={activeTab === id ? "page" : undefined}'), "the active settings page is exposed semantically");
ok(!navigation.includes("<small"), "settings navigation renders a single-line item with no secondary metadata");
ok(navigation.includes("item.meta"), "navigation metadata still feeds search matching without being displayed");

const navTabs = navigation.match(/SETTINGS_NAV_TABS: SettingsTab\[\] = \[([^\]]+)\]/)?.[1] ?? "";
ok(/"models",\s*"providers",\s*"model-stats"/.test(navTabs), "model preferences, model services, and usage statistics are three adjacent navigation entries");
ok(/settings\.tab\.models",\s*tabs: \["models", "providers", "model-stats"\]/.test(navigation), "the three model entries share their own settings navigation group");
ok(/case "model-stats":\s*return <ChartNoAxesColumn/.test(navigation), "usage statistics uses the chart column navigation icon");
ok(/"general",\s*"bots",/.test(navTabs), "general and bots precede the model group in the navigation order");
ok(/"shortcuts",\s*"permissions"/.test(navTabs) && /tabs: \["appearance", "shortcuts", "storage", "updates"\]/.test(navigation), "shortcuts moved into the application group alongside appearance, storage, and updates");
ok(/case "models":\s*return t\("settings\.models\.preferences"\);/.test(panel) && /case "providers":\s*return t\("settings\.models\.services"\);/.test(panel) && /case "model-stats":\s*return t\("settings\.modelTab\.stats"\);/.test(panel), "the three entries resolve to the model preferences, model services, and usage statistics labels");
ok(/\{\(tab === "models" \|\| tab === "providers" \|\| tab === "model-stats"\)[\s\S]*?subtab=\{tab === "providers" \? "access" : tab === "model-stats" \? "stats" : "usage"\}/.test(panel), "each navigation entry renders its own model page: preferences, provider access, and usage statistics");
ok(/if \(initialFocus\?\.target === "model-access"\) setTab\("providers"\);[\s\S]*?if \(initialFocus\?\.target === "model-stats"\) setTab\("model-stats"\);/.test(panel), "model access and usage statistics focus targets open their dedicated pages");

const en = readFileSync(resolve(testDir, "../locales/en.ts"), "utf8");
const zh = readFileSync(resolve(testDir, "../locales/zh.ts"), "utf8");
const zhTW = readFileSync(resolve(testDir, "../locales/zh-TW.ts"), "utf8");
ok([en, zh, zhTW].every((locale) => locale.includes('"settings.models.preferences"') && locale.includes('"settings.models.services"') && locale.includes('"settings.pageDesc.model-stats"')), "model preferences, model services, and usage statistics are localized in every supported locale");

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);

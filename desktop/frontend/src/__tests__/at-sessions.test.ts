// Run: tsx src/__tests__/at-sessions.test.ts
//
// Regression coverage for the unified @ panel's recent-sessions filter
// (Codex-style reference panel). The match logic must stay aligned with the
// "#"-triggered session search: a fragment matches title, topic, preview,
// path, or workspace with a lowercased substring match.

import { atMenuSessionMatches } from "../lib/atSessions";
import type { SessionMeta } from "../lib/types";

let passed = 0;
let failed = 0;

function eq(a: unknown, b: unknown, label: string) {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    process.stdout.write(`  PASS  ${label}\n`);
    passed += 1;
  } else {
    process.stdout.write(`  FAIL  ${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}\n`);
    failed += 1;
  }
}

function session(partial: Partial<SessionMeta> & { path: string }): SessionMeta {
  return {
    title: "",
    topicTitle: "",
    preview: "",
    path: partial.path,
    workspaceRoot: "",
    modTime: 0,
    createdAt: 0,
    lastActivityAt: 0,
    turns: 0,
    ...partial,
  };
}

console.log("\nat-sessions filter");

// 1. Empty fragment returns all sessions (order preserved).
{
  const sessions = [session({ path: "/a" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "");
  eq(got, sessions, "empty fragment keeps every session");
}

// 2. Fragment matches title.
{
  const sessions = [session({ path: "/a", title: "Refactor planner" }), session({ path: "/b", title: "Fix gateway" })];
  const got = atMenuSessionMatches(sessions, "planner");
  eq(got.map((s) => s.path), ["/a"], "title substring match");
}

// 3. Fragment matches topic.
{
  const sessions = [session({ path: "/a", topicTitle: "heartbeat cache" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "heartbeat");
  eq(got.map((s) => s.path), ["/a"], "topic substring match");
}

// 4. Fragment matches preview.
{
  const sessions = [session({ path: "/a", preview: "fixed the ring compression error" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "ring");
  eq(got.map((s) => s.path), ["/a"], "preview substring match");
}

// 5. Fragment matches workspace root.
{
  const sessions = [session({ path: "/a", workspaceRoot: "/Users/douba/Projects/DeepSeek-Reasonix" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "reasonix");
  eq(got.map((s) => s.path), ["/a"], "workspace substring match");
}

// 6. Match is case-insensitive.
{
  const sessions = [session({ path: "/a", title: "Session CLEAR" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "clear");
  eq(got.map((s) => s.path), ["/a"], "lowercased query matches mixed-case title");
}

// 7. Fragment trims surrounding whitespace.
{
  const sessions = [session({ path: "/a", title: "planner" }), session({ path: "/b" })];
  const got = atMenuSessionMatches(sessions, "  planner  ");
  eq(got.map((s) => s.path), ["/a"], "fragment trimmed before matching");
}

console.log(`\nat-sessions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

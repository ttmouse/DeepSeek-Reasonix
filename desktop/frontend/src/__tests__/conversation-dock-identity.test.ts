// Run: tsx src/__tests__/conversation-dock-identity.test.ts
// Pure-function contract for the conversation dock key: same topic+generation
// must produce the same key, different identities must produce different keys,
// workspace roots normalize, and remote conversations use their own namespace.

import {
  conversationDockKey,
  conversationDockIdentityKind,
  EMPTY_CONVERSATION_DOCK_KEY,
  isEmptyConversationDockKey,
  type ConversationDockIdentityInput,
} from "../lib/conversationDockIdentity";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function input(overrides: Partial<ConversationDockIdentityInput> = {}): ConversationDockIdentityInput {
  return {
    tabId: "tab-1",
    scope: "project",
    workspaceRoot: "/work/alpha",
    topicId: "topic-9",
    sessionGeneration: 3,
    ...overrides,
  };
}

console.log("\nconversation dock identity");

// --- determinism: same topic + generation => same key ---
check(
  "same topic and generation produce the same key",
  conversationDockKey(input()) === conversationDockKey(input()),
);

// --- topic is the primary identity ---
check(
  "different topics produce different keys",
  conversationDockKey(input({ topicId: "topic-9" })) !== conversationDockKey(input({ topicId: "topic-10" })),
);

// --- generation distinguishes clears / new sessions ---
check(
  "same topic, different generation produces a different key",
  conversationDockKey(input({ sessionGeneration: 3 })) !== conversationDockKey(input({ sessionGeneration: 4 })),
);

// --- generation fallback: undefined and 0 are the same initial generation ---
check(
  "undefined generation equals generation 0",
  conversationDockKey(input({ sessionGeneration: undefined })) === conversationDockKey(input({ sessionGeneration: 0 })),
);

// --- fallback order: topicId > sessionPath > tabId ---
const withTopic = conversationDockKey(input({ topicId: "topic-9", sessionPath: "/s/x.jsonl" }));
const withSession = conversationDockKey(input({ topicId: "", sessionPath: "/s/x.jsonl" }));
const withTab = conversationDockKey(input({ topicId: "", sessionPath: "", tabId: "tab-1" }));
check("topicId wins over sessionPath in the key", withTopic !== withSession);
check("sessionPath wins over tabId in the key", withSession !== withTab);
check(
  "identity kind reports topic / session / temporary fallback",
  conversationDockIdentityKind(input({ topicId: "topic-9" })) === "topic" &&
    conversationDockIdentityKind(input({ topicId: "", sessionPath: "/s/x.jsonl" })) === "session" &&
    conversationDockIdentityKind(input({ topicId: "", sessionPath: "", tabId: "tab-1" })) === "temporary",
);

// --- workspace root normalization ---
check(
  "trailing slashes and backslashes normalize to the same root",
  conversationDockKey(input({ workspaceRoot: "/work/alpha/" })) ===
    conversationDockKey(input({ workspaceRoot: "/work/alpha" })) &&
    conversationDockKey(input({ workspaceRoot: "C:\\work\\alpha\\" })) ===
      conversationDockKey(input({ workspaceRoot: "C:/work/alpha" })),
);

// --- scope separates project from global conversations ---
check(
  "scope is part of the key",
  conversationDockKey(input({ scope: "project" })) !== conversationDockKey(input({ scope: "global" })),
);

// --- remote conversations live in their own namespace ---
const remoteA = conversationDockKey(input({ remote: { hostId: "host-1", workspace: "/r/ws" } }));
const remoteB = conversationDockKey(input({ remote: { hostId: "host-2", workspace: "/r/ws" } }));
const remoteSame = conversationDockKey(input({ remote: { hostId: "host-1", workspace: "/r/ws" } }));
check("remote host is part of the key", remoteA !== remoteB);
check("same remote host and workspace produce the same key", remoteA === remoteSame);
check(
  "remote and local keys never collide",
  remoteA !== conversationDockKey(input({ topicId: "remote:host-1:/r/ws:topic-9:3" })),
);
check(
  "remote key uses the remote workspace, not the local root",
  remoteA === "remote:host-1:/r/ws:topic-9:3",
  `got ${remoteA}`,
);

// --- empty placeholder ---
check(
  "empty conversation key placeholder is stable and recognized",
  isEmptyConversationDockKey(EMPTY_CONVERSATION_DOCK_KEY) === true &&
    isEmptyConversationDockKey(conversationDockKey(input())) === false,
);

console.log(`\nconversation-dock-identity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

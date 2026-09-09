// atSessions filters the recent-sessions list shown inside the unified @ menu
// (the Codex-style reference panel). It is extracted from the Composer so it
// can be unit-tested without mounting the full React tree.
//
// The match logic mirrors the "#"-triggered session search: the user's fragment
// is matched against the human-visible fields (title, topic, preview, path,
// workspace) with a lowercased substring match so behaviour stays predictable
// across locales.

import type { SessionMeta } from "./types";

function sessionSearchableText(session: SessionMeta): string {
  return [
    session.title,
    session.topicTitle,
    session.preview,
    session.path,
    session.workspaceRoot,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

export function atMenuSessionMatches(
  sessions: readonly SessionMeta[],
  frag: string,
): SessionMeta[] {
  const query = frag.trim().toLowerCase();
  if (!query) return [...sessions];
  return sessions.filter((session) => sessionSearchableText(session).includes(query));
}

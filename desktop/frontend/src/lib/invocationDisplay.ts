import type { CommandInfo, SessionReference } from "./types";
import type { SessionMeta } from "./sessionMetaTypes";
import { convertAttachmentRefsToFileMarkers } from "./attachmentDisplay";

export type InvocationKind = "skill" | "subagent" | "session" | "file";
export type InvocationMetadata = { kind: InvocationKind; color?: string };
export type InvocationMetadataMap = Readonly<Record<string, InvocationMetadata>>;

export type InvocationDisplay = {
  name: string;
  label: string;
  source?: string;
  kind?: InvocationKind;
  color?: string;
  /** Session path for referenced-session invocations (new marker format). */
  path?: string;
};

/** A file/folder attachment or workspace reference rendered as an inline badge. */
export type FileReference = {
  path: string;
  name: string;
  kind: "image" | "file" | "folder";
  source: "attachment" | "workspace";
};

// A composer entity is either a slash command (skill/subagent), a referenced
// chat session, or a file/workspace reference. All three render as zero-length
// inline atoms in the rich input; sessions and files additionally feed the
// referenced context on submit.
export type ComposerInvocation =
  | { id: string; offset: number; command: CommandInfo }
  | { id: string; offset: number; session: SessionReference }
  | { id: string; offset: number; file: FileReference };

export type InvocationRequest = {
  name: string;
  kind: InvocationKind;
  offset: number;
};

export type StructuredInvocationSubmit = {
  display: string;
  input: string;
  invocations: InvocationRequest[];
};

export function invocationRequests(invocations: ComposerInvocation[]): InvocationRequest[] {
  // Session entities are not slash invocations: they ride in the serialized
  // display markers and the referenced-session context header on submit.
  return sortComposerInvocations(invocations).flatMap((invocation) =>
    "command" in invocation
      ? [{
          name: invocation.command.name,
          kind: invocation.command.kind === "subagent" ? "subagent" : "skill",
          offset: invocation.offset,
        }]
      : [],
  );
}

// A user can paste a complete slash invocation without selecting the rich
// composer token. Goal setup needs the same structured path for that input so
// the slash name is not absorbed into the goal text.
export function typedStructuredInvocationDraft(
  text: string,
  commands: CommandInfo[],
): { text: string; invocations: ComposerInvocation[] } | null {
  const match = /^\/([A-Za-z0-9_.:-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const command = commands.find((candidate) => candidate.name === match[1] && commandUsesStructuredInvocation(candidate));
  if (!command) return null;
  return {
    text: (match[2] ?? "").trim(),
    invocations: [{ id: `typed-invocation-${command.name}`, offset: 0, command }],
  };
}

export type InvocationTextSegment =
  | { type: "text"; content: string; start: number }
  | { type: "invocation"; invocation: InvocationDisplay; offset: number };

const invocationNamePattern = "[A-Za-z0-9_.:-]+";
const knownSubagents = new Set(["general-purpose", "explore", "research", "review", "security_review"]);

export function commandUsesStructuredInvocation(command: CommandInfo): boolean {
  return command.kind === "skill" || command.kind === "subagent";
}

export function commandAvailableAtSlashPosition(command: CommandInfo, atMessageStart: boolean): boolean {
  return atMessageStart || commandUsesStructuredInvocation(command);
}

export function invocationLabel(name: string): string {
  const unqualified = name.split(":").pop() || name;
  return unqualified
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function invocationDisplayForCommand(command: CommandInfo): InvocationDisplay {
  return {
    name: command.name,
    label: invocationLabel(command.name),
    source: command.plugin || command.name.split(":").slice(0, -1).join(":") || undefined,
    kind: command.kind === "subagent" ? "subagent" : "skill",
    color: command.color,
  };
}

export function invocationDisplayForFile(file: FileReference): InvocationDisplay {
  return { name: "file", label: file.name, kind: "file", path: file.path };
}

export function sortComposerInvocations(invocations: ComposerInvocation[]): ComposerInvocation[] {
  return invocations
    .map((invocation, index) => ({ invocation, index }))
    .sort((a, b) => a.invocation.offset - b.invocation.offset || a.index - b.index)
    .map(({ invocation }) => invocation);
}

export function replaceInvocationTextRange(
  text: string,
  invocations: ComposerInvocation[],
  start: number,
  end: number,
  value: string,
  afterInvocationId?: string,
): { text: string; invocations: ComposerInvocation[] } {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(from, Math.min(Math.max(start, end), text.length));
  const delta = value.length - (to - from);
  const ordered = sortComposerInvocations(invocations);
  const anchorIndex = from === to && afterInvocationId
    ? ordered.findIndex((invocation) => invocation.id === afterInvocationId && invocation.offset === from)
    : -1;
  const nextInvocations = ordered
    .filter((invocation) => invocation.offset <= from || invocation.offset >= to)
    .map((invocation, index) => {
      const shiftAtInsertion = from === to
        && invocation.offset === to
        && (anchorIndex < 0 || index > anchorIndex);
      const shiftAfterRange = invocation.offset > to || (from < to && invocation.offset === to);
      return {
        ...invocation,
        offset: shiftAtInsertion || shiftAfterRange ? invocation.offset + delta : invocation.offset,
      };
    });
  return {
    text: text.slice(0, from) + value + text.slice(to),
    invocations: sortComposerInvocations(nextInvocations),
  };
}

export function trimInvocationDraft(
  text: string,
  invocations: ComposerInvocation[],
): { text: string; invocations: ComposerInvocation[] } {
  const trimmedStart = text.trimStart();
  const leading = text.length - trimmedStart.length;
  const trimmed = trimmedStart.trimEnd();
  return {
    text: trimmed,
    invocations: sortComposerInvocations(invocations.map((invocation) => ({
      ...invocation,
      offset: Math.max(0, Math.min(trimmed.length, invocation.offset - leading)),
    }))),
  };
}

// Serialized form of a referenced session, e.g. "@chat[Refactor notes]".
// The marker is synthetic and unambiguous: it only appears when a session
// entity is attached, so the message renderer can restore bubbles from the
// display at any position without a metadata lookup.
// Session markers carry both the stable path and the display title so that
// rewind/edit can restore the exact session (not just a best-effort title
// match). The body is "path|title"; legacy markers without a pipe are parsed
// as title-only (path empty, falls back to title lookup).
const SESSION_MARKER_SEP = "|";

function sanitizeMarkerSegment(value: string): string {
  return value.replace(/[\r\n\[\]|]+/g, " ").trim();
}

export function parseSessionMarkerBody(body: string): { path: string; title: string } {
  const sep = body.indexOf(SESSION_MARKER_SEP);
  if (sep < 0) return { path: "", title: body };
  return { path: body.slice(0, sep), title: body.slice(sep + SESSION_MARKER_SEP.length) };
}

export function sessionInvocationMarker(session: SessionReference): string {
  const path = sanitizeMarkerSegment(session.path || "");
  const title = sanitizeMarkerSegment(session.title || "") || "Untitled";
  return `@chat[${path}${SESSION_MARKER_SEP}${title}]`;
}

// Serialized form of a file reference, e.g. "@file[src/index.ts|index.ts]".
// Mirrors the session marker grammar so the message renderer can restore
// inline file badges at any position without a metadata lookup. The body is
// "path|name"; legacy markers without a pipe are parsed as path-only (name
// falls back to the basename).
const FILE_MARKER_SEP = "|";

export function parseFileMarkerBody(body: string): { path: string; name: string } {
  const sep = body.indexOf(FILE_MARKER_SEP);
  if (sep < 0) {
    const path = body;
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    return { path, name: name || path || "file" };
  }
  return { path: body.slice(0, sep), name: body.slice(sep + FILE_MARKER_SEP.length) };
}

export function fileInvocationMarker(file: FileReference): string {
  const path = sanitizeMarkerSegment(file.path);
  const name = sanitizeMarkerSegment(file.name) || "file";
  return `@file[${path}${FILE_MARKER_SEP}${name}]`;
}

export function fileKindFromPath(path: string): FileReference["kind"] {
  if (path.endsWith("/")) return "folder";
  const lower = path.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/.test(lower)) return "image";
  return "file";
}

export function fileSourceFromPath(path: string): FileReference["source"] {
  return path.startsWith(".reasonix/attachments/") ? "attachment" : "workspace";
}

export function invocationDisplayForSession(session: SessionReference): InvocationDisplay {
  return { name: "chat", label: session.title || "Untitled", kind: "session" };
}

export function serializeInvocationSubmit(text: string, invocations: ComposerInvocation[]): string {
  const ordered = sortComposerInvocations(invocations);
  if (ordered.length === 0) return text;

  let cursor = 0;
  let output = "";
  for (const invocation of ordered) {
    const offset = Math.max(cursor, Math.min(text.length, invocation.offset));
    output += text.slice(cursor, offset);
    if (output && !/\s$/.test(output)) output += " ";
    output += "command" in invocation
      ? `/${invocation.command.name}`
      : "session" in invocation
        ? sessionInvocationMarker(invocation.session)
        : fileInvocationMarker(invocation.file);
    if (offset < text.length && !/^\s/.test(text.slice(offset))) output += " ";
    cursor = offset;
  }
  output += text.slice(cursor);
  return output;
}

function invocationBody(submitText: string): string {
  const sessionQuestionMarker = "当前用户问题：\n";
  const markerIndex = submitText.lastIndexOf(sessionQuestionMarker);
  return (markerIndex >= 0 ? submitText.slice(markerIndex + sessionQuestionMarker.length) : submitText).trim();
}

type TokenMatch = { start: number; end: number; name: string; kind: "command" | "session" | "file" };

function tokenMatches(text: string): TokenMatch[] {
  // Slash commands ("/name") plus synthetic session markers ("@chat[title]")
  // and file markers ("@file[path|name]"). All must be followed by whitespace
  // or end-of-input to count as tokens.
  const re = new RegExp(`(?:/(${invocationNamePattern})|@chat\\[([^\\]]+)\\]|@file\\[([^\\]]+)\\])`, "g");
  const out: TokenMatch[] = [];
  for (const match of text.matchAll(re)) {
    const end = match.index + match[0].length;
    if (end < text.length && !/\s/.test(text[end])) continue;
    out.push({
      start: match.index,
      end,
      name: match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3],
      kind: match[1] !== undefined ? "command" : match[2] !== undefined ? "session" : "file",
    });
  }
  return out;
}

function invocationSegmentForMatch(match: TokenMatch, invocationMetadata: InvocationMetadataMap): InvocationDisplay {
  if (match.kind === "session") {
    const { path, title } = parseSessionMarkerBody(match.name);
    return { name: "chat", label: title, kind: "session", path };
  }
  if (match.kind === "file") {
    const { path, name } = parseFileMarkerBody(match.name);
    return { name: "file", label: name, kind: "file", path };
  }
  return {
    name: match.name,
    label: invocationLabel(match.name),
    source: match.name.includes(":") ? match.name.split(":").slice(0, -1).join(":") : undefined,
    kind: invocationMetadata[match.name]?.kind ?? (knownSubagents.has(match.name) ? "subagent" : "skill"),
    color: invocationMetadata[match.name]?.color,
  };
}

function chunkVariants(chunk: string): string[] {
  const values = [chunk];
  if (chunk.startsWith(" ")) values.push(chunk.slice(1));
  if (chunk.endsWith(" ")) values.push(chunk.slice(0, -1));
  if (chunk.startsWith(" ") && chunk.endsWith(" ") && chunk.length > 1) values.push(chunk.slice(1, -1));
  return Array.from(new Set(values));
}

function segmentsForSelection(
  submit: string,
  display: string,
  matches: TokenMatch[],
  mask: number,
  invocationMetadata: InvocationMetadataMap,
): InvocationTextSegment[] | null {
  const selected = matches.filter((_, index) => (mask & (1 << index)) !== 0);
  if (selected.length === 0) return null;

  const normalizedDisplay = display.trim();
  const chunks: string[] = [];
  let cursor = 0;
  selected.forEach((match) => {
    chunks.push(submit.slice(cursor, match.start));
    cursor = match.end;
  });
  chunks.push(submit.slice(cursor));

  let resolved: { text: string; offsets: number[] } | null = null;
  const resolve = (index: number, text: string, offsets: number[]) => {
    if (resolved || !normalizedDisplay.startsWith(text)) return;
    if (index === chunks.length) {
      if (text === normalizedDisplay) resolved = { text, offsets };
      return;
    }
    for (const variant of chunkVariants(chunks[index])) {
      const nextText = text + variant;
      if (!normalizedDisplay.startsWith(nextText)) continue;
      const nextOffsets = index < selected.length ? [...offsets, nextText.length] : offsets;
      resolve(index + 1, nextText, nextOffsets);
    }
  };
  resolve(0, "", []);
  if (!resolved) return null;

  const segments: InvocationTextSegment[] = [];
  let textCursor = 0;
  selected.forEach((match, index) => {
    const offset = resolved!.offsets[index];
    if (offset > textCursor) {
      segments.push({ type: "text", content: normalizedDisplay.slice(textCursor, offset), start: textCursor });
    }
    segments.push({ type: "invocation", offset, invocation: invocationSegmentForMatch(match, invocationMetadata) });
    textCursor = offset;
  });
  if (textCursor < normalizedDisplay.length) {
    segments.push({ type: "text", content: normalizedDisplay.slice(textCursor), start: textCursor });
  }
  return segments;
}

// segmentsFromAllMatches renders every token in the display string as an
// invocation badge, regardless of position. Used when the submit/display text
// shapes match (or alignment fails) — in that case every "/name", "@chat[...]"
// and "@file[...]" in the display is a real invocation, not prose punctuation.
function segmentsFromAllMatches(
  display: string,
  matches: TokenMatch[],
  invocationMetadata: InvocationMetadataMap,
): InvocationTextSegment[] {
  const segments: InvocationTextSegment[] = [];
  let textCursor = 0;
  for (const match of matches) {
    if (match.start > textCursor) {
      segments.push({ type: "text", content: display.slice(textCursor, match.start), start: textCursor });
    }
    segments.push({ type: "invocation", offset: match.start, invocation: invocationSegmentForMatch(match, invocationMetadata) });
    textCursor = match.end;
  }
  if (textCursor < display.length) {
    segments.push({ type: "text", content: display.slice(textCursor), start: textCursor });
  }
  return segments;
}

// hydratedSlashFallbackSegments restores badges for a hydrated structured
// message: session reload resolves the recorded display — the serialized
// slash form ("/name task") — while the submit side is the composed model
// text with no slash tokens, so the display/submit pairing above never
// matches. Only the dominant serialized shape is restored: consecutive
// known-command / session tokens at the very start followed by the task
// text. Prose slashes, unknown names, and mid-text entities all bail to
// plain text.
function hydratedSlashFallbackSegments(
  display: string,
  invocationMetadata: InvocationMetadataMap,
): InvocationTextSegment[] | null {
  const matches = tokenMatches(display);
  if (matches.length === 0 || matches.length > 10) return null;
  const leading: TokenMatch[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start !== cursor || (match.kind !== "session" && match.kind !== "file" && !invocationMetadata[match.name])) break;
    leading.push(match);
    cursor = display[match.end] === " " ? match.end + 1 : match.end;
  }
  if (leading.length === 0 || leading.length !== matches.length) return null;
  const segments: InvocationTextSegment[] = leading.map((match) => ({
    type: "invocation",
    offset: match.end,
    invocation: invocationSegmentForMatch(match, invocationMetadata),
  }));
  const remainder = display.slice(cursor);
  if (remainder) segments.push({ type: "text", content: remainder, start: cursor });
  return segments;
}

// --- inline marker handling (sessions + files) ---
// Session entities serialize as "@chat[<path|title>]" and file references as
// "@file[<path|name>]" inside the display text. Both markers are synthetic and
// unambiguous, so the renderer restores inline badges at any position (not just
// leading like slash commands), then runs the slash alignment on the
// marker-stripped remainder and merges all segment families back into
// original-display coordinates.

type InlineMarker = { offset: number; length: number; kind: "chat" | "file"; path: string; label: string };

const INLINE_MARKER_RE = /@(chat|file)\[([^\]]+)\]/g;

function extractInlineMarkers(display: string): { markers: InlineMarker[]; stripped: string } {
  const markers: InlineMarker[] = [];
  const stripped = display.replace(INLINE_MARKER_RE, (match, kind: string, body: string, offset: number) => {
    if (kind === "chat") {
      const { path, title } = parseSessionMarkerBody(body);
      markers.push({ offset, length: match.length, kind: "chat", path, label: title });
    } else {
      const { path, name } = parseFileMarkerBody(body);
      markers.push({ offset, length: match.length, kind: "file", path, label: name });
    }
    return "";
  });
  return { markers, stripped };
}

function buildStrippedRemap(markers: InlineMarker[]): (strippedOffset: number) => number {
  const sorted = [...markers].sort((a, b) => a.offset - b.offset);
  let shift = 0;
  const anchors: Array<{ stripped: number; shift: number }> = [];
  for (const marker of sorted) {
    const strippedAt = marker.offset - shift;
    shift += marker.length;
    anchors.push({ stripped: strippedAt, shift });
  }
  return (strippedOffset: number) => {
    let total = 0;
    for (const anchor of anchors) {
      if (strippedOffset >= anchor.stripped) total = anchor.shift;
      else break;
    }
    return strippedOffset + total;
  };
}

function mergeInvocationSegments(
  strippedDisplay: string,
  slashSegments: InvocationTextSegment[],
  markers: InlineMarker[],
  remap: (strippedOffset: number) => number,
): InvocationTextSegment[] {
  // Slash segments (text + invocation) cover the marker-stripped display
  // contiguously; their text content is kept verbatim so hydrated leading
  // tokens (badge offset = token end) never leak the token text. Inline
  // markers are zero-width points in stripped space (their original offset
  // minus the lengths of all earlier markers); each is spliced into the
  // surrounding text run and re-mapped back to original coordinates.
  const sorted = [...markers].sort((a, b) => a.offset - b.offset);
  let shift = 0;
  const positioned = sorted.map((marker) => {
    const stripped = marker.offset - shift;
    shift += marker.length;
    return { ...marker, stripped };
  });

  const out: InvocationTextSegment[] = [];
  let markerIdx = 0;
  let stripCursor = 0;

  const flushMarkersUpTo = (upTo: number) => {
    while (markerIdx < positioned.length && positioned[markerIdx].stripped <= upTo) {
      const marker = positioned[markerIdx++];
      if (marker.stripped > stripCursor) {
        out.push({ type: "text", content: strippedDisplay.slice(stripCursor, marker.stripped), start: remap(stripCursor) });
      }
      const invocation: InvocationDisplay = marker.kind === "chat"
        ? { name: "chat", label: marker.label, kind: "session", path: marker.path }
        : { name: "file", label: marker.label, kind: "file", path: marker.path };
      out.push({ type: "invocation", offset: marker.offset, invocation });
      stripCursor = marker.stripped;
    }
  };

  for (const segment of slashSegments) {
    if (segment.type === "text") {
      // Text segments carry their own stripped-space coordinates: hydrated
      // remainders start after the consumed token text + trailing space, so
      // the segment bounds must not be inferred from the running cursor.
      const segStart = segment.start ?? stripCursor;
      const segEnd = segStart + segment.content.length;
      flushMarkersUpTo(segEnd);
      const emitStart = Math.max(segStart, stripCursor);
      if (segEnd > emitStart) {
        out.push({ type: "text", content: strippedDisplay.slice(emitStart, segEnd), start: remap(emitStart) });
        stripCursor = segEnd;
      }
    } else {
      flushMarkersUpTo(segment.offset);
      out.push({ type: "invocation", offset: remap(segment.offset), invocation: segment.invocation });
      stripCursor = segment.offset;
    }
  }
  flushMarkersUpTo(strippedDisplay.length);
  if (stripCursor < strippedDisplay.length) {
    out.push({ type: "text", content: strippedDisplay.slice(stripCursor), start: remap(stripCursor) });
  }
  return out;
}

export function invocationSegmentsFromMessage(
  displayText: string,
  submitText?: string,
  invocationMetadata: InvocationMetadataMap = {},
): InvocationTextSegment[] {
  const display = displayText.trim();
  const submit = invocationBody(submitText?.trim() ?? "");
  const { markers, stripped } = extractInlineMarkers(display);
  const remap = buildStrippedRemap(markers);

  // Even a message with no structured submit renders its inline badges: the
  // markers are unambiguous, so the slash machinery never gates them.
  if (!submit || submit === display) {
    return mergeInvocationSegments(stripped, [], markers, remap);
  }

  // The submit side may also carry markers (replay resubmits); strip them so
  // the slash alignment sees matching shapes on both sides. Legacy @path /
  // @[name](path) file refs are first normalized to @file[...] markers so they
  // get stripped too — otherwise a mid-text skill token fails to align because
  // the submit tail carries file refs the display side already replaced with
  // inline badges.
  const submitWithFileMarkers = convertAttachmentRefsToFileMarkers(submit).text;
  const strippedSubmit = submitWithFileMarkers.replace(INLINE_MARKER_RE, "");

  if (strippedSubmit && strippedSubmit !== stripped) {
    const matches = tokenMatches(strippedSubmit);
    if (matches.length > 0 && matches.length <= 10) {
      const masks = 1 << matches.length;
      for (let mask = masks - 1; mask > 0; mask -= 1) {
        const segments = segmentsForSelection(strippedSubmit, stripped, matches, mask, invocationMetadata);
        if (segments) {
          return mergeInvocationSegments(stripped, segments, markers, remap);
        }
      }
    }
  }
  // When stripped submit matches stripped display (or alignment fails), every
  // token in the display is a real invocation — render all of them as badges
  // regardless of position (skills, sessions, files), not just leading tokens.
  // This fixes mid-text "/skill" tokens that hydratedSlashFallbackSegments
  // would drop because it only accepts consecutive tokens at offset 0.
  const displayMatches = tokenMatches(stripped);
  if (displayMatches.length > 0 && displayMatches.length <= 10) {
    const segments = segmentsFromAllMatches(stripped, displayMatches, invocationMetadata);
    return mergeInvocationSegments(stripped, segments, markers, remap);
  }
  const hydrated = hydratedSlashFallbackSegments(stripped, invocationMetadata);
  return mergeInvocationSegments(stripped, hydrated ?? [], markers, remap);
}

export function invocationDisplayFromMessage(displayText: string, submitText?: string): InvocationDisplay | null {
  const segment = invocationSegmentsFromMessage(displayText, submitText).find((item) => item.type === "invocation");
  return segment?.type === "invocation" ? segment.invocation : null;
}

/**
 * Restore composer invocations from a display string that carries synthetic
 * markers ("/name" for skills, "@chat[path|title]" for referenced sessions,
 * "@file[path|name]" for file/workspace references). Used when an already-sent
 * message is rewound back into the composer for editing.
 *
 * Returns the marker-stripped plain text (the composer model keeps tokens as
 * zero-length atoms, never as literal text) alongside invocations whose
 * offsets are remapped into the stripped coordinate space.
 *
 * Skills are resolved against the command catalog by name. Sessions are matched
 * against the session catalog by path (falling back to title/preview); when no
 * match exists the token is still rendered as a badge with a synthetic path so
 * the edit surface stays readable, though resubmission will not attach the
 * original session context. Files are restored from the marker body directly.
 */
export function parseComposerInvocationsFromDisplayText(
  text: string,
  commands: readonly CommandInfo[],
  sessions: readonly SessionMeta[],
): { text: string; invocations: ComposerInvocation[] } {
  const matches = tokenMatches(text);
  if (matches.length === 0) return { text, invocations: [] };

  // Strip every token from the display string while recording where each one
  // sat in the original text, so offsets can be remapped into stripped space.
  let stripped = "";
  let cursor = 0;
  const strippedOffsets: number[] = [];
  for (const match of matches) {
    stripped += text.slice(cursor, match.start);
    strippedOffsets.push(stripped.length);
    cursor = match.end;
  }
  stripped += text.slice(cursor);

  const invocations: ComposerInvocation[] = matches.map((match, idx) => {
    const offset = strippedOffsets[idx];
    if (match.kind === "command") {
      const command = commands.find((c) => c.name === match.name) ?? {
        name: match.name,
        description: "",
        kind: "builtin" as const,
      };
      return { id: `edit-command-${idx}-${match.name}`, offset, command };
    }
    if (match.kind === "file") {
      const { path, name } = parseFileMarkerBody(match.name);
      const file: FileReference = {
        path,
        name: name || path,
        kind: fileKindFromPath(path),
        source: fileSourceFromPath(path),
      };
      return { id: `edit-file-${idx}`, offset, file };
    }
    const { path: markerPath, title: markerTitle } = parseSessionMarkerBody(match.name);
    const sessionMeta = markerPath
      ? sessions.find((s) => s.path === markerPath)
      : sessions.find((s) => (s.title || s.preview) === markerTitle);
    const resolvedTitle = sessionMeta?.title || sessionMeta?.preview || markerTitle || "Untitled";
    const session: SessionReference = sessionMeta
      ? {
          path: sessionMeta.path,
          title: resolvedTitle,
          preview: sessionMeta.preview,
          turns: sessionMeta.turns,
          turnsState: sessionMeta.turnsState,
          createdAt: sessionMeta.createdAt,
          lastActivityAt: sessionMeta.lastActivityAt,
        }
      : { path: markerPath || `unknown-session:${markerTitle}`, title: resolvedTitle, preview: resolvedTitle };
    return { id: `edit-session-${idx}`, offset, session };
  });

  return { text: stripped, invocations };
}

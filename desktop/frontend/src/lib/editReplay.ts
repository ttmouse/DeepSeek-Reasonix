import { restoreAttachmentRefsForSubmit } from "./attachmentDisplay";
import { fileKindFromPath, fileSourceFromPath, invocationSegmentsFromMessage, serializeInvocationSubmit, type ComposerInvocation, type FileReference } from "./invocationDisplay";
import { splitSelectedTextContext } from "./selectedTextContext";

function invocationFromSegment(segment: { invocation: { name: string; label: string; kind?: string; path?: string } }, id: string, offset: number): ComposerInvocation {
  if (segment.invocation.kind === "session") {
    return { id, offset, session: { path: segment.invocation.path || "", title: segment.invocation.label } };
  }
  if (segment.invocation.kind === "file") {
    const path = segment.invocation.path || "";
    const file: FileReference = {
      path,
      name: segment.invocation.label,
      kind: fileKindFromPath(path),
      source: fileSourceFromPath(path),
    };
    return { id, offset, file };
  }
  return {
    id,
    offset,
    command: { name: segment.invocation.name, description: "", kind: (segment.invocation.kind as "skill" | "subagent") ?? "skill" },
  };
}

export function replaySubmitText(
  originalSubmitText: string | undefined,
  originalDisplayText: string,
  nextDisplayText: string,
  fallbackSubmitText: string,
): string {
  const originalSubmit = (originalSubmitText ?? "").trim();
  const originalDisplay = originalDisplayText.trim();
  const nextDisplay = nextDisplayText.trim();
  const fallbackSubmit = fallbackSubmitText.trim();
  if (!originalSubmit || originalSubmit === originalDisplay) return fallbackSubmit;
  if (nextDisplay === originalDisplay) return originalSubmit;

  const invocationSegments = invocationSegmentsFromMessage(originalDisplay, originalSubmit);
  const invocationItems = invocationSegments.filter((segment) => segment.type === "invocation");
  if (invocationItems.length > 0) {
    const scale = originalDisplay.length > 0 ? nextDisplay.length / originalDisplay.length : 0;
    const invocations: ComposerInvocation[] = invocationItems.map((segment, index) =>
      invocationFromSegment(segment, `edit-invocation-${index}`, index === 0 ? 0 : Math.min(nextDisplay.length, Math.round(segment.offset * scale))),
    );
    const serialized = serializeInvocationSubmit(fallbackSubmit, invocations).trim();
    // Keep any hidden submit prefix (referenced-session context, memory
    // framing) exactly like the plain-text branch below: the display maps to
    // the serialized slash tail of the original submit, and everything before
    // that tail rides along unchanged. No match (e.g. attachment-expanded
    // tails) falls back to the bare serialized form.
    const originalInvocations: ComposerInvocation[] = invocationItems.map((segment, index) =>
      invocationFromSegment(segment, `edit-invocation-original-${index}`, segment.offset),
    );
    const originalSerialized = serializeInvocationSubmit(originalDisplay, originalInvocations).trim();
    if (originalSerialized && originalSubmit.length > originalSerialized.length && originalSubmit.endsWith(originalSerialized)) {
      return `${originalSubmit.slice(0, originalSubmit.length - originalSerialized.length)}${serialized}`.trim();
    }
    // Session markers live only in the display side of a structured submit
    // (the submit keeps the transcript header + plain text). Matching the
    // marker-stripped tail preserves that header while the serialized form
    // keeps the bubbles visible on replay.
    const strippedSerialized = originalSerialized.replace(/@chat\[[^\]]+\]/g, "").replace(/@file\[[^\]]+\]/g, "").trim();
    if (strippedSerialized && originalSubmit.length > strippedSerialized.length && originalSubmit.endsWith(strippedSerialized)) {
      return `${originalSubmit.slice(0, originalSubmit.length - strippedSerialized.length)}${serialized}`.trim();
    }
    return serialized;
  }

  const originalFallbackSubmit = restoreAttachmentRefsForSubmit(originalDisplay).trim();
  if (originalFallbackSubmit && originalSubmit.endsWith(originalFallbackSubmit)) {
    return `${originalSubmit.slice(0, originalSubmit.length - originalFallbackSubmit.length)}${fallbackSubmit}`.trim();
  }
  return fallbackSubmit;
}

export function replaySubmitTextPreservingSelectedContext(
  originalSubmitText: string | undefined,
  originalDisplayText: string,
  nextDisplayText: string,
  fallbackSubmitText: string,
): string {
  const selected = splitSelectedTextContext(originalSubmitText);
  const replayed = replaySubmitText(
    selected.submitText,
    originalDisplayText,
    nextDisplayText,
    fallbackSubmitText,
  );
  return [replayed, selected.contextBlock].filter(Boolean).join("\n\n");
}

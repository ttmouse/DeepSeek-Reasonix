import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Item } from "./useController";
import {
  beginNavigationSurfaceState,
  markNavigationTargetMasked,
  settleNavigationSurfaceState,
  type NavigationSurfaceState,
} from "./navigationSurfaceTransition";

export type PreservedTranscriptSurface = {
  tabId?: string;
  items: Item[];
  geometrySessionKey?: string;
};

export function useNavigationSurface(target: {
  activeTabId?: string;
  ready: boolean;
  blankIntents?: ReadonlySet<number>;
  backendActivationPending: boolean;
  hydrating: boolean;
  hydrateError?: string;
}) {
  const [surface, setSurface] = useState<NavigationSurfaceState>(null);
  const [preserved, setPreserved] = useState<PreservedTranscriptSurface | null>(null);
  const renderedRef = useRef<PreservedTranscriptSurface | null>(null);
  const intent = surface?.intent ?? null;
  const transitioning = intent !== null;
  // A blank (new-session) surface has no history or live content to reconcile,
  // so the controller build may finish behind the reveal: the target renders
  // an empty page that cannot conflict with anything. blankIntents lets
  // callers release the mask for such surfaces as soon as they are seeded and
  // hydrated, keeping "new session" from waiting on the full controller boot.
  const targetReady = target.ready || target.blankIntents?.has(intent ?? -1) === true;
  const dataReady = Boolean(
    surface?.phase === "target-masked" && target.activeTabId && targetReady &&
    !target.backendActivationPending && !target.hydrating && !target.hydrateError,
  );
  const failed = Boolean(
    surface?.phase === "target-masked" && target.activeTabId &&
    !target.backendActivationPending && !target.hydrating && target.hydrateError,
  );

  const begin = useCallback((nextIntent: number) => {
    const rendered = renderedRef.current;
    flushSync(() => {
      setPreserved(rendered?.items.length ? rendered : null);
      setSurface(beginNavigationSurfaceState(nextIntent));
    });
  }, []);
  const maskTarget = useCallback((completedIntent: number) => {
    setSurface((current) => markNavigationTargetMasked(current, completedIntent));
  }, []);
  const settle = useCallback((completedIntent: number, _outcome: "ready" | "degraded" | "failed") => {
    setSurface((current) => settleNavigationSurfaceState(current, completedIntent));
  }, []);
  const commitPaint = useCallback((completedIntent: number, outcome: "ready" | "degraded") => {
    settle(completedIntent, outcome);
  }, [settle]);

  useEffect(() => {
    if (!failed || intent === null) return;
    settle(intent, "failed");
  }, [failed, intent, settle]);
  useEffect(() => {
    if (surface === null) setPreserved(null);
  }, [surface]);

  return {
    surface,
    intent,
    transitioning,
    dataReady,
    preserved,
    renderedRef,
    begin,
    maskTarget,
    commitPaint,
  };
}

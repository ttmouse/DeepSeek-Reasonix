import { app, onSessionRecovered } from "./bridge";
import { onProjectTreeChangedV2 } from "./sessionCatalogBridge";
import type { ProjectTopicKey } from "./sessionCatalogTypes";
import type { RecoveryLineageView } from "./types";
import {
  normalizeRecoveryLineageView,
  pendingRecoveryMatchesRoots,
  SessionRecoveryDivergenceTracker,
  type PendingSessionRecovery,
} from "./sessionRecoveryVersions";

type SessionRecoveryRuntimeOptions = {
  onRecovered: () => void;
  onDiverged: (topic: ProjectTopicKey, view: RecoveryLineageView) => void;
};

// Recovery is an exceptional path, so App loads this coordinator lazily. Its
// classification is revision-driven; it never sleeps or polls.
export function startSessionRecoveryRuntime(options: SessionRecoveryRuntimeOptions): () => void {
  const tracker = new SessionRecoveryDivergenceTracker();
  const inFlight = new Set<string>();
  let stopped = false;

  const settle = async (pending: PendingSessionRecovery) => {
    if (stopped || inFlight.has(pending.eventKey)) return;
    inFlight.add(pending.eventKey);
    try {
      const view = normalizeRecoveryLineageView(await app.GetRecoveryLineage({
        ...pending.topic,
        recordClassification: true,
      }));
      if (stopped) return;
      const resolution = tracker.resolve(pending.eventKey, view);
      if (resolution === "wait") return;
      if (resolution === "notify") options.onDiverged(pending.topic, view);
    } catch {
      // Catalog rebuilds are transient. Retry only on a later matching
      // project-tree revision.
    } finally {
      inFlight.delete(pending.eventKey);
    }
  };

  const unsubscribeRecovery = onSessionRecovered((event) => {
    const registration = tracker.register(event);
    if (!registration.isNew) return;
    options.onRecovered();
  });
  const unsubscribeCatalog = onProjectTreeChangedV2((event) => {
    for (const pending of tracker.entries()) {
      if (pendingRecoveryMatchesRoots(pending, event.roots)) void settle(pending);
    }
  });

  return () => {
    stopped = true;
    unsubscribeRecovery();
    unsubscribeCatalog();
  };
}

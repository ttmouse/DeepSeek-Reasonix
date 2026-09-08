import { userRowKey, type AssistantItem, type NoticeItem, type TranscriptRow, type TurnModel } from "./transcriptRows";

// The streaming turn renders in Virtuoso's Footer, outside its measured size
// tree. Keep the active user's row in history and preserve every later row's
// visual order in the live region.
export interface TranscriptLiveSplit {
  historyRows: TranscriptRow[];
  liveRows: TranscriptRow[];
  /** True while the live region may need to render its status row. */
  liveActive: boolean;
}

export function assistantAnswerOnly(item: AssistantItem): AssistantItem {
  return { ...item, reasoning: "", reasoningComplete: true, reasoningDurationMs: undefined };
}

export function resolveLiveTurnGrowthFloor(
  previousRowCount: number,
  nextRowCount: number,
  previousHeight: number,
  heldHeight: number | null,
): number | null {
  if (nextRowCount <= previousRowCount || previousHeight <= 0) return heldHeight;
  return Math.max(previousHeight, heldHeight ?? 0);
}

function firstRowKeyForModel(model: TurnModel): string | undefined {
  for (const segment of model.segments) {
    if (segment.displayItems.length > 0) return `ph:${segment.key}`;
    const outside = segment.outsideItems[0];
    if (!outside) continue;
    return outside.kind === "extension" ? `x:${outside.id}` : outside.kind === "notice" ? `n:${outside.id}` : `a:${outside.id}`;
  }
  return undefined;
}

// Model-switch notices confirm an accepted switch and must scroll with history
// even while the turn streams: pinning them to the live footer makes them
// flash on every stream update. Pull them into the history tail instead.
function pullLiveModelSwitchNotices(rows: readonly TranscriptRow[]): TranscriptRow[] {
  return rows.filter((row) => row.kind === "notice" && (row.item as NoticeItem).variant === "model-switch");
}
function withoutLiveModelSwitchNotices(rows: readonly TranscriptRow[]): TranscriptRow[] {
  return rows.filter((row) => !(row.kind === "notice" && (row.item as NoticeItem).variant === "model-switch"));
}

export function splitTranscriptLiveRows(
  models: readonly TurnModel[],
  rows: readonly TranscriptRow[],
  liveId: string | undefined,
  running: boolean,
): TranscriptLiveSplit {
  let activeIndex = -1;
  if (liveId) activeIndex = models.findIndex((model) => model.turnItems.some((item) => item.id === liveId));
  if (activeIndex < 0 && running && models.length > 0) activeIndex = models.length - 1;
  if (activeIndex < 0) return { historyRows: [...rows], liveRows: [], liveActive: false };
  const active = models[activeIndex];
  const activeUser = active.user;
  if (!activeUser) {
    const firstKey = firstRowKeyForModel(active);
    const firstIndex = firstKey ? rows.findIndex((row) => row.key === firstKey) : -1;
    if (!firstKey || firstIndex < 0) return { historyRows: [...rows], liveRows: [], liveActive: true };
    const liveRows = rows.slice(firstIndex);
    return {
      historyRows: [...rows.slice(0, firstIndex), ...pullLiveModelSwitchNotices(liveRows)],
      liveRows: withoutLiveModelSwitchNotices(liveRows),
      liveActive: true,
    };
  }
  const userIndex = rows.findIndex((row) => row.key === userRowKey(activeUser.id));
  if (userIndex < 0) return { historyRows: [...rows], liveRows: [], liveActive: false };
  const liveRows = rows.slice(userIndex + 1);
  return {
    historyRows: [...rows.slice(0, userIndex + 1), ...pullLiveModelSwitchNotices(liveRows)],
    liveRows: withoutLiveModelSwitchNotices(liveRows),
    liveActive: true,
  };
}

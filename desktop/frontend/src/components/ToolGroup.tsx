import { memo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "../lib/i18n";
import { useCollapseAnimation } from "../lib/useCollapseAnimation";
import type { Item } from "../lib/useController";
import { ToolCard } from "./ToolCard";
import { useTranscriptUserResizeIntent } from "./TranscriptLayoutIntentContext";

type ToolItem = Extract<Item, { kind: "tool" }>;

// Only shell output folds into a group in the workbench transcript; the
// explore/modify/delegate groups were part of the removed creation layout.
export type ToolGroupKind = "shell";

const SHELL_TOOLS = new Set(["bash", "bash_output", "wait", "waitJob", "kill_shell"]);

export function toolGroupKind(item: ToolItem): ToolGroupKind | null {
  if (item.parentId || item.name === "todo_write" || item.name === "exit_plan_mode" || item.name === "web_search") return null;
  return SHELL_TOOLS.has(item.name) ? "shell" : null;
}

function count(items: ToolItem[], names: readonly string[]): number {
  return items.filter((item) => names.includes(item.name)).length;
}

function titleFor(kind: ToolGroupKind, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "shell": return t("tools.shellGroup.title");
  }
}

function groupSummary(kind: ToolGroupKind, items: ToolItem[], t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (kind === "shell") {
    const commandCount = count(items, ["bash"]);
    const checkCount = count(items, ["bash_output", "wait", "waitJob"]);
    const stopCount = count(items, ["kill_shell"]);
    const otherCount = items.length - commandCount - checkCount - stopCount;
    if (commandCount > 0) parts.push(t("tools.shellGroup.command", { n: commandCount }));
    if (checkCount > 0) parts.push(t("tools.shellGroup.check", { n: checkCount }));
    if (stopCount > 0) parts.push(t("tools.shellGroup.stop", { n: stopCount }));
    if (otherCount > 0) parts.push(t("tools.shellGroup.other", { n: otherCount }));
  }
  return parts.join(", ");
}

function titleCaseName(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolDisplayName(name: string): string {
  switch (name) {
    case "read_file": return "Read";
    case "ls": return "List";
    case "web_fetch": return "Web Fetch";
    case "web_search": return "Search";
    case "code_index": return "Code Index";
    case "write_file": return "Write";
    case "edit_file": return "Edit";
    case "multi_edit": return "Multi Edit";
    case "move_file": return "Move";
    case "bash": return "Shell";
    case "bash_output": return "Shell Output";
    case "kill_shell": return "Kill Shell";
    case "wait":
    case "waitJob": return "Wait";
    case "use_capability": return "MCP";
    default: return titleCaseName(name);
  }
}

export const ToolGroup = memo(function ToolGroup({
  kind,
  items,
  subcalls,
  tabId,
}: {
  kind: ToolGroupKind;
  items: ToolItem[];
  subcalls: ReadonlyMap<string, ToolItem[]>;
  tabId?: string;
}) {
  const t = useT();
  const beginUserResize = useTranscriptUserResizeIntent();
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useCollapseAnimation(bodyRef, open);

  if (items.length === 0) return null;

  return (
    <div
      className={`tool-group tool-group--${kind}${open ? " tool-group--open" : ""}`}
      data-kind={kind}
      data-entrance={items[0]?.id}
      data-transcript-layout-variant={open ? "tool-group-expanded" : "tool-group-collapsed"}
    >
      <button type="button" className="tool-group__head" onClick={() => { beginUserResize(); setOpen((value) => !value); }} aria-expanded={open}>
        <span className="tool-group__title">{titleFor(kind, t)}</span>
        <span className="tool-group__summary">{groupSummary(kind, items, t)}</span>
        <ChevronRight className={`tool-group__chevron${open ? " tool-group__chevron--open" : ""}`} size={12} />
      </button>
      <div ref={bodyRef} className="tool-group__body">
        {items.map((item) => (
          <ToolCard key={item.id} item={item} subcalls={subcalls.get(item.id)} tabId={tabId} displayName={toolDisplayName(item.name)} />
        ))}
      </div>
    </div>
  );
});

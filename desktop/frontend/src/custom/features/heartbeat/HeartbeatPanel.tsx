// Heartbeat Panel — Modal for configuring scheduled heartbeat tasks.
//
// Renders a list of tasks with add/edit/delete controls, plus a manual
// "run now" button for each. The panel is opened from the sidebar nav item.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Check,
  Filter,
  Folder,
  Globe,
  Heart,
  MessageSquare,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { app } from "../../../lib/bridge";
import { useT } from "../../../lib/i18n";
import { AnchoredPopover } from "../../../components/AnchoredPopover";
import {
  heartbeatListTasks,
  heartbeatSaveTasks,
  heartbeatTriggerNow,
  heartbeatGenerateID,
} from "./heartbeat.bridge";
import type { HeartbeatTask } from "./heartbeat.types";
import type { WorkspaceView } from "../../../lib/types";

interface HeartbeatPanelProps {
  open: boolean;
  onClose: () => void;
  startNew?: boolean;
  onOpenTopic?: (scope: string, workspaceRoot: string, topicId: string) => void;
}

function formatInterval(interval: string): string {
  const cycleMatch = interval.match(/^(\d+)[smh]\|(daily|weekly|biweekly|monthly|yearly)(?::([^@]*))?(?:@(\d{2}:\d{2}))?$/);
  if (cycleMatch) {
    const labels: Record<string, string> = {
      daily: "daily", weekly: "weekly", biweekly: "biweekly",
      monthly: "monthly", yearly: "yearly",
    };
    const days = cycleMatch[3] ? ` ${cycleMatch[3]}` : "";
    return `${labels[cycleMatch[2]]}${days} ${cycleMatch[4] || ""}`;
  }
  const simple = interval.match(/^(\d+)([smh])$/);
  if (simple) {
    return `${simple[1]}${simple[2]}`;
  }
  return interval;
}

function intervalToCron(interval: string, timeWindowStart?: string, timeWindowEnd?: string): string {
  // Try cycle format: 24h|daily@09:00
  const cycleMatch = interval.match(/^\d+[smh]\|(daily|weekly|biweekly|monthly|yearly)(?::([^@]*))?(?:@(\d{2}:\d{2}))?$/);
  if (cycleMatch) {
    const kind = cycleMatch[1];
    const days = cycleMatch[2] || "";
    const time = cycleMatch[3] || "09:00";
    const [h, m] = time.split(":").map(Number);
    const hExpr = timeWindowStart && timeWindowEnd
      ? `${Math.max(0, parseInt(timeWindowStart.split(":")[0]))}-${Math.min(23, parseInt(timeWindowEnd.split(":")[0]))}`
      : h.toString();
    switch (kind) {
      case "daily": return `${m} ${timeWindowStart ? hExpr : h} * * *`;
      case "weekly": {
        const dayMap: Record<string, number> = {mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};
        const d = days.split(",").map(d => dayMap[d.toLowerCase()] ?? "*").join(",");
        return `${m} ${timeWindowStart ? hExpr : h} * * ${d}`;
      }
      case "biweekly": {
        const dayMap2: Record<string, number> = {mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};
        const d = days.split(",").map(d => dayMap2[d.toLowerCase()] ?? "*").join(",");
        return `${m} ${timeWindowStart ? hExpr : h} 1-15 * ${d}`;
      }
      case "monthly": return `${m} ${timeWindowStart ? hExpr : h} ${days || "1"} * *`;
      case "yearly": {
        const [mo, dy] = days.split("-");
        return `${m} ${timeWindowStart ? hExpr : h} ${dy || "1"} ${mo || "1"} *`;
      }
    }
  }
  // Simple duration: 30m, 1h
  const simple = interval.match(/^(\d+)([smh])$/);
  if (simple) {
    const n = parseInt(simple[1]);
    const unit = simple[2];
    const hExpr = timeWindowStart && timeWindowEnd
      ? `${Math.max(0, parseInt(timeWindowStart.split(":")[0]))}-${Math.min(23, parseInt(timeWindowEnd.split(":")[0]))}`
      : "*";
    if (unit === "m") return `*/${n} ${hExpr} * * *`;
    if (unit === "h") return `0 */${n} ${hExpr} * * *`;
    if (unit === "s") return `*/${n} ${hExpr} * * *`;
  }
  // Already cron-looking
  if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(interval.trim())) return interval.trim();
  // Fallback: return as-is
  return interval;
}

function describeCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return "";
  const min = f[0], hour = f[1], dom = f[2], mon = f[3], dow = f[4];

  // Helper: extract hour range from field like "9-22" or "*"
  const hourRange = (h: string): string => {
    if (!h || h === "*") return "";
    if (h.includes("/")) {
      const base = h.split("/")[0];
      if (base.includes("-")) {
        const parts = base.split("-");
        return `${parts[0].padStart(2,"0")}:00-${parts[1].padStart(2,"0")}:00`;
      }
      return "";
    }
    if (h.includes("-")) {
      const parts = h.split("-");
      return `${parts[0].padStart(2,"0")}:00-${parts[1].padStart(2,"0")}:00`;
    }
    return "";
  };
  const wd = hourRange(hour);

  if (min.startsWith("*/") && hour !== "*" && hour.includes("-")) {
    return `每${min.slice(2)}分钟 (${wd})`;
  }
  if (min.startsWith("*/") && hour === "*") return `每 ${min.slice(2)} 分钟`;
  if (min.startsWith("*/") && hour !== "*") return `每${min.slice(2)}分钟 ${wd}`;
  if (min === "0" && hour !== "*" && dom === "*" && mon === "*" && dow === "*") {
    if (hour.includes("/")) return `每 ${hour.replace("*/","")} 小时 ${wd}`.trim();
    if (hour.includes("-")) return `整点 (${wd})`;
    return `在 ${hour.padStart(2,"0")}:00`;
  }
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "整点";
  if (min !== "*" && !min.includes("/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `每小时 ${min} 分`;
  }
  if (dow !== "*" && dow !== "") {
    const weekdays: Record<string, string> = {"0":"周日","1":"周一","2":"周二","3":"周三","4":"周四","5":"周五","6":"周六"};
    const days = dow.split(",").map(d => weekdays[d] || d).join("、");
    const suffix = wd ? ` (${wd})` : "";
    return `${days} ${hour.padStart(2,"0")}:${min.padStart(2,"0")}${suffix}`;
  }
  const suffix = wd ? ` (${wd})` : "";
  return `${hour.padStart(2,"0")}:${min.padStart(2,"0")}${suffix}`;
}

function nextCronRun(expr: string): string | null {
  try {
    const f = expr.trim().split(/\s+/);
    if (f.length !== 5) return null;
    const now = new Date();
    const minTarget = parseInt(f[0]) || 0;
    const hourTarget = parseInt(f[1]) || 0;
    const domTarget = f[2];
    const monTarget = f[3];
    const dowTarget = f[4];

    // Search up to 366 days ahead for the next matching date
    for (let d = 0; d <= 366; d++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hourTarget, minTarget, 0);
      if (candidate <= now) continue;
      // Check day-of-month
      if (domTarget !== "*") {
        const dom = parseInt(domTarget);
        if (!isNaN(dom) && candidate.getDate() !== dom) continue;
      }
      // Check month
      if (monTarget !== "*") {
        const mon = parseInt(monTarget);
        if (!isNaN(mon) && candidate.getMonth() + 1 !== mon) continue;
      }
      // Check day-of-week (simple: supports comma-separated numbers)
      if (dowTarget !== "*") {
        const dayNum = candidate.getDay();
        const dowValues = dowTarget.split(",").map(s => parseInt(s.trim()));
        if (!dowValues.includes(dayNum)) continue;
      }
      return candidate.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    return null;
  } catch {
    return null;
  }
}

export function HeartbeatPanel({ open, onClose, startNew, onOpenTopic }: HeartbeatPanelProps) {
  const t = useT();
  const [tasks, setTasks] = useState<HeartbeatTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<HeartbeatTask | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const statusFilterRef = useRef<HTMLButtonElement>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string> | null>(null);
  const [workspaceMap, setWorkspaceMap] = useState<Record<string, string>>({});
  const backdropRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const [taskList, wsList] = await Promise.all([
        heartbeatListTasks(),
        app.ListWorkspaces(),
      ]);
      setTasks(taskList);
      const map: Record<string, string> = {};
      if (wsList) {
        wsList.forEach((ws) => { if (ws.path) map[ws.path] = ws.name; });
      }
      setWorkspaceMap(map);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setEditing(null);
      setSearchQuery("");
      setStatusFilter("all");
      startedRef.current = false;
      void loadTasks();
    }
  }, [open, loadTasks]);

  // Open directly in add mode when startNew is true
  useEffect(() => {
    if (open && startNew && !startedRef.current) {
      startedRef.current = true;
      void heartbeatGenerateID().then((id) => {
        setEditing({
          id,
          title: "",
          prompt: "",
          interval: "30m",
          enabled: true,
          createdAt: Date.now(),
        });
      });
    }
  }, [open, startNew]);

  const save = useCallback(
    async (next: HeartbeatTask[]) => {
      setTasks(next);
      try {
        await heartbeatSaveTasks(next);
      } catch {
        // ignore
      }
    },
    [],
  );

  const handleAdd = useCallback(async () => {
    const id = await heartbeatGenerateID();
    setEditing({
      id,
      title: "",
      prompt: "",
      interval: "30m",
      enabled: true,
      createdAt: Date.now(),
    });
  }, []);

  const handleAddToScope = useCallback(async (scopeKey: string) => {
    const id = await heartbeatGenerateID();
    const isProject = scopeKey !== "global";
    setEditing({
      id,
      title: "",
      prompt: "",
      interval: "30m",
      enabled: true,
      createdAt: Date.now(),
      scope: isProject ? "project" : "global",
      workspaceRoot: isProject ? scopeKey : "",
    });
  }, []);

  const handleEdit = useCallback((task: HeartbeatTask) => {
    setEditing({ ...task });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const next = tasks.filter((t) => t.id !== id);
      await save(next);
    },
    [tasks, save],
  );

  const handleTrigger = useCallback(
    async (id: string) => {
      await heartbeatTriggerNow(id);
      void loadTasks();
    },
    [loadTasks],
  );

  const handleSaveEdit = useCallback(
    async (task: HeartbeatTask) => {
      const idx = tasks.findIndex((t) => t.id === task.id);
      const next = [...tasks];
      if (idx >= 0) {
        next[idx] = task;
      } else {
        next.push(task);
      }
      await save(next);
      setEditing({ ...task });
    },
    [tasks, save],
  );

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const statusFilterLabel = (filter: string): string => {
    if (filter === "all") return t("heartbeat.filterAll" as any);
    if (filter === "enabled") return t("heartbeat.filterEnabled" as any);
    return t("heartbeat.filterDisabled" as any);
  };

  return (
    <div ref={backdropRef} className="heartbeat-backdrop" onClick={handleBackdrop}>
      <div className="heartbeat-modal">
        <header className="heartbeat-modal__header">
          <Activity size={16} />
          <span>{t("heartbeat.title")}</span>
          <button
            className="heartbeat-modal__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="heartbeat-split">
          {/* ── Left column: task list ── */}
          <div className="heartbeat-split__left">
            <div className="heartbeat-toolbar">
              <div className="heartbeat-toolbar__search heartbeat-toolbar__search--active">
                <Search size={13} className="heartbeat-toolbar__search-icon" />
                <input
                  className="heartbeat-toolbar__search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("heartbeat.searchPlaceholder" as any)}
                />
                {searchQuery && (
                  <button className="heartbeat-toolbar__search-clear" onClick={() => setSearchQuery("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="heartbeat-scope-filter">
                <button
                  ref={statusFilterRef}
                  className={`heartbeat-toolbar__btn heartbeat-toolbar__btn--icon${statusFilter !== "all" ? " heartbeat-toolbar__btn--active" : ""}`}
                  type="button"
                  onClick={() => setStatusFilterOpen((v) => !v)}
                  title={statusFilterLabel(statusFilter)}
                >
                  <Filter size={13} />
                </button>
                <AnchoredPopover
                  open={statusFilterOpen}
                  anchorRef={statusFilterRef}
                  onClose={() => setStatusFilterOpen(false)}
                  className="heartbeat-filter-menu"
                  placement="bottom"
                >
                  <div className="heartbeat-filter-menu__list" role="listbox">
                    {(["all", "enabled", "disabled"] as const).map((key) => (
                      <button
                        key={key}
                        className={`heartbeat-filter-menu__option${statusFilter === key ? " heartbeat-filter-menu__option--selected" : ""}`}
                        role="option"
                        aria-selected={statusFilter === key}
                        type="button"
                        onClick={() => { setStatusFilter(key); setStatusFilterOpen(false); }}
                      >
                        <span>{key === "all" ? t("heartbeat.filterAll" as any) : key === "enabled" ? t("heartbeat.filterEnabled" as any) : t("heartbeat.filterDisabled" as any)}</span>
                        {statusFilter === key && <Check size={12} className="heartbeat-filter-menu__check" />}
                      </button>
                    ))}
                  </div>
                </AnchoredPopover>
              </div>
              <button className="heartbeat-toolbar__btn heartbeat-toolbar__btn--icon" style={{ marginLeft: "auto" }} onClick={handleAdd} title={t("heartbeat.addTask")}>
                <Plus size={14} />
              </button>
            </div>

            <div className="heartbeat-split__list">
              {(() => {
                const filtered = tasks
                  .filter((task) => {
                    if (statusFilter === "enabled" && !task.enabled) return false;
                    if (statusFilter === "disabled" && task.enabled) return false;
                    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                    return true;
                  })
                  .sort((a, b) => {
                    if (a.enabled && !b.enabled) return -1;
                    if (!a.enabled && b.enabled) return 1;
                    return 0;
                  });

                // Group tasks by scope
                const groups = new Map<string, HeartbeatTask[]>();
                for (const task of filtered) {
                  const key = task.scope === "project" && task.workspaceRoot
                    ? task.workspaceRoot : "global";
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(task);
                }

                const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
                  if (a === "global") return -1;
                  if (b === "global") return 1;
                  return (workspaceMap[a] || a).localeCompare(workspaceMap[b] || b);
                });

                const toggleProject = (key: string) => {
                  setExpandedProjects((prev) => {
                    if (prev === null) {
                      return new Set([key]);
                    }
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                };

                const isGroupExpanded = (key: string): boolean => {
                  if (expandedProjects === null) return true;
                  return expandedProjects.has(key);
                };

                return loading ? (
                  <div className="heartbeat-empty">
                    <Heart size={24} className="heartbeat-pulse" />
                    <span>{t("workspace.loading")}</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="heartbeat-empty">
                    <Heart size={24} />
                    <span>{tasks.length === 0 ? t("heartbeat.noTasks") : "没有匹配的任务"}</span>
                  </div>
                ) : (
                  <div className="worktree-tree">
                    {sortedGroups.map(([key, groupTasks]) => {
                      const isExpanded = isGroupExpanded(key);
                      const label = key === "global"
                        ? "全局"
                        : workspaceMap[key] || key.split("/").pop() || key;

                      return (
                        <div key={key}>
                          {/* ── Group header (depth 0: 8px indent) ── */}
                          <div
                            className={`worktree-node worktree-node--scope${editing && groupTasks.some(t => t.id === editing.id) ? " worktree-node--scope-active" : ""}`}
                            style={{ paddingLeft: "8px" }}
                            onClick={() => toggleProject(key)}
                          >
                            <span className="worktree-node__icon">
                              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </span>
                            <span className="worktree-node__marker">
                              {key === "global" ? <Globe size={13} /> : <Folder size={13} />}
                            </span>
                            <span className="worktree-node__label">{label}</span>
                            <span className="worktree-node__scope-add" onClick={(e) => { e.stopPropagation(); void handleAddToScope(key); }} title={`在 ${label} 中添加任务`}>
                              <Plus size={12} strokeWidth={2.5} />
                            </span>
                          </div>

                          {/* ── Tasks under group (depth 1: 14 + 16 = 30px indent) ── */}
                          {isExpanded && groupTasks.map((task) => {
                            const isSelected = editing?.id === task.id;
                            return (
                              <div
                                key={task.id}
                                className={`worktree-node worktree-node--task${isSelected ? " worktree-node--selected" : ""}`}
                                style={{ paddingLeft: "21px" }}
                                onClick={() => handleEdit(task)}
                              >
                                <span className="worktree-node__marker">
                                  <span className={`worktree-node__dot${task.enabled ? " worktree-node__dot--on" : ""}`} />
                                </span>
                                <span className="worktree-node__label">{task.title || "(untitled)"}</span>
                                <span className="worktree-node__tail">
                                  <span className="worktree-node__interval">{formatInterval(task.interval)}</span>
                                  <span className="worktree-node__actions">
                                  <button
                                    className="worktree-node__action-btn"
                                    onClick={(e) => { e.stopPropagation(); void handleTrigger(task.id); }}
                                    title="立即运行"
                                  >
                                    <Play size={14} strokeWidth={1.9} />
                                  </button>
                                  <button
                                    className="worktree-node__action-btn"
                                    type="button"
                                    disabled={!task.topicId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (task.topicId && onOpenTopic) {
                                        onClose();
                                        onOpenTopic(task.scope || "global", task.workspaceRoot || "", task.topicId);
                                      }
                                    }}
                                    title={task.topicId ? "打开对话" : ""}
                                  >
                                    <MessageSquare size={14} strokeWidth={1.9} />
                                  </button>
                                </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

          </div>

          {/* ── Vertical divider ── */}
          <div className="heartbeat-split__divider" />

          {/* ── Right column: detail / editor ── */}
          <div className="heartbeat-split__right">
            {editing ? (
              <TaskEditor key={editing.id} task={editing} onSave={handleSaveEdit} onCancel={() => setEditing(null)} onDelete={() => { handleDelete(editing.id); setEditing(null); }} />
            ) : (
              <div className="heartbeat-split__empty">
                <div className="heartbeat-split__empty-inner">
                  <Activity size={28} />
                  <span>{t("heartbeat.noSelection" as any) || "选择一个任务查看详情"}</span>
                  <span className="heartbeat-split__empty-hint">{t("heartbeat.configHint")}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task Card (kept for reference, no longer rendered in tree view) ──
/*
function TaskCard({
  task,
  scopeLabel,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onTrigger,
  onOpenTopic,
  onClose,
}: {
  task: HeartbeatTask;
  scopeLabel: string;
  selected?: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onTrigger: () => void;
  onOpenTopic: (scope: string, workspaceRoot: string, topicId: string) => void;
  onClose: () => void;
}) {
  const t = useT();

  // Parse interval for display and next-run calculation
  const intervalLabel = (() => {
    const clean = task.interval.replace(/\|.*$/, "");
    const m = clean.match(/^(\d+)([smh])$/);
    if (!m) return clean;
    const unitMap: Record<string, string> = { s: "s", m: "m", h: "h" };
    return `${m[1]}${unitMap[m[2]] || m[2]}`;
  })();

  const nextRunLabel = (() => {
    if (!task.enabled) return t("heartbeat.disabled");
    const clean = task.interval.replace(/\|.*$/, "");
    const m = clean.match(/^(\d+)([smh])$/);
    if (!m) return "";
    const ms = parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2] as "s" | "m" | "h"];
    if (!task.lastRunAt) return t("heartbeat.neverRun");
    const next = task.lastRunAt + ms;
    const now = Date.now();
    const diff = next - now;
    if (diff <= 0) return t("heartbeat.due" as any);
    if (diff < 60000) return t("heartbeat.soon" as any);
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${t("heartbeat.minLater" as any)}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t("heartbeat.hourLater" as any)}`;
    const d = new Date(next);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  })();

  const lastRunLabel = task.lastRunAt
    ? (() => {
        const d = new Date(task.lastRunAt);
        const now = new Date();
        const diff = now.getTime() - task.lastRunAt;
        if (diff < 60000) return t("heartbeat.justNow" as any);
        if (diff < 3600000) return `${Math.floor(diff / 60000)}${t("heartbeat.minAgo" as any)}`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t("heartbeat.hourAgo" as any)}`;
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
      })()
    : t("heartbeat.neverRun");

  return (
    <li className={`heartbeat-card${!task.enabled ? " heartbeat-card--disabled" : ""}${selected ? " heartbeat-card--selected" : ""}`}>
      <div className="heartbeat-card__head" onClick={onSelect} style={{ cursor: "pointer" }}>
        <span className={`heartbeat-card__dot${task.enabled ? " heartbeat-card__dot--on" : ""}`} />
        <span className="heartbeat-card__title">
          <button
            type="button"
            className="heartbeat-card__title-btn"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <span className="heartbeat-card__title-text">{task.title || t("heartbeat.untitled")}</span>
            <span className="heartbeat-card__title-scope">{scopeLabel}</span>
          </button>
        </span>
        <span className="heartbeat-card__meta-item heartbeat-card__meta-item--compact">
          <Clock size={10} />
          {intervalLabel}
          <span className="heartbeat-card__meta-sep">·</span>
          {task.enabled ? nextRunLabel : lastRunLabel}
        </span>
        <span className="heartbeat-card__head-actions">
          <button
            className="heartbeat-card__open-btn heartbeat-card__open-btn--play"
            onClick={(e) => { e.stopPropagation(); onTrigger(); }}
            title={t("heartbeat.runNow")}
          >
            <Play size={12} />
          </button>
          <button
            className="heartbeat-card__open-btn"
            type="button"
            disabled={!task.topicId}
            onClick={(e) => {
              e.stopPropagation();
              if (task.topicId) {
                onClose();
                onOpenTopic(task.scope || "global", task.workspaceRoot || "", task.topicId);
              }
            }}
            title={task.topicId ? (t("heartbeat.openTopic" as any)) : ""}
          >
            <MessageSquare size={13} />
          </button>
          <button
            className={`heartbeat-card__toggle${task.enabled ? " heartbeat-card__toggle--on" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={task.enabled ? t("heartbeat.disable") : t("heartbeat.enabled")}
          >
            <span className="heartbeat-card__toggle-knob" />
          </button>
        </span>
      </div>
    </li>
  );
}
*/

// ── Cycle Editor ──────────────────────────────────────────────────────────────

const WEEKDAYS = [
  { key: "mon", label: "周一" },
  { key: "tue", label: "周二" },
  { key: "wed", label: "周三" },
  { key: "thu", label: "周四" },
  { key: "fri", label: "周五" },
  { key: "sat", label: "周六" },
  { key: "sun", label: "周日" },
] as const;

function CycleEditor({
  draft,
  setDraft,
}: {
  draft: HeartbeatTask;
  setDraft: (field: keyof HeartbeatTask, value: string | boolean) => void;
}) {
  const t = useT();
  const cycleMatch = draft.interval.match(/^(\d+)[smh]\|(daily|weekly|biweekly|monthly|yearly)(?::([^@]*))?(?:@(\d{2}:\d{2}))?$/);
  const [cycleType, setCycleType] = useState<string>(
    cycleMatch ? cycleMatch[2] : "daily"
  );
  const cycleDays = cycleMatch?.[3] || "";
  const cycleTime = cycleMatch?.[4] || "09:00";
  const [selectedDays, setSelectedDays] = useState<string[]>(
    cycleDays ? cycleDays.split(",") : ["mon","tue","wed","thu","fri","sat","sun"]
  );
  const [monthDay, setMonthDay] = useState(cycleDays || "1");
  const [yearMonth, setYearMonth] = useState(cycleDays.split("-")[0] || "1");
  const [yearDay, setYearDay] = useState(cycleDays.split("-")[1] || "1");
  const [timeVal, setTimeVal] = useState(cycleTime);
  const [cycleOpen, setCycleOpen] = useState(false);
  const cycleRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!cycleOpen) return;
    const close = (e: MouseEvent) => {
      if (cycleRef.current && !cycleRef.current.contains(e.target as Node)) {
        setCycleOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [cycleOpen]);

  // Build interval string when config changes
  const buildInterval = useCallback((ct: string, days: string[], tm: string) => {
    const base: Record<string, string> = {
      daily: "24h",
      weekly: "168h",
      biweekly: "336h",
      monthly: "720h",
      yearly: "8760h",
    };
    let suffix = `|${ct}`;
    if (ct === "daily" || ct === "weekly" || ct === "biweekly") {
      suffix += `:${days.join(",")}`;
    } else if (ct === "monthly") {
      suffix += `:${days[0] || "1"}`;
    } else if (ct === "yearly") {
      // days[0] = month, days[1] = day — each is a plain number, no dash
      suffix += `:${days[0] || "1"}-${days[1] || "1"}`;
    }
    suffix += `@${tm}`;
    return (base[ct] || "24h") + suffix;
  }, []);

  const onCycleTypeChange = useCallback((ct: string) => {
    setCycleType(ct);
    const days: string[] = [];
    setSelectedDays(days);
    setMonthDay("1");
    setYearMonth("1");
    setYearDay("1");
    if (ct !== "daily" && ct !== "weekly" && ct !== "biweekly") {
      setSelectedDays([]);
    }
    setDraft("interval", buildInterval(ct, days, timeVal));
  }, [buildInterval, setDraft, timeVal]);

  const onDayToggle = useCallback((day: string) => {
    setSelectedDays((prev) => {
      const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      setDraft("interval", buildInterval(cycleType, next, timeVal));
      return next;
    });
  }, [buildInterval, cycleType, setDraft, timeVal]);

  const onMonthDayChange = useCallback((d: string) => {
    setMonthDay(d);
    setDraft("interval", buildInterval(cycleType, [d], timeVal));
  }, [buildInterval, cycleType, setDraft, timeVal]);

  const onYearMonthChange = useCallback((m: string) => {
    setYearMonth(m);
    setDraft("interval", buildInterval(cycleType, [m, yearDay], timeVal));
  }, [buildInterval, cycleType, setDraft, timeVal, yearDay]);

  const onYearDayChange = useCallback((d: string) => {
    setYearDay(d);
    setDraft("interval", buildInterval(cycleType, [yearMonth, d], timeVal));
  }, [buildInterval, cycleType, setDraft, timeVal, yearMonth]);

  const onTimeChange = useCallback((tm: string) => {
    setTimeVal(tm);
    const days = cycleType === "daily" || cycleType === "weekly" || cycleType === "biweekly" ? selectedDays
      : cycleType === "monthly" ? [monthDay]
      : cycleType === "yearly" ? [yearMonth, yearDay]
      : [];
    setDraft("interval", buildInterval(cycleType, days, tm));
  }, [buildInterval, cycleType, selectedDays, monthDay, yearMonth, yearDay, setDraft]);

  const MONTHS = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}月`,
  }));
  const DAYS = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}日`,
  }));

  return (
    <div className="heartbeat-editor__cycle-wrap">
      <div className="heartbeat-editor__cycle-row">
        <div className="heartbeat-scope-wrap" ref={cycleRef}>
          <button
            className="heartbeat-scope-select"
            onClick={() => setCycleOpen((v) => !v)}
          >
            {t(`heartbeat.cycle${cycleType.charAt(0).toUpperCase() + cycleType.slice(1)}` as any)}
            <ChevronsUpDown size={12} />
          </button>
          {cycleOpen && (
            <div className="heartbeat-project-menu heartbeat-project-menu--up">
              {["daily", "weekly", "biweekly", "monthly", "yearly"].map((ct) => (
                <button
                  key={ct}
                  className={`heartbeat-project-menu__item${cycleType === ct ? " heartbeat-project-menu__item--active" : ""}`}
                  onClick={() => { onCycleTypeChange(ct); setCycleOpen(false); }}
                >
                  {t(`heartbeat.cycle${ct.charAt(0).toUpperCase() + ct.slice(1)}` as any)}
                  {cycleType === ct && <Check size={12} className="heartbeat-filter-menu__check" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {cycleType === "monthly" && (
          <select
            className="heartbeat-editor__freq-select"
            value={monthDay}
            onChange={(e) => onMonthDayChange(e.target.value)}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        )}

        {cycleType === "yearly" && (
          <>
            <select
              className="heartbeat-editor__freq-select"
              value={yearMonth}
              onChange={(e) => onYearMonthChange(e.target.value)}
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              className="heartbeat-editor__freq-select"
              value={yearDay}
              onChange={(e) => onYearDayChange(e.target.value)}
            >
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </>
        )}

        <input
          className="heartbeat-editor__freq-input heartbeat-editor__freq-input--time"
          type="time"
          value={timeVal}
          onChange={(e) => onTimeChange(e.target.value)}
        />

        {(cycleType === "weekly" || cycleType === "biweekly") && (
          <div className="set-seg">
            {WEEKDAYS.map((wd) => (
              <button
                key={wd.key}
                type="button"
                className={`set-seg__btn${selectedDays.includes(wd.key) ? " set-seg__btn--on" : ""}`}
                onClick={() => onDayToggle(wd.key)}
                aria-pressed={selectedDays.includes(wd.key)}
              >
                {wd.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────────

function normalizeMode(mode: "ask" | "auto" | "yolo" | undefined): "ask" | "auto" | "yolo" {
  if (mode === "ask" || mode === "auto" || mode === "yolo") return mode;
  return "yolo"; // default
}

function TaskEditor({
  task,
  onSave,
  onCancel,
  onDelete,
}: {
  task: HeartbeatTask;
  onSave: (t: HeartbeatTask) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const titleRef = useRef<HTMLInputElement>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    app.ListWorkspaces().then((list) => setWorkspaces(list ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectOpen) return;
    const close = (e: MouseEvent) => {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setProjectOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [projectOpen]);

  const [draft, setDraft] = useState(task);
  const set = useCallback((field: keyof HeartbeatTask, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Detect frequency type from interval value
  const [freqType, setFreqType] = useState<"cycle" | "interval" | "cron">(
    task.interval.includes("|") ? "cycle" : "interval"
  );

  const isNew = !task.createdAt;
  const selectedWorkspace = draft.scope === "project" && draft.workspaceRoot
    ? workspaces.find((w) => w.path === draft.workspaceRoot)
    : null;

  const isDirty = draft.title !== task.title || draft.prompt !== task.prompt || draft.interval !== task.interval || draft.enabled !== task.enabled || draft.scope !== task.scope || draft.workspaceRoot !== task.workspaceRoot || draft.approvalMode !== task.approvalMode || draft.newConversationEachRun !== task.newConversationEachRun || draft.timeWindowStart !== task.timeWindowStart || draft.timeWindowEnd !== task.timeWindowEnd;

  return (
    <div className="heartbeat-editor">
      {/* Title */}
      <div className="heartbeat-editor__field">
        <input
          ref={titleRef}
          className="heartbeat-editor__input"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("heartbeat.titlePlaceholder")}
        />
      </div>

      {/* Scope */}
      <div className="heartbeat-editor__field">
        <label>项目</label>
        <div className="heartbeat-scope-wrap" ref={projectRef}>
          <button
            className="heartbeat-scope-select"
            onClick={() => setProjectOpen((v) => !v)}
          >
            {selectedWorkspace ? selectedWorkspace.name : t("heartbeat.scopeGlobal")}
            <ChevronsUpDown size={12} />
          </button>
          {projectOpen && (
            <div className="heartbeat-project-menu">
              {workspaces.length === 0 ? (
                <div className="heartbeat-project-menu__empty">{t("heartbeat.noProjects")}</div>
              ) : (
                <>
                  <button
                    className={`heartbeat-project-menu__item${!draft.scope || draft.scope === "global" || !draft.workspaceRoot ? " heartbeat-project-menu__item--active" : ""}`}
                    onClick={() => {
                      setDraft((prev) => ({ ...prev, scope: "global", workspaceRoot: "" }));
                      setProjectOpen(false);
                    }}
                  >
                    {t("heartbeat.scopeGlobal")}
                    {(!draft.scope || draft.scope === "global" || !draft.workspaceRoot) && <Check size={12} className="heartbeat-filter-menu__check" />}
                  </button>
                  {workspaces.map((ws) => (
                    <button
                      key={ws.path}
                      className={`heartbeat-project-menu__item${draft.workspaceRoot === ws.path ? " heartbeat-project-menu__item--active" : ""}`}
                      onClick={() => {
                        setDraft((prev) => ({ ...prev, scope: "project", workspaceRoot: ws.path }));
                        setProjectOpen(false);
                      }}
                    >
                      {ws.name}
                      {ws.current && <span className="heartbeat-project-menu__current">{t("heartbeat.currentWorkspace")}</span>}
                      {draft.workspaceRoot === ws.path && <Check size={12} className="heartbeat-filter-menu__check" />}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Prompt */}
      <div className="heartbeat-editor__field">
        <label>{t("heartbeat.fieldPrompt")}</label>
        <textarea
          className="heartbeat-editor__textarea"
          value={draft.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder={t("heartbeat.promptPlaceholder")}
          rows={5}
        />
      </div>

      {/* Approval Mode */}
      <div className="heartbeat-editor__field">
        <label>{t("heartbeat.fieldApprovalMode")}</label>
        <div className="set-seg" style={{ alignSelf: "flex-start" }}>
          <button
            className={`set-seg__btn${normalizeMode(draft.approvalMode) === "ask" ? " set-seg__btn--on" : ""}`}
            onClick={() => setDraft((prev) => ({ ...prev, approvalMode: "ask" }))}
            title={t("heartbeat.approvalModeAskTooltip")}
          >
            {t("heartbeat.approvalModeAsk")}
          </button>
          <button
            className={`set-seg__btn${normalizeMode(draft.approvalMode) === "auto" ? " set-seg__btn--on" : ""}`}
            onClick={() => setDraft((prev) => ({ ...prev, approvalMode: "auto" }))}
            title={t("heartbeat.approvalModeAutoTooltip")}
          >
            {t("heartbeat.approvalModeAuto")}
          </button>
          <button
            className={`set-seg__btn${normalizeMode(draft.approvalMode) === "yolo" ? " set-seg__btn--on" : ""}`}
            onClick={() => setDraft((prev) => ({ ...prev, approvalMode: "yolo" }))}
            title={t("heartbeat.approvalModeYoloTooltip")}
          >
            {t("heartbeat.approvalModeYolo")}
          </button>
        </div>
        <span className="heartbeat-editor__mode-hint">
          {normalizeMode(draft.approvalMode) === "yolo" ? t("heartbeat.approvalModeYoloHint") :
           normalizeMode(draft.approvalMode) === "auto" ? t("heartbeat.approvalModeAutoHint") :
           t("heartbeat.approvalModeAskHint")}
        </span>
      </div>

      {/* New conversation per run */}
      <div className="heartbeat-editor__field">
        <label>{t("heartbeat.fieldNewConversation")}</label>
        <div className="set-seg" style={{ alignSelf: "flex-start" }}>
          <button
            className={`set-seg__btn${!draft.newConversationEachRun ? " set-seg__btn--on" : ""}`}
            onClick={() => setDraft((prev) => ({ ...prev, newConversationEachRun: false }))}
          >
            {t("heartbeat.newConversationEachRunOff")}
          </button>
          <button
            className={`set-seg__btn${draft.newConversationEachRun ? " set-seg__btn--on" : ""}`}
            onClick={() => setDraft((prev) => ({ ...prev, newConversationEachRun: true }))}
          >
            {t("heartbeat.newConversationEachRunOn")}
          </button>
        </div>
      </div>

      {/* Frequency */}
      <div className="heartbeat-editor__field">
        <label>{t("heartbeat.fieldInterval")}</label>
        <div className="set-seg" style={{ alignSelf: "flex-start" }}>
          <button
            className={`set-seg__btn${freqType === "interval" ? " set-seg__btn--on" : ""}`}
            onClick={() => {
              setFreqType("interval");
              // Try to reverse-convert cron to interval
              const cronToInterval = (cron: string): string => {
                const f = cron.trim().split(/\s+/);
                if (f.length !== 5) return "30m";
                const min = f[0], hour = f[1];
                if (min.startsWith("*/")) return `${min.slice(2)}m`;
                if (min === "0" && hour.startsWith("*/")) return `${hour.slice(2)}h`;
                if (min === "0") return "1h";
                return "30m";
              };
              if (/[\s|]/.test(draft.interval) || !/^\d+[smh]$/.test(draft.interval)) {
                setDraft((prev) => ({ ...prev, interval: cronToInterval(draft.interval) }));
              }
            }}
          >
            {t("heartbeat.freqInterval")}
          </button>
          <button
            className={`set-seg__btn${freqType === "cycle" ? " set-seg__btn--on" : ""}`}
            onClick={() => {
              setFreqType("cycle");
              // Initialize interval to daily schedule when switching to cycle mode
              if (!draft.interval.includes("|")) {
                setDraft((prev) => ({ ...prev, interval: "24h|daily@09:00" }));
              }
            }}
          >
            {t("heartbeat.freqCycle")}
          </button>
          <button
            className={`set-seg__btn${freqType === "cron" ? " set-seg__btn--on" : ""}`}
            onClick={() => {
              setFreqType("cron");
              if (draft.interval && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(draft.interval.trim())) {
                setDraft((prev) => ({ ...prev, interval: intervalToCron(prev.interval, prev.timeWindowStart, prev.timeWindowEnd) }));
              }
            }}
          >
            {t("heartbeat.freqCron")}
          </button>
        </div>

        {freqType === "cycle" ? <CycleEditor draft={draft} setDraft={set} /> :
         freqType === "cron" ? (
          <div className="heartbeat-editor__freq-interval">
            <input
              className="heartbeat-editor__freq-input heartbeat-editor__freq-input--cron"
              value={draft.interval}
              onChange={(e) => setDraft((prev) => ({ ...prev, interval: e.target.value }))}
              placeholder="0 * * * *"
            />
            <span className="heartbeat-editor__cron-hint">
              {describeCron(draft.interval)}{nextCronRun(draft.interval) ? ` · 下次运行: ${nextCronRun(draft.interval)}` : ""}
            </span>
          </div>
        ) : (
          <div className="heartbeat-editor__freq-interval">
            <span className="heartbeat-editor__freq-label">{t("heartbeat.freqEvery")}</span>
            <input
              className="heartbeat-editor__freq-input"
              value={(() => {
                const m = draft.interval.match(/^(\d+)/);
                return m ? m[1] : "1";
              })()}
              onChange={(e) => {
                const num = e.target.value.replace(/\D/g, "");
                const mUnit = draft.interval.match(/^(\d+)([smh])/);
                const unit = mUnit ? mUnit[2] : "h";
                setDraft((prev) => ({ ...prev, interval: num ? num + unit : "1" + unit }));
              }}
              placeholder="1"
            />
            <div className="set-seg">
              <button
                className={`set-seg__btn${(() => {
                  const m = draft.interval.match(/^(\d+)([smh])/);
                  return (m ? m[2] : "h") === "m" ? " set-seg__btn--on" : "";
                })()}`}
                onClick={() => {
                  const num = draft.interval.match(/^(\d+)/)?.[1] || "1";
                  setDraft((prev) => ({ ...prev, interval: num + "m" }));
                }}
              >
                {t("heartbeat.unitMin")}
              </button>
              <button
                className={`set-seg__btn${(() => {
                  const m = draft.interval.match(/^(\d+)([smh])/);
                  return (m ? m[2] : "h") === "h" ? " set-seg__btn--on" : "";
                })()}`}
                onClick={() => {
                  const num = draft.interval.match(/^(\d+)/)?.[1] || "1";
                  setDraft((prev) => ({ ...prev, interval: num + "h" }));
                }}
              >
                {t("heartbeat.unitHour")}
              </button>
            </div>
            {draft.timeWindowStart || draft.timeWindowEnd ? (
              <div className="heartbeat-editor__tw-inputs" style={{ marginLeft: "8px" }}>
                <input
                  className="heartbeat-editor__freq-input heartbeat-editor__freq-input--time"
                  type="time"
                  value={draft.timeWindowStart || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, timeWindowStart: e.target.value || undefined }))}
                  style={{ width: "90px" }}
                />
                <span className="heartbeat-editor__freq-label heartbeat-editor__tw-sep">—</span>
                <input
                  className="heartbeat-editor__freq-input heartbeat-editor__freq-input--time"
                  type="time"
                  value={draft.timeWindowEnd || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, timeWindowEnd: e.target.value || undefined }))}
                  style={{ width: "90px" }}
                />
                <button
                  className="heartbeat-editor__tw-remove"
                  onClick={() => setDraft((prev) => ({ ...prev, timeWindowStart: undefined, timeWindowEnd: undefined }))}
                  title="移除时间区间"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <span className="heartbeat-editor__tw-add" style={{ marginLeft: "8px" }}
                onClick={() => setDraft((prev) => ({ ...prev, timeWindowStart: "09:00", timeWindowEnd: "17:00" }))}
              >
                + {t("heartbeat.timeWindow")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="heartbeat-editor__actions">
        {!isNew && (
          <button
            className={`heartbeat-btn${confirmingDelete ? "" : " heartbeat-btn--danger"}`}
            onClick={() => {
              if (confirmingDelete) {
                onDelete();
              } else {
                setConfirmingDelete(true);
              }
            }}
          >
            <Trash2 size={13} />
            {confirmingDelete ? t("heartbeat.confirmDelete") : t("heartbeat.delete")}
          </button>
        )}
        <button
          className="heartbeat-btn"
          onClick={() => {
            const updated = { ...draft, enabled: !draft.enabled };
            setDraft(updated);
            onSave(updated);
          }}
        >
          {draft.enabled ? t("heartbeat.disable") : t("heartbeat.enabled")}
        </button>
        <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button
            className={`heartbeat-btn${isDirty ? " heartbeat-btn--primary" : ""}`}
            onClick={() => onSave(draft)}
            disabled={!draft.title.trim() || !draft.prompt.trim() || (!isDirty && !isNew)}
          >
            {isNew ? t("heartbeat.add") : t("heartbeat.save")}
          </button>
          <button className="heartbeat-btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </span>
      </div>
    </div>
  );
}

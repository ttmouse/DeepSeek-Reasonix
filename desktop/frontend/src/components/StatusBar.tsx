import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import { useI18n, SPINNER_WORDS } from "../lib/i18n";
import type { BalanceInfo, ContextInfo, JobView, WireUsage } from "../lib/types";

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

// JobsChip is the status-bar background-jobs indicator: a count that opens an
// upward popover listing the running jobs (id · label · status), mirroring the
// ModelSwitcher's click-to-open pattern. With no jobs it still reserves a stable
// "任务 0" slot so the IDE-style status order does not jump.
function JobsChip({ jobs }: { jobs: JobView[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  }, [open]);
  if (jobs.length === 0) {
    return null;
  }
  return (
    <div className="statusbar__jobswrap" ref={wrapRef}>
      <Tooltip label={t("status.jobsTitle")}>
        <button className="stat statusbar__jobs statusbar__jobbtn" onClick={() => setOpen((v) => !v)}>
          {t("status.jobsLabel")}{jobs.length}
        </button>
      </Tooltip>
      {open && (
        <div className="modelsw__menu jobsmenu" role="listbox">
          <div className="jobsmenu__head">{t("status.jobsTitle")}</div>
          {jobs.map((j) => (
            <div className="jobsmenu__item" key={j.id} role="option">
              <span className="jobsmenu__id">{j.id}</span>
              <span className="jobsmenu__label">{j.label || j.kind}</span>
              <span className="jobsmenu__status">{j.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRate(hit: number, denom: number): string | null {
  if (denom <= 0) return null;
  return ((hit / denom) * 100).toFixed(2);
}

// nowRate is the SINGLE-TURN prompt cache-hit % (latest turn) — the higher,
// steeper number on a non-compacting DeepSeek session. null when nothing yet.
function nowRate(u?: WireUsage): string | null {
  if (!u) return null;
  let denom = u.cacheHitTokens + u.cacheMissTokens;
  if (denom === 0) denom = u.promptTokens;
  return formatRate(u.cacheHitTokens, denom);
}

// avgRate is the SESSION-AGGREGATE cache-hit % — Σhit/Σ(hit+miss) across every
// turn — the steadier, cost-oriented number that matches the legacy dashboard.
function avgRate(u?: WireUsage): string | null {
  if (!u) return null;
  const denom = u.sessionCacheHitTokens + u.sessionCacheMissTokens;
  return formatRate(u.sessionCacheHitTokens, denom);
}

function currencySymbol(currency?: string): string {
  const value = (currency || "¥").trim();
  if (/^(cny|rmb|yuan)$/i.test(value)) return "¥";
  if (/^(usd|dollar)$/i.test(value)) return "$";
  return value || "¥";
}

function formatMoney(amount?: number, currency?: string): string {
  const symbol = currencySymbol(currency);
  if (typeof amount !== "number" || amount <= 0) return `${symbol}0.0000`;
  return `${symbol}${amount < 1 ? amount.toFixed(4) : amount.toFixed(2)}`;
}

export function StatusBar({
  context,
  usage,
  balance,
  jobs,
  running,
  cost,
  currency,
  turnTokens,
  currentTurnCount,
  turnStartAt,
  retry,
}: {
  context: ContextInfo;
  usage?: WireUsage;
  balance?: BalanceInfo;
  jobs?: JobView[];
  running: boolean;
  cost?: number;
  currency?: string;
  turnTokens?: number;
  currentTurnCount?: number;
  turnStartAt?: number;
  retry?: { attempt: number; max: number };
}) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const pct = context.window ? Math.min(100, Math.round((context.used / context.window) * 100)) : null;
  const nowPct = nowRate(usage);
  const jobsList = jobs ?? [];
  const costLabel = formatMoney(cost, currency);
  const balanceLabel = balance?.available && balance.display ? balance.display : "-";

  // 详细数据悬浮显示
  const compactPct = context.compactRatio ? Math.round(context.compactRatio * 100) : null;
  const avgPct = avgRate(usage);
  const detailItems = [
    compactPct !== null ? `${t("status.compactLabel")} ${compactPct}%` : "",
  ].filter(Boolean).join(" · ");

  // 生成中文字
  const runActivity = retry
    ? t("status.retrying", { attempt: retry.attempt, max: retry.max })
    : running && turnStartAt
      ? (() => {
          const elapsedMs = Math.max(0, now - turnStartAt);
          const words = SPINNER_WORDS[locale];
          const word = words[Math.floor(elapsedMs / 3000) % words.length];
          return `${word}… ${elapsedMs >= 60000 ? Math.floor(elapsedMs / 60000) + "m " + Math.floor((elapsedMs % 60000) / 1000) + "s" : (elapsedMs / 1000).toFixed(1) + "s"}`;
        })()
      : null;
  const runTokenInfo = (turnTokens ?? 0) > 0
    ? `↓ ${fmtTokens(turnTokens ?? 0)} ${t("status.tokens")}`
    : null;

  return (
    <div className="statusbar">
      {typeof currentTurnCount === "number" && currentTurnCount > 0 && (
        <Tooltip label={t("status.sessionTurnsTitle")}>
          <span className="stat statusbar__turns">{t(currentTurnCount === 1 ? "history.turnOne" : "history.turnOther", { n: currentTurnCount })}</span>
        </Tooltip>
      )}
      <Tooltip label={detailItems || t("status.ctxLabel")}>
        <span className="stat statusbar__ctx">{t("status.ctxLabel")} {pct !== null ? `${pct}%` : "-"}</span>
      </Tooltip>
      <Tooltip label={avgPct !== null ? `${t("status.cacheAvgLabel")} ${avgPct}%` : t("status.cacheLabel")}>
        <span className="stat statusbar__cache">{t("status.cacheLabel")} {nowPct !== null ? `${nowPct}%` : "-"}</span>
      </Tooltip>
      <span className="stat statusbar__cost">{t("status.costLabel")} {costLabel}</span>
      <span className="stat statusbar__balance">{t("status.balanceLabel")} {balanceLabel}</span>
      <JobsChip jobs={jobsList} />
      <span className="statusbar__spacer" />
      {runActivity && <span className="statusbar__spinner">{runActivity}</span>}
      {runTokenInfo && <span className="statusbar__tokens">{runTokenInfo}</span>}
    </div>
  );
}

// BackgroundJobsChip surfaces the active controller jobs and background
// runtimes as one trigger with a stop-capable popover. Shared by the session
// overview header (formerly the status bar's jobs chip).
import { useEffect, useRef, useState } from "react";
import { Activity, Square } from "lucide-react";
import { AnchoredPopover } from "./AnchoredPopover";
import { useI18n } from "../lib/i18n";
import type { BackgroundRuntimeView, JobView } from "../lib/types";

export function BackgroundJobsChip({
  jobs,
  onCancelJob,
  runtimes,
  onCancelRuntimeJob,
  onRevealRuntime,
}: {
  jobs: JobView[];
  onCancelJob?: (jobID: string) => Promise<boolean>;
  runtimes: BackgroundRuntimeView[];
  onCancelRuntimeJob?: (tabID: string, jobID: string) => Promise<boolean>;
  onRevealRuntime?: (tabID: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState<Set<string>>(() => new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groups = runtimes.filter((runtime) => runtime.running || runtime.pendingPrompt || runtime.jobs.length > 0);
  // BackgroundRuntimes is process-local, while jobs from the active controller
  // snapshot may come from another runtime. Keep both sources visible.
  if (jobs.length > 0 && !groups.some((runtime) => runtime.jobs.length > 0)) {
    groups.push({ tabId: "", title: "", detached: false, running: false, pendingPrompt: false, jobs });
  }
  const totalActivity = groups.reduce(
    (total, runtime) => total + Math.max(1, runtime.jobs.length),
    0,
  );

  useEffect(() => {
    if (totalActivity === 0) setOpen(false);
  }, [totalActivity]);
  if (totalActivity === 0) return null;

  const stop = async (tabID: string, jobID: string) => {
    const key = `${tabID}:${jobID}`;
    const handler = tabID ? onCancelRuntimeJob : onCancelJob;
    if (!handler || stopping.has(key)) return;
    setStopping((current) => new Set(current).add(key));
    try {
      if (tabID && onCancelRuntimeJob) await onCancelRuntimeJob(tabID, jobID);
      else if (onCancelJob) await onCancelJob(jobID);
    } finally {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <span className="statusbar__jobs">
      <button
        ref={triggerRef}
        type="button"
        className="statusbar__jobs-trigger"
        aria-label={`${t("status.jobsTitle")}: ${t("status.jobs", { n: totalActivity })}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("status.jobsTitle")}
        onClick={() => setOpen((value) => !value)}
      >
        <Activity size={12} aria-hidden="true" />
        <b>{totalActivity}</b>
      </button>
      <AnchoredPopover open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} className="jobs-popover" align="start">
        <section role="dialog" aria-label={t("status.jobsTitle")}>
          <header className="jobs-popover__header">{t("status.jobsTitle")}</header>
          <div className="jobs-popover__list">
            {groups.map((runtime) => (
              <div className="jobs-popover__runtime" key={runtime.tabId || "active"}>
                {runtime.tabId && (
                  <div className="jobs-popover__runtime-header">
                    <strong>{runtime.title || t("runtime.unknownTask")}</strong>
                    {onRevealRuntime && (
                      <button type="button" className="btn btn--small" onClick={() => void onRevealRuntime(runtime.tabId)}>
                        {t("status.jobOpenTask")}
                      </button>
                    )}
                  </div>
                )}
                {runtime.jobs.length === 0 && (
                  <div className="jobs-popover__job">
                    <span className="jobs-popover__copy">
                      <strong>{runtime.pendingPrompt ? t("status.runtimePendingPrompt") : t("status.runtimeRunning")}</strong>
                    </span>
                  </div>
                )}
                {runtime.jobs.map((job) => {
                  const pending = stopping.has(`${runtime.tabId}:${job.id}`);
                  const canStop = runtime.tabId ? Boolean(onCancelRuntimeJob) : Boolean(onCancelJob);
                  return (
                    <div className="jobs-popover__job" key={`${runtime.tabId}:${job.id}`}>
                      <span className="jobs-popover__copy">
                        <strong>{job.label || job.kind}</strong>
                        <small>{job.kind} · {job.status}</small>
                      </span>
                      <button
                        type="button"
                        className="btn btn--small jobs-popover__stop"
                        disabled={pending || !canStop}
                        onClick={() => void stop(runtime.tabId, job.id)}
                      >
                        <Square size={11} aria-hidden="true" />
                        {pending ? t("status.jobStopping") : t("status.jobStop")}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </AnchoredPopover>
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import { Server, Settings, Unplug } from "lucide-react";
import { AnchoredPopover } from "./AnchoredPopover";
import { RemoteConnectionErrorDialog } from "./RemoteConnectionErrorDialog";
import { Tooltip } from "./Tooltip";
import { useI18n } from "../lib/i18n";
import { isRemoteDegradedWarning, isRemoteHostKeyMismatch, isRemoteTerminalFailure, remoteConnectionErrorSummaryKey } from "../lib/remoteErrors";
import type { RemoteConnectionStatus, RemoteHostView } from "../lib/types";
import { useRemoteStore } from "../store/remote";

// This entry remains visible whenever an SSH host is configured. The popover
// owns quick connection actions; remote files and services live in the dock.
const REMOTE_STATE_SEVERITY: Record<string, number> = {
  error: 5,
  reconnecting: 4,
  pending_hostkey: 4,
  pending_secret: 4,
  connecting: 3,
  degraded: 2,
  connected: 1,
  stopped: 0,
};

/** RemoteSwitcher is the quick remote-hosts menu trigger: a host summary chip
 *  (status bar) or a plain icon (sidebar utility row) whose popover lists every
 *  configured SSH host with connect / open-workspace / disconnect / manage. */
export function RemoteSwitcher({
  hosts,
  statuses,
  onOpen,
  onOpenWorkspace,
  onConnect,
  onDisconnect,
  onManage,
  variant = "chip",
}: {
  hosts: RemoteHostView[];
  statuses: Record<string, RemoteConnectionStatus>;
  onOpen?: (hostId: string) => void;
  onOpenWorkspace?: (host: RemoteHostView) => void;
  onConnect?: (host: RemoteHostView) => void;
  onDisconnect?: (hostId: string) => void;
  onManage?: () => void;
  variant?: "chip" | "icon";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [detailHostId, setDetailHostId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const revealRequest = useRemoteStore((state) => state.statusPopoverRequest);
  const clearRevealRequest = useRemoteStore((state) => state.clearStatusPopoverRequest);

  useEffect(() => {
    if (!revealRequest || !hosts.some((host) => host.id === revealRequest.hostId)) return;
    setOpen(true);
    clearRevealRequest(revealRequest);
  }, [clearRevealRequest, hosts, revealRequest]);

  // With no configured host the popover has nothing to list. A status-bar chip
  // hides entirely; the sidebar icon stays and routes to management.
  if (hosts.length === 0) {
    if (variant !== "icon") return null;
    return (
      <span className="sidebar__remote-wrap">
        <Tooltip label={t("rightDock.remote")} fill side="top">
          <button
            ref={triggerRef}
            type="button"
            className="sidebar__utility-button"
            onClick={() => onManage?.()}
            aria-label={t("rightDock.remote")}
          >
            <Server size={16} aria-hidden="true" />
            <span className="sr-only">{t("rightDock.remote")}</span>
          </button>
        </Tooltip>
      </span>
    );
  }

  const entries = hosts.map((host) => statuses[host.id] ?? { hostId: host.id, state: "stopped" as const });
  const worst = entries.reduce((a, b) => {
    const aSeverity = isRemoteTerminalFailure(a) ? 6 : REMOTE_STATE_SEVERITY[a.state] ?? 0;
    const bSeverity = isRemoteTerminalFailure(b) ? 6 : REMOTE_STATE_SEVERITY[b.state] ?? 0;
    return bSeverity > aSeverity ? b : a;
  });
  const worstHost = hosts.find((host) => host.id === worst.hostId) ?? hosts[0];
  const triggerState = isRemoteTerminalFailure(worst) ? "error" : worst.state;
  const triggerStatus = isRemoteTerminalFailure(worst) ? t("remote.status.failed") : t(`remote.status.${worst.state}`);
  const idleDisconnected = worst.state === "stopped" && !worst.error;
  const triggerLabel = idleDisconnected ? t("remote.statusBar.disconnected") : t("remote.statusBar.summary", { host: worstHost.label, status: triggerStatus });
  const triggerText = idleDisconnected ? "SSH" : triggerState === "connected" ? worstHost.label : triggerLabel;

  const trigger = variant === "icon" ? (
    <Tooltip label={triggerLabel} fill side="top">
      <button
        ref={triggerRef}
        type="button"
        className="sidebar__utility-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Server size={16} aria-hidden="true" />
        <span className="sr-only">{triggerText}</span>
      </button>
    </Tooltip>
  ) : (
    <button
      ref={triggerRef}
      type="button"
      className={`statusbar__remote remote-chip remote-chip--${triggerState}${idleDisconnected ? " statusbar__remote--idle" : ""}`}
      onClick={() => setOpen((value) => !value)}
      aria-label={triggerLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={triggerLabel}
    >
      {triggerState === "connected" ? <span className="statusbar__remote-state-dot" aria-hidden="true" /> : <Server size={11} aria-hidden="true" />}
      <span className="statusbar__remote-label">{triggerText}</span>
    </button>
  );

  return (
    <span className={variant === "icon" ? "sidebar__remote-wrap" : "statusbar__remote-wrap"}>
      {trigger}
      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="remote-switcher"
        align="start"
      >
        <section role="dialog" aria-label={t("remote.switcher.title")}>
          <header className="remote-switcher__header">{t("remote.switcher.title")}</header>
          <div className="remote-switcher__section-label">{t("remote.switcher.hosts")}</div>
          <div className="remote-switcher__hosts">
            {hosts.map((host) => {
              const status = statuses[host.id] ?? { hostId: host.id, state: "stopped" as const };
              const connected = status.state === "connected" || status.state === "degraded";
              const busy = status.state === "connecting" || status.state === "reconnecting" || status.state === "pending_hostkey" || status.state === "pending_secret";
              const terminalFailure = isRemoteTerminalFailure(status);
              const degradedWarning = isRemoteDegradedWarning(status);
              const stateClass = terminalFailure ? "error" : status.state;
              const stateLabel = terminalFailure ? t("remote.status.failed") : t(`remote.status.${status.state}`);
              const errorSummary = status.error ? t(remoteConnectionErrorSummaryKey(status), { host: host.label }) : "";
              const target = `${host.user ? `${host.user}@` : ""}${host.host}${host.port && host.port !== 22 ? `:${host.port}` : ""}`;
              return (
                <div className={`remote-switcher__host remote-switcher__host--${stateClass}`} key={host.id}>
                  <button
                    type="button"
                    className="remote-switcher__host-main"
                    onClick={() => {
                      setOpen(false);
                      onOpen?.(host.id);
                    }}
                  >
                    <span className={`remote-switcher__state remote-switcher__state--${stateClass}`} aria-hidden="true" />
                    <span className="remote-switcher__copy">
                      <strong>{host.label}</strong>
                      <small>{stateLabel} · {host.defaultWorkspace || target}</small>
                    </span>
                  </button>
                    <span className="remote-switcher__actions">
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      disabled={busy}
                      onClick={() => {
                        if (connected) {
                          setOpen(false);
                          onOpenWorkspace?.(host);
                        } else {
                          setOpen(false);
                          onConnect?.(host);
                        }
                      }}
                    >
                      {connected ? t("remote.openWorkspace") : busy ? stateLabel : terminalFailure ? t("remote.error.retry") : t("remote.connectAndOpen")}
                    </button>
                    {connected && (
                      <button
                        type="button"
                        className="remote-switcher__disconnect"
                        onClick={() => onDisconnect?.(host.id)}
                        aria-label={t("remote.disconnectHost", { host: host.label })}
                        title={t("remote.disconnect")}
                      >
                        <Unplug size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  {(terminalFailure || degradedWarning) && (
                    <div className={`remote-switcher__error-card ${degradedWarning ? "remote-switcher__error-card--warning" : ""}`} role="alert">
                      <strong>{t(degradedWarning ? "remote.status.degraded" : "remote.status.failed")}</strong>
                      <span>{errorSummary}</span>
                      <div className="remote-switcher__error-actions">
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => {
                            setOpen(false);
                            setDetailHostId(host.id);
                          }}
                        >
                          {t(isRemoteHostKeyMismatch(status) ? "remote.error.hostKeyDetails" : "remote.error.details")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => {
                            setOpen(false);
                            onManage?.();
                          }}
                        >
                          {t("remote.error.manage")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="remote-switcher__manage"
            onClick={() => {
              setOpen(false);
              onManage?.();
            }}
          >
            <Settings size={13} aria-hidden="true" />
            {t("remote.switcher.manage")}
          </button>
        </section>
      </AnchoredPopover>
      {detailHostId && (() => {
        const host = hosts.find((item) => item.id === detailHostId);
        const status = statuses[detailHostId];
        if (!host || !status?.error) return null;
        return (
          <RemoteConnectionErrorDialog
            host={host}
            status={status}
            onClose={() => setDetailHostId(null)}
            onManage={onManage}
            onRetry={() => onConnect?.(host)}
          />
        );
      })()}
    </span>
  );
}

import { Bot, FileText, MessageSquare, WandSparkles, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { InvocationDisplay } from "../lib/invocationDisplay";
import { projectColorValue } from "../lib/projectColors";
import { useT } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

export function InvocationBadge({
  invocation,
  kind = "skill",
  description,
  onRemove,
  variant,
}: {
  invocation: InvocationDisplay;
  kind?: "skill" | "subagent" | "session" | "file";
  description?: string;
  onRemove?: () => void;
  variant: "composer" | "message";
}) {
  const t = useT();
  const accent = projectColorValue(invocation.color);
  // Match the composer font size so the badge rides on the text baseline
  // instead of an oversized fixed icon; CSS width:1em keeps it proportional.
  const iconSize = 16;
  return (
    <span
      className={`invocation-display invocation-display--${variant} invocation-display--${kind}${accent ? " invocation-display--custom-color" : ""}`}
      role="group"
      aria-label={t("composer.selectedInvocation")}
      style={accent ? { "--invocation-color": accent } as CSSProperties : undefined}
    >
      <Tooltip label={description || (kind === "file" ? invocation.path : `/${invocation.name}`)}>
        <span className="invocation-display__identity">
          {kind === "subagent"
            ? <Bot size={iconSize} />
            : kind === "session"
              ? <MessageSquare size={iconSize} />
              : kind === "file"
                ? <FileText size={iconSize} />
                : <WandSparkles size={iconSize} />}
          <span className="invocation-display__name">{invocation.label}</span>
          {invocation.source && <span className="invocation-display__source">{t("slash.plugin", { name: invocation.source })}</span>}
        </span>
      </Tooltip>
      {/* Skill, session and file tokens are deleted with Backspace/Delete; only a
          subagent token keeps a pointer/touch-accessible remove button. */}
      {kind === "subagent" && onRemove && (
        <Tooltip label={t("composer.removeInvocation")}>
          <button
            type="button"
            className="invocation-display__remove"
            onClick={onRemove}
            aria-label={t("composer.removeInvocationNamed", { name: invocation.label })}
          >
            <X size={14} />
          </button>
        </Tooltip>
      )}
    </span>
  );
}

package agent

import (
	"context"
	"encoding/json"
	"time"

	"reasonix/internal/event"
	"reasonix/internal/evidence"
	"reasonix/internal/provider"
	"reasonix/internal/tool"
)

func (a *Agent) emitBatchToolResults(calls []provider.ToolCall, outcomes []toolOutcome, durations, startedAt []int64, ranParallel []bool, batchStart time.Time) {
	for i, c := range calls {
		o := outcomes[i]
		t, _, ambiguous := a.svc.tools.ResolveCall(c.Name)
		ok := t != nil && len(ambiguous) == 0
		readOnly := ok && t.ReadOnly()
		if c.ResolvedReadOnly != nil {
			readOnly = *c.ResolvedReadOnly
		}
		tr := event.Tool{
			ID:           c.ID,
			Name:         c.Name,
			Args:         c.Arguments,
			ResolvedName: c.ResolvedName,
			CapabilityID: c.CapabilityID,
			Output:       o.output,
			Err:          o.errMsg,
			ReadOnly:     readOnly,
			Truncated:    o.truncated,
			DurationMs:   durations[i],
			Execution:    toEventShellExecution(o.execution, durations[i]),
		}
		if startedAt[i] > 0 {
			tr.StartedAt = startedAt[i]
			tr.EndedAt = startedAt[i] + durations[i]
			if mutation := o.workspaceMutation; mutation != nil {
				tr.WorkspaceMutation = true
				tr.WorkspacePaths = append([]string(nil), mutation.Paths...)
				tr.WorkspaceAllPaths = mutation.AllPaths
			}
		}
		a.svc.sink.Emit(event.Event{Kind: event.ToolResult, Tool: tr})
		if o.truncated && o.truncMsg != "" {
			a.svc.sink.Emit(event.Event{Kind: event.Notice, Level: event.LevelInfo, Text: o.truncMsg})
		}
		a.recordToolExecutionAudit(readOnly, ranParallel[i], startedAt[i], durations[i], batchStart, o)
	}
}

func (a *Agent) recordToolExecutionAudit(readOnly, parallel bool, startedAt, durationMs int64, batchStart time.Time, o toolOutcome) {
	if a == nil || a.capabilityAudit == nil || startedAt <= 0 {
		return
	}
	queueMs := max(startedAt-batchStart.UnixMilli(), 0)
	rawBytes := len(o.output)
	if o.rawOutput != "" {
		rawBytes = len(o.rawOutput)
	}
	a.capabilityAudit.RecordToolExecution(readOnly, parallel, queueMs, durationMs, rawBytes, len(o.output))
}

func (a *Agent) storeBatchToolResult(ctx context.Context, call provider.ToolCall, o toolOutcome) {
	if o.executed && o.errMsg == "" && !o.blocked {
		a.retireWrittenSource(o.evidenceSource)
	}
	msg := provider.Message{Role: provider.RoleTool, Content: o.output, Images: o.images, ToolCallID: call.ID, Name: call.Name, ToolExecution: toProviderToolExecution(o.execution)}
	if o.diagnostic != nil {
		msg.ToolDiagnostic, _ = json.Marshal(o.diagnostic)
		if o.diagnostic.Code == tool.WriteTargetAbsent && a.task.ledger != nil {
			a.task.ledger.RecordTextObservation(evidence.TextObservation{Path: o.diagnostic.Path, Absent: true})
		}
	}
	if o.rawOutput != "" && o.rawOutput != o.output {
		msg.RawContent = o.rawOutput
	}
	if env, ok := a.finalizedReadEnvelope(ctx, call, o); ok {
		if env.HasMore {
			msg.ToolDiagnostic, _ = json.Marshal(tool.OperationDiagnostic{Code: tool.ReadPartial, Path: env.Source.CanonicalPath, OperationID: call.ID, ActualSnapshot: env.Source.Snapshot, RequiredRanges: env.DeliveredRanges, Recovery: "continue with the next window only if the task requires more coverage"})
		}
		if raw, err := json.Marshal(env); err == nil {
			msg.ReadResult = raw
		}
		a.observeReadShadow(env, o.readActiveMillis)
		a.rememberReadDelivery(call.ID, o.output, env)
		args, _ := parseReadFileArgs([]byte(call.Arguments))
		// Rollback may retain the rest for optional recovery, but ordinary
		// partial windows still provide exact evidence for visible local edits.
		if a.readPipelineActive() || (o.rawOutput != "" && !args.fullRead()) {
			if observer, ok := tReadObserver(a, call); ok {
				if observed, ok := observer.ObserveModelText(json.RawMessage(call.Arguments), o.output); ok {
					if len(env.DeliveredRanges) == 0 {
						observed.LineHashes = nil
					} else {
						count := env.DeliveredRanges[0].Lines()
						observed.LineHashes = observed.LineHashes[:min(count, len(observed.LineHashes))]
					}
					observed.Snapshot = env.Source.Snapshot
					a.recordModelTextObservation(observed, call.ID)
				}
			}
		}
	} else if a.readPipelineActive() && (o.errMsg != "" || o.blocked) {
		a.observeFailedRead(call, o)
	}
	a.sess.conversation.Add(msg)
}

func (a *Agent) storeBatchGuardResults(calls []provider.ToolCall, results []string) {
	a.sess.conversation.updateBatchGuardResults(calls, results)
}

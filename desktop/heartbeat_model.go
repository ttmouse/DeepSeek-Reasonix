package main

import (
	"log"
	"time"

	"reasonix/internal/secrets"
)

// applyConfiguredModel switches the task tab to the task's configured model
// (if any) with the controller idle, so the rebuild is synchronous instead of
// deferred behind a running turn. A failed or unready switch skips the run.
func (e *HeartbeatEngine) applyConfiguredModel(t HeartbeatTask, tabID string) (HeartbeatTask, bool) {
	if t.Model == "" {
		return t, true
	}
	apply := e.applyTaskModel
	if apply == nil {
		apply = e.app.SetModelForTab
	}
	if err := apply(tabID, t.Model); err != nil {
		log.Printf("[heartbeat] model switch for %q: %v", t.Title, secrets.RedactError(err))
		now := time.Now().UnixMilli()
		t.LastSkippedAt = now
		t.LastSkippedReason = "model switch failed: " + truncateHeartbeatReason(err.Error())
		t.LastRunAt = now
		return t, false
	}
	// The rebuild replaced the controller; re-resolve and re-check it before
	// the caller submits the prompt.
	ctrl := e.app.ctrlByTabID(tabID)
	if ctrl == nil {
		log.Printf("[heartbeat] controller not ready after model switch for %q, skipping", t.Title)
		return t, false
	}
	if heartbeatControllerBusy(ctrl) {
		log.Printf("[heartbeat] controller busy after model switch for %q, skipping", t.Title)
		return t, false
	}
	return t, true
}

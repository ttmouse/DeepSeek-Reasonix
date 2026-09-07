package agent

import (
	"context"
	"testing"
	"time"
)

func TestZZReproRepair(t *testing.T) {
	path := "/Users/douba/.reasonix/projects/-Users-douba-Projects-YAQ-AI/sessions/20260722-014205.373793000-17an-deepseek-v4-flash-0de5bf74e83a-recovery-ba02addbb719d7a4.jsonl"
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	msgs, _, _, err := LoadSessionDisplayMessages(path)
	t.Logf("step1 LoadSessionDisplayMessages: %v, %d msgs, ctxErr=%v", err, len(msgs), ctx.Err())
	if err != nil || ctx.Err() != nil {
		return
	}
	preview, turns := SessionPreviewFromMessages(msgs)
	t.Logf("step2 preview len=%d, turns=%d", len(preview), turns)
	if err := UpdateBranchMeta(path, false, func(meta *BranchMeta) error {
		meta.Preview = preview
		meta.Turns = turns
		meta.SchemaVersion = BranchMetaCountsVersion
		return nil
	}); err != nil {
		t.Logf("step3 UpdateBranchMeta ERR: %v", err)
		return
	}
	t.Logf("step3 UpdateBranchMeta OK, ctxErr=%v (elapsed %v)", ctx.Err(), time.Since(start))
}

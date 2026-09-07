// Command remote-panel is a lightweight mobile control panel for Reasonix.
//
// It aggregates every saved session across all workspaces (the global
// ~/.reasonix/sessions directory plus every project-scoped
// <state>/projects/<slug>/sessions directory), shows each session's title,
// model, turn count, last-activity time and lease state, and lets a phone
// browser inject a follow-up instruction into an idle session by spawning
// `reasonix run --resume <path> "<message>" --dir <workspaceRoot>` as a child
// process. Live output of that child is streamed back over SSE.
//
// This tool does not modify the Reasonix kernel: it only reads session
// metadata and lease state and reuses the existing `reasonix run --resume`
// injection mechanism (the same one the pr-ci-monitor skill uses).
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"reasonix/internal/agent"
	"reasonix/internal/config"
	"reasonix/internal/store"
)

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

// SessionEntry is one aggregated session shown in the mobile panel.
type SessionEntry struct {
	Path          string `json:"path"`
	Name          string `json:"name"`  // file stem, e.g. 20260730-...-deepseek-v4-flash
	Title         string `json:"title"` // BranchMeta.TopicTitle or preview
	Model         string `json:"model"`
	Turns         int    `json:"turns"`
	UpdatedAt     string `json:"updatedAt"` // RFC3339 of content mtime, empty if unknown
	Scope         string `json:"scope"`     // "global" or "project"
	WorkspaceSlug string `json:"workspaceSlug"`
	WorkspaceRoot string `json:"workspaceRoot"`    // --dir value for injection, may be ""
	WorkspaceDisp string `json:"workspaceDisplay"` // human-readable group label
	Held          bool   `json:"held"`
	HeldBy        string `json:"heldBy"` // "writer@host (pid N)", empty when idle
}

// scanSessions walks the global session dir plus every project-scoped session
// dir under <state>/projects/*/sessions and returns them newest-first.
func scanSessions() []SessionEntry {
	type dirSource struct {
		dir  string
		slug string
	}
	var sources []dirSource
	if d := config.SessionDir(); d != "" {
		sources = append(sources, dirSource{dir: d})
	}
	if base := config.MemoryUserDir(); base != "" {
		projectsRoot := filepath.Join(base, "projects")
		entries, err := os.ReadDir(projectsRoot)
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				sd := filepath.Join(projectsRoot, e.Name(), "sessions")
				if fi, err := os.Stat(sd); err == nil && fi.IsDir() {
					sources = append(sources, dirSource{dir: sd, slug: e.Name()})
				}
			}
		}
	}

	var out []SessionEntry
	seen := map[string]bool{}
	for _, src := range sources {
		entries, err := os.ReadDir(src.dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !store.IsSessionTranscriptName(e.Name()) {
				continue
			}
			path := filepath.Join(src.dir, e.Name())
			if agent.IsCleanupPending(path) {
				continue
			}
			// Canonicalize so a session reachable from two sources dedupes.
			if abs, err := filepath.Abs(path); err == nil {
				path = abs
			}
			if seen[path] {
				continue
			}
			seen[path] = true
			entry := sessionEntryFromPath(path, src.slug)
			out = append(out, entry)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out
}

// sessionEntryFromPath builds one SessionEntry by reading the .jsonl.meta
// sidecar (BranchMeta) and the lease sidecar. Reads are O(1) per session —
// Turn counts and previews come from the meta, not from decoding the .jsonl.
func sessionEntryFromPath(path, slug string) SessionEntry {
	entry := SessionEntry{
		Path:          path,
		Name:          strings.TrimSuffix(filepath.Base(path), ".jsonl"),
		WorkspaceSlug: slug,
		Scope:         "global",
	}
	if slug != "" {
		entry.Scope = "project"
	}

	// Meta: title, model, workspace root, turns, preview.
	meta, ok, err := agent.LoadBranchMeta(path)
	if err == nil && ok {
		entry.Title = strings.TrimSpace(meta.TopicTitle)
		if entry.Title == "" {
			entry.Title = strings.TrimSpace(meta.CustomTitle)
		}
		entry.Model = meta.Model
		entry.WorkspaceRoot = strings.TrimSpace(meta.WorkspaceRoot)
		entry.Turns = meta.Turns
		if entry.Title == "" && meta.Preview != "" {
			entry.Title = truncate(meta.Preview, 60)
		}
		if meta.Scope != "" {
			entry.Scope = meta.Scope
		}
	}
	entry.WorkspaceDisp = workspaceDisplay(entry.Scope, entry.WorkspaceRoot, slug)
	if entry.Title == "" {
		if preview, turns := agent.SessionPreview(path); preview != "" {
			entry.Title = truncate(preview, 60)
			if entry.Turns == 0 {
				entry.Turns = turns
			}
		}
	}
	if entry.Title == "" {
		entry.Title = entry.Name
	}

	entry.UpdatedAt = agent.SessionContentModTime(path).UTC().Format(time.RFC3339)

	// Lease: is another runtime (e.g. the desktop app) holding this session?
	if agent.SessionLeaseHeldByOtherRuntime(path) {
		entry.Held = true
		if info, err := agent.LoadSessionLeaseInfo(path); err == nil && info != nil {
			entry.HeldBy = fmt.Sprintf("%s@%s (pid %d)", info.WriterID, info.Hostname, info.PID)
		} else {
			entry.HeldBy = "another runtime"
		}
	}
	return entry
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// workspaceDisplay returns a human-readable workspace label for grouping: the
// real workspace root when known (from BranchMeta), otherwise a best-effort
// reverse of the slug directory name (e.g. -Users-douba-Projects-foo →
// /Users/douba/Projects/foo). Global-scope sessions always group under "全局",
// even when they live in a project-shaped dir (desktop global workspace).
func workspaceDisplay(scope, workspaceRoot, slug string) string {
	if scope == "global" || slug == "" {
		return "全局"
	}
	if strings.TrimSpace(workspaceRoot) != "" {
		return workspaceRoot
	}
	return reverseSlug(slug)
}

// reverseSlug reconstructs an absolute path from a config.WorkspaceSlug.
// The slug replaces path separators (/, \, :) with "-", so a naive split is
// ambiguous; we only reverse when the result looks like an absolute path and
// the slug had no embedded "-" beyond the separator runs we produced.
func reverseSlug(slug string) string {
	if slug == "" {
		return "全局"
	}
	// Windows drive: "C-Users-..." → "C:\Users\..." ; unix: "/Users/..."
	if len(slug) >= 2 && slug[1] == '-' && slug[0] >= 'A' && slug[0] <= 'Z' {
		return "C:" + filepath.FromSlash(strings.ReplaceAll(slug[2:], "-", "/"))
	}
	return filepath.FromSlash(strings.ReplaceAll(slug, "-", "/"))
}

// ---------------------------------------------------------------------------
// Injection (spawn reasonix run --resume)
// ---------------------------------------------------------------------------

type runState struct {
	ID      string
	Path    string
	Message string
	Started time.Time
	Done    bool
	OK      bool
	Output  []string // ring buffer of output lines
	Err     string
	cancel  context.CancelFunc
	mu      sync.Mutex
}

func (r *runState) appendOutput(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Output = append(r.Output, line)
	if len(r.Output) > 500 {
		r.Output = r.Output[len(r.Output)-500:]
	}
}

func (r *runState) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.Output))
	copy(out, r.Output)
	return out
}

type panel struct {
	reasonixBin string
	tokenHash   [32]byte // sha256 of the access token; empty means no auth
	runsMu      sync.Mutex
	runs        map[string]*runState
}

func newPanel(reasonixBin, token string) *panel {
	p := &panel{reasonixBin: reasonixBin, runs: map[string]*runState{}}
	if token != "" {
		p.tokenHash = sha256.Sum256([]byte(token))
	}
	return p
}

// startRun spawns `reasonix run --resume <path> "<msg>" [--dir <root>]` as a
// child and returns its run id. It does NOT re-check the lease here — the
// caller checks before spawning; the child itself will also refuse a held
// session (session leases prevent concurrent writers).
func (p *panel) startRun(ctx context.Context, path, message, workspaceRoot string) (string, error) {
	id, err := randomID()
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithCancel(ctx)
	// Flags must precede the message: pflag (and the npm-wrapped binary) stops
	// parsing interspersed flags after the first positional arg, so --dir
	// after the message would leak into the prompt. --permission-mode is
	// omitted: the npm-wrapped reasonix (v1.15) does not define it.
	args := []string{"run", "--resume", path}
	if strings.TrimSpace(workspaceRoot) != "" {
		args = append(args, "--dir", workspaceRoot)
	}
	args = append(args, message)
	cmd := exec.CommandContext(runCtx, p.reasonixBin, args...)
	// Run the child inside the session's workspace: provider auth (e.g. 17an)
	// resolves project-level config from the cwd, so a child spawned from the
	// panel's own directory would fail with 401/403. --dir changes the file
	// tools' root but not where auth is resolved, so set cmd.Dir explicitly.
	if strings.TrimSpace(workspaceRoot) != "" {
		cmd.Dir = workspaceRoot
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return "", err
	}
	rs := &runState{ID: id, Path: path, Message: message, Started: time.Now(), cancel: cancel}
	p.runsMu.Lock()
	p.runs[id] = rs
	p.runsMu.Unlock()

	if err := cmd.Start(); err != nil {
		cancel()
		p.runsMu.Lock()
		delete(p.runs, id)
		p.runsMu.Unlock()
		return "", err
	}

	go func() {
		lineReader(stdout, func(line string) { rs.appendOutput(line) })
		lineReader(stderr, func(line string) { rs.appendOutput("[stderr] " + line) })
		err := cmd.Wait()
		rs.mu.Lock()
		rs.Done = true
		rs.OK = err == nil
		if err != nil {
			rs.Err = err.Error()
		}
		rs.mu.Unlock()
		cancel()
	}()
	return id, nil
}

// lineReader splits r into lines and calls fn for each, tolerating partial
// final lines (flushed on EOF).
func lineReader(r io.Reader, fn func(string)) {
	br := newLineSplitter(r)
	for {
		line, ok := br.Next()
		if !ok {
			return
		}
		if strings.TrimSpace(line) != "" {
			fn(line)
		}
	}
}

type lineSplitter struct {
	r   io.Reader
	buf []byte
}

func newLineSplitter(r io.Reader) *lineSplitter {
	return &lineSplitter{r: r, buf: make([]byte, 0, 4096)}
}

func (l *lineSplitter) Next() (string, bool) {
	chunk := make([]byte, 4096)
	for {
		if i := strings.IndexByte(string(l.buf), '\n'); i >= 0 {
			line := string(l.buf[:i])
			l.buf = l.buf[i+1:]
			return line, true
		}
		n, err := l.r.Read(chunk)
		if n > 0 {
			l.buf = append(l.buf, chunk[:n]...)
			continue
		}
		if err != nil {
			if len(l.buf) > 0 {
				line := string(l.buf)
				l.buf = nil
				return line, true
			}
			return "", false
		}
	}
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

func (p *panel) authOK(r *http.Request) bool {
	if p.tokenHash == [32]byte{} {
		return true
	}
	tok := r.URL.Query().Get("token")
	if tok == "" {
		tok = r.Header.Get("Authorization")
		tok = strings.TrimPrefix(tok, "Bearer ")
		tok = strings.TrimPrefix(tok, "Token ")
	}
	if tok == "" {
		return false
	}
	return sha256.Sum256([]byte(tok)) == p.tokenHash
}

func (p *panel) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !p.authOK(r) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "unauthorized: missing or wrong ?token=", http.StatusUnauthorized)
				return
			}
			// Browser navigation to the panel without a token: show a login
			// prompt instead of a bare 401.
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `<!doctype html><meta charset="utf-8"><title>Reasonix Remote</title>
<body style="font-family:system-ui;padding:2rem">
<h2>Reasonix Remote</h2>
<p>需要访问令牌。面板启动时会在终端打印 <code>?token=…</code> 链接。</p>
<form method="get" onsubmit="location.href=location.pathname+'?token='+document.getElementById('t').value;return false">
<input id="t" type="password" placeholder="token" style="padding:.5rem;width:12rem">
<button type="submit" style="padding:.5rem 1rem">进入</button>
</form></body>`)
			return
		}
		next(w, r)
	}
}

func (p *panel) handleSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"sessions": scanSessions()})
}

// messageView is one dialogue turn sent to the mobile UI. A turn is one user
// message plus the assistant's final text; intermediate reasoning and tool
// calls are collapsed into Steps so the transcript stays readable.
type messageView struct {
	Role    string     `json:"role"` // "user" | "assistant"
	Content string     `json:"content"`
	Steps   []stepView `json:"steps,omitempty"` // collapsed thinking/tool calls
}

// stepView is one hidden reasoning or tool-call step within a turn.
type stepView struct {
	Kind    string `json:"kind"`              // "thinking" | "tool"
	Name    string `json:"name,omitempty"`    // tool name, e.g. "bash"
	Preview string `json:"preview,omitempty"` // short content preview
}

// handleMessages returns the conversation history of one session as a list of
// user/assistant messages. The target path must be one of the sessions we list
// (no arbitrary file reads). Reads the .jsonl directly without taking a lease,
// so it works even while the desktop app holds the session.
func (p *panel) handleMessages(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	req.Path = strings.TrimSpace(req.Path)
	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	known := map[string]SessionEntry{}
	for _, s := range scanSessions() {
		known[s.Path] = s
	}
	if _, ok := known[req.Path]; !ok {
		http.Error(w, "unknown session path", http.StatusNotFound)
		return
	}

	// An injection that races a concurrent writer can fork a recovery branch
	// (<stem>-recovery-<hash>.jsonl) instead of writing the original file — the
	// kernel protects the original against snapshot divergence. When such a
	// branch is newer than the original, the injected content lives there, so
	// read the newest recovery branch so the mobile UI shows the result.
	readPath := resolveNewestRecovery(req.Path)

	msgs, err := readSessionDialogue(readPath)
	if err != nil {
		http.Error(w, "failed to read session: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"messages": msgs})
}

// resolveNewestRecovery returns path itself, or if a recovery fork
// (<stem>-recovery-<hash>.jsonl, possibly nested) exists in the same dir and
// is newer than the original, the newest such branch. This surfaces injected
// content the kernel wrote to a recovery branch after a snapshot-divergence
// fork, instead of leaving the original file looking stale.
func resolveNewestRecovery(path string) string {
	dir := filepath.Dir(path)
	stem := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return path
	}
	best := path
	var bestMod time.Time
	if fi, err := os.Stat(path); err == nil {
		bestMod = fi.ModTime()
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		// Matches "<stem>-recovery-<hash>.jsonl" and nested
		// "<stem>-...-recovery-<hash>.jsonl" (both start with the stem).
		name := e.Name()
		if name == filepath.Base(path) || !strings.HasPrefix(name, stem+"-") {
			continue
		}
		if !strings.Contains(name, "-recovery-") {
			continue
		}
		// Only main transcript files — skip sidecars (.events.jsonl,
		// .conflicts.jsonl, .telemetry.jsonl) which share the suffix but are
		// not conversation transcripts.
		if strings.Contains(name, ".events.jsonl") || strings.Contains(name, ".conflicts.jsonl") ||
			strings.Contains(name, ".telemetry.jsonl") {
			continue
		}
		cand := filepath.Join(dir, name)
		fi, err := e.Info()
		if err != nil {
			continue
		}
		if fi.ModTime().After(bestMod) {
			best = cand
			bestMod = fi.ModTime()
		}
	}
	return best
}

// readSessionDialogue decodes the session .jsonl and groups it into turns.
// One turn = a user message followed by the assistant's work on it: the final
// assistant text (content) is shown, while intermediate reasoning
// (reasoning_content) and tool calls (role=tool / assistant tool_calls) are
// collapsed into Steps. System prompts are dropped. User messages without a
// following assistant turn still appear (last message of an in-flight
// session), and assistant content that is only tool noise is folded into
// steps rather than rendered as prose.
func readSessionDialogue(path string) ([]messageView, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Raw message envelope: we need role, content, reasoning and tool calls.
	type rawMsg struct {
		Role             string `json:"role"`
		Content          string `json:"content"`
		ReasoningContent string `json:"reasoning_content"`
		Name             string `json:"name"`
		ToolCalls        []struct {
			Name string `json:"name"`
		} `json:"tool_calls"`
	}

	var raws []rawMsg
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<20), 8<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var m rawMsg
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue // skip malformed lines
		}
		raws = append(raws, m)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}

	var out []messageView
	var pendingSteps []stepView // steps accumulated for the current turn
	// flushTurn appends an assistant turn if any content or steps were seen.
	flushTurn := func() {
		if len(pendingSteps) > 0 {
			out = append(out, messageView{Role: "assistant", Steps: pendingSteps})
			pendingSteps = nil
		}
	}

	for _, m := range raws {
		switch strings.TrimSpace(m.Role) {
		case "user":
			content := strings.TrimSpace(m.Content)
			if content == "" {
				continue
			}
			// A new user turn: flush the previous assistant turn first.
			flushTurn()
			// Drop injected system-prompt blocks that live inside user
			// messages (hook-context, reasoning-language, etc.).
			if isSystemInjected(content) {
				continue
			}
			out = append(out, messageView{Role: "user", Content: truncate(content, 6000)})

		case "assistant":
			content := strings.TrimSpace(m.Content)
			reasoning := strings.TrimSpace(m.ReasoningContent)
			toolCalls := m.ToolCalls
			if content != "" && len(toolCalls) == 0 {
				// Real prose reply — this is the visible answer. Flush any
				// steps gathered so far, then emit the content as a new turn
				// (or attach to the pending turn). We keep it simple: the
				// content turn carries the accumulated steps from this user
				// prompt, then steps reset.
				out = append(out, messageView{Role: "assistant", Content: truncate(content, 6000), Steps: pendingSteps})
				pendingSteps = nil
				continue
			}
			// Intermediate assistant message: thinking and/or tool calls.
			if reasoning != "" {
				pendingSteps = append(pendingSteps, stepView{Kind: "thinking", Preview: truncate(reasoning, 160)})
			}
			for _, tc := range toolCalls {
				pendingSteps = append(pendingSteps, stepView{Kind: "tool", Name: tc.Name})
			}
			if content != "" {
				// Assistant text alongside tool calls (e.g. "I'll check X")
				// — keep as a thinking-style preview to avoid fragmenting.
				pendingSteps = append(pendingSteps, stepView{Kind: "thinking", Preview: truncate(content, 160)})
			}

		case "tool":
			preview := strings.TrimSpace(m.Content)
			name := strings.TrimSpace(m.Name)
			if name == "" {
				name = "tool"
			}
			if len(preview) > 120 {
				preview = preview[:120] + "…"
			}
			pendingSteps = append(pendingSteps, stepView{Kind: "tool", Name: name, Preview: preview})
		}
	}
	flushTurn()
	return out, nil
}

// isSystemInjected reports whether a user-message body is actually an injected
// system prompt (hook-context, reasoning-language, memory-recall blocks) that
// should not be shown as dialogue.
func isSystemInjected(content string) bool {
	c := strings.TrimSpace(content)
	if c == "" {
		return true
	}
	lower := strings.ToLower(c)
	for _, marker := range []string{
		"<hook-context",
		"<reasoning-language",
		"<capability-route",
		"<interrupted-turn-recovery",
		"<background-jobs",
		"<memory-recall",
	} {
		if strings.HasPrefix(lower, marker) {
			return true
		}
	}
	return false
}

func (p *panel) handleDrive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Path == "" || req.Message == "" {
		http.Error(w, "path and message are required", http.StatusBadRequest)
		return
	}
	// The target must be one of the sessions we actually list (no arbitrary
	// file injection).
	known := map[string]SessionEntry{}
	for _, s := range scanSessions() {
		known[s.Path] = s
	}
	entry, ok := known[req.Path]
	if !ok {
		http.Error(w, "unknown session path", http.StatusNotFound)
		return
	}
	if entry.Held {
		writeJSON(w, map[string]any{
			"error":  "held",
			"heldBy": entry.HeldBy,
			"hint":   "该会话正被其他 Reasonix 进程占用（通常是桌面端已打开该对话）。请先在桌面端关闭该 tab，或等待其运行结束，再发送指令。",
		})
		return
	}
	// The child must outlive this HTTP request, so derive it from a
	// background context, not r.Context() (which cancels when drive returns).
	id, err := p.startRun(context.Background(), entry.Path, req.Message, entry.WorkspaceRoot)
	if err != nil {
		http.Error(w, "failed to start: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"runId": id, "session": entry.Path})
}

func (p *panel) handleRunEvents(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	p.runsMu.Lock()
	rs, ok := p.runs[id]
	p.runsMu.Unlock()
	if !ok {
		http.Error(w, "run not found", http.StatusNotFound)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Replay what already happened, then stream new lines.
	replay := rs.snapshot()
	sent := 0
	for _, line := range replay {
		fmt.Fprintf(w, "data: %s\n\n", jsonEscape(line))
		sent++
		flusher.Flush()
	}

	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			lines := rs.snapshot()
			for ; sent < len(lines); sent++ {
				fmt.Fprintf(w, "data: %s\n\n", jsonEscape(lines[sent]))
				flusher.Flush()
			}
			rs.mu.Lock()
			done, okResult := rs.Done, rs.OK
			errMsg := rs.Err
			rs.mu.Unlock()
			if done {
				fmt.Fprintf(w, "event: done\ndata: %s\n\n", jsonEscape(fmt.Sprintf("%t|%s", okResult, errMsg)))
				flusher.Flush()
				return
			}
		}
	}
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func randomID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	addr := flag.String("addr", "0.0.0.0:8788", "listen address (use 0.0.0.0 so a phone on the LAN can reach it)")
	token := flag.String("token", "", "access token; if empty, a random one is generated and printed")
	reasonixBin := flag.String("reasonix-bin", "", "path to the reasonix binary (default: 'reasonix' on PATH)")
	flag.Parse()

	if *reasonixBin == "" {
		if p, err := exec.LookPath("reasonix"); err == nil {
			*reasonixBin = p
		} else {
			log.Fatal("reasonix binary not found on PATH; pass --reasonix-bin")
		}
	}
	if _, err := exec.LookPath(*reasonixBin); err != nil {
		// Allow relative paths that exist.
		if _, statErr := os.Stat(*reasonixBin); statErr != nil {
			log.Fatalf("reasonix binary not found at %s: %v", *reasonixBin, err)
		}
	}

	if *token == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			log.Fatal(err)
		}
		*token = hex.EncodeToString(b)
	}
	p := newPanel(*reasonixBin, *token)

	mux := http.NewServeMux()
	mux.HandleFunc("/", p.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, indexHTML)
	}))
	mux.HandleFunc("/api/sessions", p.requireAuth(p.handleSessions))
	mux.HandleFunc("/api/messages", p.requireAuth(p.handleMessages))
	mux.HandleFunc("/api/drive", p.requireAuth(p.handleDrive))
	mux.HandleFunc("/api/runs/", p.requireAuth(p.handleRunEvents))

	fmt.Printf("Reasonix remote panel listening on http://%s\n", *addr)
	fmt.Printf("Mobile access link: http://%s/?token=%s\n", printableAddr(*addr), *token)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

func printableAddr(addr string) string {
	if strings.HasPrefix(addr, "0.0.0.0:") {
		return "LAN-IP:" + strings.TrimPrefix(addr, "0.0.0.0:")
	}
	return addr
}

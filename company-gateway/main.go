// Command company-gateway is a Reasonix MCP plugin that wraps the company
// intranet as query tools. It speaks newline-delimited JSON-RPC 2.0 on
// stdin/stdout (the same contract as cmd/reasonix-plugin-example), so Reasonix
// can load it via:
//
//	[[plugins]]
//	name    = "company"
//	command = "company-gateway"
//
// Then its tools surface as "mcp__company__session_set" /
// "mcp__company__query_data", and the model can drive them conversationally:
//
//	"用公司网关查一下 2026 年 8 月的订单，筛选状态=已完成"
//
// Login model: the company site has no public API, so a browser session is
// obtained once (manual login in a real browser), exported as cookies, and
// injected here via the session_set tool (or the SESSION_COOKIE env var).
// session_status reports whether a usable session is present.
//
// TODO(company): once the real intranet login + query endpoints are known,
//   - fill loginURL / queryURL below,
//   - replace the mock query handler with a real HTTP call that carries the
//     stored cookies,
//   - optionally implement automatic login (http.PostForm on the login form)
//     instead of manual cookie injection.
//
// Logs go to stderr (Reasonix forwards plugin stderr to the terminal); stdout is
// reserved for JSON-RPC so it must never carry stray prose.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// version is overridable via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	log.SetPrefix("company-gateway: ")
	log.SetFlags(0)

	// Boot with a session injected from the environment, if provided.
	// TODO(company): accept a cookie header string like
	//   "JSESSIONID=abc123; company_token=xyz"
	if raw := os.Getenv("COMPANY_SESSION_COOKIE"); raw != "" {
		state.cookieHeader = raw
		state.setAt = time.Now()
		log.Printf("session loaded from COMPANY_SESSION_COOKIE (%d bytes)", len(raw))
	}

	if err := serve(os.Stdin, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

// --- intranet config (fill in the real values) ---

const (
	// loginURL is where the browser login form POSTs. Leave empty until known.
	// loginURL = "https://intranet.example.com/login"
	// queryURL is the server-side filtered query endpoint (the one the
	// intranet's own search page calls).
	// queryURL = "https://intranet.example.com/api/search"
	queryURL = "" // TODO(company): fill in the real query endpoint
)

// sessionState holds the injected browser session. In real usage you would
// persist it (e.g. ~/.company-gateway/session.json) so it survives restarts.
type sessionState struct {
	cookieHeader string
	setAt        time.Time
}

var state sessionState

// --- JSON-RPC framing (identical to the reference plugin) ---

type request struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id"` // nil ⇒ notification (no reply)
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

const (
	protocolVersion    = "2024-11-05"
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

func serve(in *os.File, out *os.File) error {
	r := bufio.NewReader(in)
	w := bufio.NewWriter(out)
	defer w.Flush()

	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			if rerr := handleLine(line, w); rerr != nil {
				return rerr
			}
			if ferr := w.Flush(); ferr != nil {
				return ferr
			}
		}
		if err != nil {
			return nil // EOF or pipe closed: clean shutdown
		}
	}
}

func handleLine(line []byte, w *bufio.Writer) error {
	line = trimSpace(line)
	if len(line) == 0 {
		return nil
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		log.Printf("skipping unparseable line: %v", err)
		return nil
	}
	if req.ID == nil {
		return nil // notification: no reply
	}

	resp := response{JSONRPC: "2.0", ID: *req.ID}
	switch req.Method {
	case "initialize":
		resp.Result = map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "company-gateway", "version": version},
		}
	case "tools/list":
		resp.Result = map[string]any{"tools": toolList()}
	case "tools/call":
		resp.Result, resp.Error = callTool(req.Params)
	default:
		resp.Error = &rpcError{Code: codeMethodNotFound, Message: "method not found: " + req.Method}
	}

	b, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("marshal response: %w", err)
	}
	if _, err := w.Write(append(b, '\n')); err != nil {
		return err
	}
	return nil
}

// --- tools ---

type toolDef struct {
	name        string
	description string
	schema      map[string]any
	readOnly    bool
	run         func(args map[string]any) (string, error)
}

var tools = []toolDef{
	{
		name:        "session_set",
		description: "Inject a company intranet session as a raw cookie header (e.g. \"JSESSIONID=abc; company_token=xyz\"). Use after logging in once in a real browser and exporting cookies. Overwrites any existing session.",
		readOnly:    false,
		schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"cookie_header": map[string]any{"type": "string", "description": "Cookie header value copied from the logged-in browser"},
			},
			"required": []string{"cookie_header"},
		},
		run: func(args map[string]any) (string, error) {
			raw, ok := args["cookie_header"].(string)
			if !ok || strings.TrimSpace(raw) == "" {
				return "", fmt.Errorf("argument 'cookie_header' must be a non-empty string")
			}
			state.cookieHeader = strings.TrimSpace(raw)
			state.setAt = time.Now()
			return fmt.Sprintf("session stored (%d bytes); use session_status to verify it is usable", len(state.cookieHeader)), nil
		},
	},
	{
		name:        "session_status",
		description: "Report whether a company intranet session is currently stored and how old it is. Run this first to know if you can query data.",
		readOnly:    true,
		schema: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
		run: func(args map[string]any) (string, error) {
			if state.cookieHeader == "" {
				return "NO_SESSION: no company session stored. Ask the user to log in and inject cookies via session_set, or set COMPANY_SESSION_COOKIE.", nil
			}
			age := time.Since(state.setAt).Round(time.Second)
			return fmt.Sprintf("SESSION_OK: %d bytes of cookies, set %s ago. Ready to query.", len(state.cookieHeader), age), nil
		},
	},
	{
		name:        "query_data",
		description: "Query company data with the stored session, applying the given server-side filters. Returns rows as JSON.",
		readOnly:    true,
		schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"table": map[string]any{
					"type":        "string",
					"description": "Which data domain to query, e.g. \"orders\", \"customers\", \"invoices\" (depends on the intranet)",
				},
				"filters": map[string]any{
					"type":        "object",
					"description": "Server-side filter keys/values, mirroring the intranet's own filter form",
				},
			},
			"required": []string{"table"},
		},
		run: func(args map[string]any) (string, error) {
			if state.cookieHeader == "" {
				return "", fmt.Errorf("no session: inject cookies first via session_set (or set COMPANY_SESSION_COOKIE)")
			}
			table, _ := args["table"].(string)
			filters, _ := args["filters"].(map[string]any)

			if queryURL == "" {
				// Mock response so the Reasonix ↔ gateway ↔ session loop can be
				// validated before the real endpoint is known.
				return mockQuery(table, filters, state.cookieHeader), nil
			}
			// TODO(company): real implementation —
			//   req, _ := http.NewRequest("GET", queryURL, nil)
			//   req.Header.Set("Cookie", state.cookieHeader)
			//   ... add filters as query params, parse the JSON response ...
			return "", fmt.Errorf("queryURL not configured yet")
		},
	},
}

func toolList() []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]any{
			"name":        t.name,
			"description": t.description,
			"inputSchema": t.schema,
			"annotations": map[string]any{
				"readOnlyHint": t.readOnly,
				"title":        t.name,
			},
		})
	}
	return out
}

func callTool(params json.RawMessage) (any, *rpcError) {
	var p struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: codeInvalidParams, Message: "invalid params: " + err.Error()}
	}
	for _, t := range tools {
		if t.name != p.Name {
			continue
		}
		text, err := t.run(p.Arguments)
		if err != nil {
			return textResult(err.Error(), true), nil
		}
		return textResult(text, false), nil
	}
	return nil, &rpcError{Code: codeInvalidParams, Message: "unknown tool: " + p.Name}
}

func textResult(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
		"isError": isError,
	}
}

// --- mock query (until the real endpoint is wired) ---

func mockQuery(table string, filters map[string]any, cookieHeader string) string {
	if filters == nil {
		filters = map[string]any{}
	}
	rows := []map[string]any{
		{"id": 1001, "status": "done", "value": 128.5},
		{"id": 1002, "status": "done", "value": 42.0},
	}
	out, _ := json.MarshalIndent(map[string]any{
		"table":        table,
		"filters":      filters,
		"session_used": fmt.Sprintf("%d bytes", len(cookieHeader)),
		"rows":         rows,
		"mock":         true,
		"note":         "MOCK DATA — queryURL not configured; replace with the real endpoint",
	}, "", "  ")
	return string(out)
}

// --- helpers ---

func trimSpace(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

// keep net/http imported for the TODO real query implementation.
var _ = http.MethodGet

package openai

import (
	"testing"

	"reasonix/internal/provider"
)

const (
	dashScopePlanBase   = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
	dashScopePlanChat   = dashScopePlanBase + "/chat/completions"
	dashScopePlanModels = dashScopePlanBase + "/models"
)

func TestCanonicalDashScopeCompatibleEndpoints(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		raw      string
		wantChat string
		wantMods string
		ok       bool
	}{
		{name: "token-plan base", raw: dashScopePlanBase, wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan base trailing slash", raw: dashScopePlanBase + "/", wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan complete chat", raw: dashScopePlanChat, wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan complete models", raw: dashScopePlanModels, wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan uppercase host", raw: "https://TOKEN-PLAN.CN-BEIJING.MAAS.ALIYUNCS.COM/compatible-mode/v1", wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan explicit 443", raw: "https://token-plan.cn-beijing.maas.aliyuncs.com:443/compatible-mode/v1", wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},
		{name: "token-plan surrounding whitespace", raw: "  " + dashScopePlanBase + "  ", wantChat: dashScopePlanChat, wantMods: dashScopePlanModels, ok: true},

		{name: "dashscope base", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1", wantChat: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", wantMods: "https://dashscope.aliyuncs.com/compatible-mode/v1/models", ok: true},
		{name: "dashscope regional base", raw: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", wantChat: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", wantMods: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", ok: true},

		{name: "third-party gateway", raw: "https://relay.example.com/compatible-mode/v1", ok: false},
		{name: "lookalike suffix host", raw: "https://maas.aliyuncs.com.evil.example/compatible-mode/v1", ok: false},
		{name: "bare aliyuncs apex", raw: "https://aliyuncs.com/compatible-mode/v1", ok: false},
		{name: "dashscope non compatible path", raw: "https://dashscope.aliyuncs.com/v1", ok: false},
		{name: "dashscope coding plan path", raw: "https://coding.dashscope.aliyuncs.com/v1", ok: false},
		{name: "dashscope anthropic shape", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1/messages", ok: false},
		{name: "dashscope embeddings", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", ok: false},
		{name: "dashscope repeated prefix", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1/compatible-mode/v1", ok: false},
		{name: "http scheme", raw: "http://dashscope.aliyuncs.com/compatible-mode/v1", ok: false},
		{name: "non-443 port", raw: "https://dashscope.aliyuncs.com:8443/compatible-mode/v1", ok: false},
		{name: "userinfo", raw: "https://user@dashscope.aliyuncs.com/compatible-mode/v1", ok: false},
		{name: "query", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1?foo=1", ok: false},
		{name: "fragment", raw: "https://dashscope.aliyuncs.com/compatible-mode/v1#frag", ok: false},
		{name: "escaped path slash", raw: "https://dashscope.aliyuncs.com/compatible-mode%2Fv1", ok: false},
		{name: "relative url", raw: "/compatible-mode/v1", ok: false},
		{name: "empty", raw: "", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotChat, chatOK := canonicalDashScopeCompatibleChatURL(tt.raw)
			gotModels, modelsOK := CanonicalDashScopeCompatibleModelsURL(tt.raw)
			if chatOK != tt.ok || modelsOK != tt.ok {
				t.Fatalf("ok chat=%v models=%v, want %v", chatOK, modelsOK, tt.ok)
			}
			if !tt.ok {
				if gotChat != "" || gotModels != "" {
					t.Fatalf("rewrote unknown input %q to chat=%q models=%q", tt.raw, gotChat, gotModels)
				}
				return
			}
			if gotChat != tt.wantChat || gotModels != tt.wantMods {
				t.Fatalf("chat = %q models = %q, want %q / %q", gotChat, gotModels, tt.wantChat, tt.wantMods)
			}
		})
	}
}

// The settings form stores /compatible-mode/v1 as an exact request URL, which is
// the shape that made the provider fail with 400 InvalidParameter at the gateway.
func TestResolveOpenAIChatURLCompletesModelStudioBase(t *testing.T) {
	t.Parallel()

	got := resolveOpenAIChatURL(dashScopePlanBase, map[string]any{"request_url": dashScopePlanBase})
	if got != dashScopePlanChat {
		t.Fatalf("chatURL = %q, want %q", got, dashScopePlanChat)
	}

	legacy := resolveOpenAIChatURL(dashScopePlanBase, map[string]any{"chat_url": dashScopePlanBase})
	if legacy != dashScopePlanChat {
		t.Fatalf("legacy chatURL = %q, want %q", legacy, dashScopePlanChat)
	}
}

func TestModelStudioBaseKeepsCustomRequestURL(t *testing.T) {
	t.Parallel()

	custom := "https://relay.example.com/custom/chat/completions?token=1"
	p, err := New(provider.Config{
		BaseURL: dashScopePlanBase,
		Model:   "qwen3.7-max",
		Extra:   map[string]any{"request_url": custom},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := p.(*client).chatURL; got != custom {
		t.Fatalf("chatURL = %q, want %q", got, custom)
	}
}

package openai

import (
	"net/url"
	"strings"
)

// Alibaba Cloud Model Studio (DashScope / Bailian) documents /compatible-mode/v1
// as the OpenAI-compatible *base*, so users paste it into the settings form —
// which stores the field as an exact request URL ("no path completion"). The
// request then lands on /compatible-mode/v1 itself and the gateway answers
// 400 InvalidParameter "url error", while /models probing still succeeds.
// Canonicalization preserves the user's regional host; only the path moves.
const (
	dashScopeCompatiblePrefix     = "/compatible-mode/v1"
	dashScopeCompatibleChatPath   = dashScopeCompatiblePrefix + "/chat/completions"
	dashScopeCompatibleModelsPath = dashScopeCompatiblePrefix + "/models"
)

func canonicalDashScopeCompatibleEndpoint(raw, canonicalPath string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if strings.ContainsAny(raw, "?#") {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Opaque != "" {
		return "", false
	}
	if !isDashScopeCompatibleHost(u.Hostname()) {
		return "", false
	}
	if port := u.Port(); port != "" && port != "443" {
		return "", false
	}
	if u.User != nil || u.RawPath != "" {
		return "", false
	}
	if !dashScopeCompatibleKnownPath(u.Path) {
		return "", false
	}
	return "https://" + strings.ToLower(u.Hostname()) + canonicalPath, true
}

func canonicalDashScopeCompatibleChatURL(raw string) (string, bool) {
	return canonicalDashScopeCompatibleEndpoint(raw, dashScopeCompatibleChatPath)
}

// CanonicalDashScopeCompatibleModelsURL rewrites known Model Studio bases to
// GET /compatible-mode/v1/models.
func CanonicalDashScopeCompatibleModelsURL(raw string) (string, bool) {
	return canonicalDashScopeCompatibleEndpoint(raw, dashScopeCompatibleModelsPath)
}

// isDashScopeCompatibleHost matches the official Model Studio hosts: the
// DashScope API (China, dashscope-intl, coding plans) and the dedicated
// token-plan hosts whose service label is maas. Any other aliyuncs.com service,
// relay, or lookalike domain stays untouched.
func isDashScopeCompatibleHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if !strings.HasSuffix(host, ".aliyuncs.com") {
		return false
	}
	for label := range strings.SplitSeq(strings.TrimSuffix(host, ".aliyuncs.com"), ".") {
		if label == "dashscope" || label == "maas" || strings.HasPrefix(label, "dashscope-") {
			return true
		}
	}
	return false
}

func dashScopeCompatibleKnownPath(path string) bool {
	if path != "/" {
		path = strings.TrimSuffix(path, "/")
	}
	switch path {
	case "", "/", dashScopeCompatiblePrefix, dashScopeCompatiblePrefix + "/v1":
		return true
	}
	for _, leaf := range []string{"/chat/completions", "/models"} {
		if path == dashScopeCompatiblePrefix+leaf {
			return true
		}
	}
	return false
}

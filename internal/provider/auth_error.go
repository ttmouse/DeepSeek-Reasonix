package provider

import "fmt"

// AuthError reports that a provider rejected the API key (HTTP 401/403).
// Its message is already user-facing and actionable: it names the provider
// and, when known, the environment variable the key comes from. Body is the
// server's trimmed response reason and is deliberately NOT part of Error() —
// servers may echo masked key fragments that must never reach logs or traces.
type AuthError struct {
	Provider  string // the provider instance name, e.g. "deepseek"
	KeyEnv    string // the api_key_env the key is read from, when known
	KeySource string // human-readable source of KeyEnv, when known
	Status    int    // the HTTP status (401 or 403)
	HasKey    bool   // a non-empty key was sent — the server rejected it, vs. no key configured at all
	Body      string // trimmed response-body snippet, the server's verbatim reason when it gave one
}

func (e *AuthError) Error() string {
	key := "the API key"
	if e.KeyEnv != "" {
		key = e.KeyEnv
	}
	if e.KeySource != "" {
		key += " from " + e.KeySource
	}
	return fmt.Sprintf("authentication failed for provider %q (HTTP %d): %s is invalid or expired — update it (in .env or your environment) and retry, or run `reasonix setup`",
		e.Provider, e.Status, key)
}

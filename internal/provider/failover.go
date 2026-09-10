package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// failoverProvider wraps a primary provider with ordered fallback providers.
// When the primary's Stream() returns a server-side or network error (after
// SendWithRetry's internal retries are exhausted), it retries the request on
// each fallback in sequence until one succeeds or all are exhausted. Auth
// errors and bad-request errors are not retried — they indicate a config or
// caller problem that a different provider won't fix.
type failoverProvider struct {
	primary   Provider
	fallbacks []Provider
}

// NewFailoverProvider wraps a primary provider with fallback providers that
// are tried automatically when the primary returns a failover-eligible error.
// Each fallback is tried in order; the first successful Stream() wins. When no
// fallbacks are given, primary is returned unwrapped.
func NewFailoverProvider(primary Provider, fallbacks []Provider) Provider {
	if len(fallbacks) == 0 {
		return primary
	}
	return &failoverProvider{primary: primary, fallbacks: fallbacks}
}

func (f *failoverProvider) Name() string {
	if len(f.fallbacks) == 0 {
		return f.primary.Name()
	}
	names := make([]string, 0, 1+len(f.fallbacks))
	names = append(names, f.primary.Name())
	for _, fb := range f.fallbacks {
		names = append(names, fb.Name())
	}
	return strings.Join(names, "|")
}

// Stream tries the primary provider's Stream first. If that fails with a
// failover-eligible error, each fallback is tried in order. The first
// successful Stream() wins; if all fail, the last error is returned.
func (f *failoverProvider) Stream(ctx context.Context, req Request) (<-chan Chunk, error) {
	ch, err := f.primary.Stream(ctx, req)
	if err == nil {
		return ch, nil
	}
	if !isFailoverEligible(err) {
		return nil, err
	}

	// Collect the primary's error as context for the final failure message.
	errs := []error{fmt.Errorf("%s: %w", f.primary.Name(), err)}

	for i, fb := range f.fallbacks {
		ch, fbErr := fb.Stream(ctx, req)
		if fbErr == nil {
			return ch, nil
		}
		errs = append(errs, fmt.Errorf("fallback[%d] %s: %w", i, fb.Name(), fbErr))
		if !isFailoverEligible(fbErr) {
			// Non-failover-eligible error from a fallback: stop trying further
			// fallbacks since it likely won't help.
			break
		}
	}

	return nil, fmt.Errorf("all providers failed: %w", errors.Join(errs...))
}

// failoverEligible reports whether err is a server-side or network error that
// a different provider might recover from. Auth errors (401/403) and bad
// request errors (4xx except 408/429) are caller problems and not eligible.
func isFailoverEligible(err error) bool {
	if err == nil {
		return false
	}
	// Auth errors: wrong key for this provider; switching to a different
	// provider with its own key may work.  Treat as eligible so the fallback
	// can try.
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return true
	}
	// API errors: only retryable statuses (5xx, 429, 408) are eligible.
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return RetryableStatus(apiErr.Status)
	}
	// Connection/network errors: eligible.
	if IsConnReset(err) {
		return true
	}
	// Transient errors (DNS, timeout, etc.): eligible.
	if transientErr(err) {
		return true
	}
	return false
}

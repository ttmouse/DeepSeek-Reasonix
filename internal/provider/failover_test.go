package provider

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// failoverMockProvider is a test provider that returns configured results.
type failoverMockProvider struct {
	name   string
	stream func(ctx context.Context, req Request) (<-chan Chunk, error)
}

func (m *failoverMockProvider) Name() string { return m.name }

func (m *failoverMockProvider) Stream(ctx context.Context, req Request) (<-chan Chunk, error) {
	return m.stream(ctx, req)
}

func TestFailoverProviderPrimarySucceeds(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			ch := make(chan Chunk)
			close(ch)
			return ch, nil
		},
	}
	fallback := &failoverMockProvider{
		name: "fallback",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			t.Error("fallback should not be called")
			return nil, nil
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback})
	ch, err := wrapped.Stream(context.Background(), Request{})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if ch == nil {
		t.Fatal("expected non-nil channel")
	}
}

func TestFailoverProviderFallbackOnServerError(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, &APIError{Provider: "primary", Status: 503, Body: "Service Unavailable"}
		},
	}
	fallback := &failoverMockProvider{
		name: "fallback",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			ch := make(chan Chunk)
			close(ch)
			return ch, nil
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback})
	ch, err := wrapped.Stream(context.Background(), Request{})
	if err != nil {
		t.Fatalf("expected fallback to succeed, got %v", err)
	}
	if ch == nil {
		t.Fatal("expected non-nil channel")
	}
}

func TestFailoverProviderAllFail(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, &APIError{Provider: "primary", Status: 503}
		},
	}
	fallback := &failoverMockProvider{
		name: "fallback",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, &APIError{Provider: "fallback", Status: 502}
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback})
	ch, err := wrapped.Stream(context.Background(), Request{})
	if err == nil {
		t.Fatal("expected error when all providers fail")
	}
	if ch != nil {
		t.Fatal("expected nil channel when all providers fail")
	}
}

func TestFailoverProviderAuthErrorFailsFastPrimary(t *testing.T) {
	// Auth errors on the primary should still be failover-eligible since a
	// different provider may have a valid key.
	called := false
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, &AuthError{Provider: "primary", Status: 401, HasKey: true}
		},
	}
	fallback := &failoverMockProvider{
		name: "fallback",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			called = true
			return nil, errors.New("still failing")
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback})
	_, err := wrapped.Stream(context.Background(), Request{})
	if err == nil {
		t.Fatal("expected error")
	}
	if !called {
		t.Error("fallback should be tried after auth error on primary")
	}
}

func TestFailoverProviderNoFallbacks(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			ch := make(chan Chunk)
			close(ch)
			return ch, nil
		},
	}

	wrapped := NewFailoverProvider(primary, nil)
	if wrapped != primary {
		t.Error("NewFailoverProvider with no fallbacks should return primary unwrapped")
	}

	wrapped2 := NewFailoverProvider(primary, []Provider{})
	if wrapped2 != primary {
		t.Error("NewFailoverProvider with empty fallbacks should return primary unwrapped")
	}
}

func TestFailoverProviderConnectionError(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, fmt.Errorf("primary: connection refused")
		},
	}
	fallback := &failoverMockProvider{
		name: "fallback",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			ch := make(chan Chunk)
			close(ch)
			return ch, nil
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback})
	ch, err := wrapped.Stream(context.Background(), Request{})
	if err != nil {
		t.Fatalf("expected fallback to succeed after connection error, got %v", err)
	}
	if ch == nil {
		t.Fatal("expected non-nil channel")
	}
}

func TestFailoverProviderName(t *testing.T) {
	primary := &failoverMockProvider{name: "17an"}
	fallback1 := &failoverMockProvider{name: "deepseek"}
	fallback2 := &failoverMockProvider{name: "mimo"}

	wrapped := NewFailoverProvider(primary, []Provider{fallback1, fallback2})
	expected := "17an|deepseek|mimo"
	if wrapped.Name() != expected {
		t.Errorf("Name() = %q, want %q", wrapped.Name(), expected)
	}
}

func TestFailoverProviderStopsOnNonRetryableFallbackError(t *testing.T) {
	primary := &failoverMockProvider{
		name: "primary",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			return nil, &APIError{Provider: "primary", Status: 503}
		},
	}
	fallback1 := &failoverMockProvider{
		name: "fb1",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			// Non-retryable: a 400 is a request problem
			return nil, &APIError{Provider: "fb1", Status: 400, Body: "bad request"}
		},
	}
	fallback2 := &failoverMockProvider{
		name: "fb2",
		stream: func(ctx context.Context, req Request) (<-chan Chunk, error) {
			t.Error("fallback2 should not be called after fb1's non-retryable error")
			return nil, nil
		},
	}

	wrapped := NewFailoverProvider(primary, []Provider{fallback1, fallback2})
	_, err := wrapped.Stream(context.Background(), Request{})
	if err == nil {
		t.Fatal("expected error")
	}
}

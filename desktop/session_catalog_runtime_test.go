package main

import (
	"testing"
)

// TestRuntimeProjectTopicNodesDeduplicatesSessions pins the sibling-key
// contract: a snapshot batch that reports the same session twice (tab plus its
// detached runtime, or a tab whose stored path is blank while its controller
// resolves it) must emit one child row per distinct session. Duplicate
// project_session_* keys surface to the frontend as a React "two children with
// the same key" warning.
func TestRuntimeProjectTopicNodesDeduplicatesSessions(t *testing.T) {
	app := &App{}
	nodes, _ := app.runtimeProjectTopicNodes("project", "/work", []catalogRuntimeSnapshot{
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "/work/t1/a.jsonl", activity: topicStatusThinking, open: true},
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "/work/t1/a.jsonl", activity: "", open: false},
	})
	if len(nodes) != 1 {
		t.Fatalf("got %d topics, want 1", len(nodes))
	}
	children := nodes[0].Children
	if len(children) != 1 {
		t.Fatalf("got %d session rows for a duplicated session, want 1: %+v", len(children), children)
	}
	if !children[0].Open {
		t.Fatalf("merged row lost open=true: %+v", children[0])
	}
	if !children[0].Running {
		t.Fatalf("merged row lost running=true: %+v", children[0])
	}
	if children[0].Status != topicStatusThinking {
		t.Fatalf("merged row status = %q, want %q", children[0].Status, topicStatusThinking)
	}
	if children[0].Key != projectSessionNodeKey("project", "/work/t1/a.jsonl") {
		t.Fatalf("unexpected session key %q", children[0].Key)
	}
}

// TestRuntimeProjectTopicNodesKeepsDistinctSessions guards the normal
// multi-session case: different session files under one topic still get one row
// each, with distinct keys.
func TestRuntimeProjectTopicNodesKeepsDistinctSessions(t *testing.T) {
	app := &App{}
	nodes, _ := app.runtimeProjectTopicNodes("project", "/work", []catalogRuntimeSnapshot{
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "/work/t1/a.jsonl", open: true},
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "/work/t1/b.jsonl", open: false},
	})
	if len(nodes) != 1 {
		t.Fatalf("got %d topics, want 1", len(nodes))
	}
	children := nodes[0].Children
	if len(children) != 2 {
		t.Fatalf("got %d session rows, want 2: %+v", len(children), children)
	}
	seen := map[string]bool{}
	for _, child := range children {
		if seen[child.Key] {
			t.Fatalf("duplicate sibling key %q", child.Key)
		}
		seen[child.Key] = true
	}
}

// TestCatalogRuntimeSnapshotsDeduplicatesTabPointers pins the source-side
// guard: a tab resident in both a.tabs and a.detachedSessions must be collected
// once, mirroring runtimeTabsLocked, so the overlay never sees the same session
// twice.
func TestCatalogRuntimeSnapshotsDeduplicatesTabPointers(t *testing.T) {
	tab := &WorkspaceTab{ID: "t1", Scope: "project", WorkspaceRoot: "/work", TopicID: "t1", SessionPath: "/work/t1/a.jsonl"}
	app := &App{
		tabs:             map[string]*WorkspaceTab{"t1": tab},
		detachedSessions: map[string]*WorkspaceTab{"runtime-key": tab},
	}
	snapshots := app.catalogRuntimeSnapshots()
	if len(snapshots) != 1 {
		t.Fatalf("got %d snapshots for one tab in both collections, want 1: %+v", len(snapshots), snapshots)
	}
	if snapshots[0].sessionPath != "/work/t1/a.jsonl" {
		t.Fatalf("unexpected snapshot %+v", snapshots[0])
	}
}

// TestRuntimeProjectTopicNodesFoldsBlankPaths pins that pathless snapshots of
// one topic cannot produce duplicate children: blank paths all hash to the same
// key, so they must collapse into a single row.
func TestRuntimeProjectTopicNodesFoldsBlankPaths(t *testing.T) {
	app := &App{}
	nodes, _ := app.runtimeProjectTopicNodes("project", "/work", []catalogRuntimeSnapshot{
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "", open: true},
		{scope: "project", workspaceRoot: "/work", topicID: "t1", sessionPath: "  ", open: false},
	})
	if len(nodes) != 1 {
		t.Fatalf("got %d topics, want 1", len(nodes))
	}
	if len(nodes[0].Children) != 1 {
		t.Fatalf("got %d session rows for blank paths, want 1: %+v", len(nodes[0].Children), nodes[0].Children)
	}
}

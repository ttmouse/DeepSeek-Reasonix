package bootstrap

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"reasonix/internal/remote"
)

func TestSweepOrphansCommandShape(t *testing.T) {
	cmd := SweepOrphansCommand("/home/u/.reasonix/remote")
	for _, want := range []string{
		"DIR='/home/u/.reasonix/remote'",
		// Referenced pids come from every state record, so a serve another
		// workspace's bootstrap owns is never touched.
		"serve-*.json",
		`sed -n 's/.*"pid"`,
		// Scope: only managed serves under .reasonix/remote (ASCII marker,
		// immune to the ps escaping that broke the full-path match).
		"grep -- '--token-file .*/\\.reasonix/remote/'",
		// Grace: young processes are skipped; old ones TERM'd, then KILL'd.
		"-lt 120",
		"kill -TERM",
		"kill -KILL",
	} {
		if !strings.Contains(cmd, want) {
			t.Errorf("SweepOrphansCommand missing %q:\n%s", want, cmd)
		}
	}
	if !strings.Contains(cmd, "exit 0") {
		t.Errorf("SweepOrphansCommand must always succeed (best-effort):\n%s", cmd)
	}
}

// TestEnsureServeSweepsOrphansOnColdStart: a cold start must run the orphan
// sweep before launch; a reuse short-circuit must not.
func TestEnsureServeSweepsOrphansOnColdStart(t *testing.T) {
	skipOnWindows(t)
	root := t.TempDir()
	paths := pathsFor(root, root)

	t.Run("cold start sweeps", func(t *testing.T) {
		var portFile string
		conn := newFakeConn(t, root, func(cmd string) (remote.ExecResult, error) {
			switch {
			case strings.Contains(cmd, "swept:"):
				return ok("swept:2\n")
			case strings.Contains(cmd, "uname"):
				return ok("Linux x86_64\n")
			case strings.Contains(cmd, "command -v reasonix"):
				return ok("/usr/bin/reasonix\nreasonix v9.9.0\nportfile:yes\nsessionevents:yes\ndetachedheal:yes\ncaps:yes\n")
			case strings.Contains(cmd, "nohup"):
				if portFile != "" {
					_ = os.WriteFile(portFile, []byte("127.0.0.1:44322\n"), 0o600)
				}
				return ok("54322\n")
			case strings.Contains(cmd, "ps -p 54322"):
				return ok("1\n")
			default:
				return ok("")
			}
		})
		portFile = paths.PortFile
		if _, err := EnsureServe(context.Background(), conn, Options{Workspace: "~", Clock: time.Now}); err != nil {
			t.Fatalf("EnsureServe: %v", err)
		}
		if !conn.ranContaining("swept:") {
			t.Fatal("cold start did not run the orphan sweep")
		}
		// Sweep must precede the launch, so an orphan cannot outlive it.
		sweepIdx, launchIdx := -1, -1
		for i, c := range conn.execs {
			if strings.Contains(c, "swept:") && sweepIdx < 0 {
				sweepIdx = i
			}
			if strings.Contains(c, "nohup") && launchIdx < 0 {
				launchIdx = i
			}
		}
		if sweepIdx < 0 || launchIdx < 0 || sweepIdx > launchIdx {
			t.Fatalf("sweep (%d) must run before launch (%d)", sweepIdx, launchIdx)
		}
	})

	t.Run("reuse skips sweep", func(t *testing.T) {
		if err := os.MkdirAll(paths.Dir, 0o755); err != nil {
			t.Fatal(err)
		}
		st := ServeState{PID: 777, Addr: "127.0.0.1:5000", Workspace: root, ServeCaps: ServeCapsToken, TokenFile: paths.TokenFile}
		data, _ := MarshalState(st)
		if err := os.WriteFile(paths.StateJSON, data, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(paths.TokenFile, []byte("tok\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		conn := newFakeConn(t, root, func(cmd string) (remote.ExecResult, error) {
			switch {
			case strings.Contains(cmd, "swept:"):
				t.Error("reuse path must not run the orphan sweep")
				return ok("swept:0\n")
			case strings.Contains(cmd, "ps -p 777"):
				return ok("1\n")
			default:
				return ok("")
			}
		})
		res, err := EnsureServe(context.Background(), conn, Options{Workspace: "~", Clock: time.Now})
		if err != nil {
			t.Fatalf("EnsureServe: %v", err)
		}
		if !res.Reused {
			t.Fatal("expected reuse")
		}
	})
}

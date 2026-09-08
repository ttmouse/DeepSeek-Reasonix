package bootstrap

import (
	"context"
	"fmt"
	"time"
)

// Orphan serves accumulate whenever a launch's cleanup window is lost — the
// SSH connection drops between fork and cleanupFailedLaunch, the desktop
// crashes, or (before the locale fix) StopCommand's ownership check failed to
// match. Nothing else ever reaps them: the state files they were launched
// with are gone, so tryReuse and retireIncompatibleServe cannot see them.
// sweepOrphanServes closes that gap at bootstrap time.

// orphanGraceSeconds protects very young serve processes: a concurrent
// bootstrap on another workspace sits between fork and its state publish for
// up to ~25s (bounded launch + 20s health check), during which its serve has
// no referencing state record yet. Anything older than the grace period with
// no referencing record is an orphan by construction.
const orphanGraceSeconds = 120

// SweepOrphansCommand builds a script that TERMs every managed reasonix serve
// on the host that no serve-*.json state record references and that is older
// than the grace period. Scope guards:
//   - only processes whose command line carries --token-file .../.reasonix/remote/
//     (the .reasonix/remote fragment is pure ASCII, immune to the ps escaping
//     that broke the locale-sensitive full-path match);
//   - only pids absent from every state record's "pid" field;
//   - processes younger than the grace period are skipped; a non-parseable
//     etime counts as young (fail safe, never kill an unknown-age process).
func SweepOrphansCommand(dir string) string {
	return fmt.Sprintf(
		"DIR=%s; K=''; "+
			"REF=$(cat \"$DIR\"/serve-*.json 2>/dev/null | sed -n 's/.*\"pid\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | sort -u); "+
			"for pid in $(ps -ax -o pid= -o command= 2>/dev/null | grep 'reasonix serve --addr 127.0.0.1:0' | grep -- '--token-file .*/\\.reasonix/remote/' | awk '{print $1}'); do "+
			"case \"$REF\" in *\"$pid\"*) continue;; esac; "+
			"ET=$(ps -p \"$pid\" -o etime= 2>/dev/null | tr -d '[:space:]'); "+
			"[ -n \"$ET\" ] || continue; "+
			"S=0; OLDIFS=$IFS; IFS=:; for p in $ET; do case \"$p\" in *-*) S=999999; break;; ''|*[!0-9]*) S=0; break;; esac; S=$((S*60+p)); done; IFS=$OLDIFS; "+
			"[ \"$S\" -lt %d ] && continue; "+
			"kill -TERM \"$pid\" 2>/dev/null && K=\"$K $pid\"; "+
			"done; "+
			"[ -n \"$K\" ] && sleep 2; "+
			"for pid in $K; do kill -0 \"$pid\" 2>/dev/null && kill -KILL \"$pid\" 2>/dev/null; done; "+
			"echo \"swept:$(echo $K | wc -w | tr -d ' ')\"; exit 0",
		shellQuote(dir),
		orphanGraceSeconds,
	)
}

// sweepOrphanServes reaps unreferenced managed serves. Best effort by
// contract: a failure here must never block bootstrap — the caller logs it
// via progress and proceeds, and the next attempt sweeps again.
func sweepOrphanServes(ctx context.Context, conn Conn, home string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_, err := conn.Exec(ctx, SweepOrphansCommand(remoteDir(home)))
	return err
}

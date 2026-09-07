package main

import "strings"

// metricBucket normalizes an arbitrary label into a bounded lowercase
// alphanumeric bucket for local crash reports and diagnostics. It never
// carries user content; non-alphanumeric runs collapse to a single underscore.
func metricBucket(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "default"
	}
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "other"
	}
	if len(out) > 96 {
		return out[:96]
	}
	return out
}

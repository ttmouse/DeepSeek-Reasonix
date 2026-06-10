//go:build windows

package main

import (
	"golang.org/x/sys/windows"
)

func openURL(rawURL string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	u, err := windows.UTF16PtrFromString(rawURL)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, u, nil, nil, windows.SW_SHOWNORMAL)
}

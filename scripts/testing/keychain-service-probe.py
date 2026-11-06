#!/usr/bin/env python3
"""Disabled: selective Security.framework hooks cannot isolate a user's Keychain."""

raise SystemExit(
    "Disabled: this probe cannot prove isolation from the real macOS Keychain. "
    "Research requires a disposable macOS user account or VM with no real credentials. "
    "Do not bypass this guard or restore the selective interposer on a user's account. "
    "See docs/verification/keychain-isolated-diagnosis.md for the withdrawn evidence."
)

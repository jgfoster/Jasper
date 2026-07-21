# Reopen this walkthrough later

Closing the Welcome tab doesn't lose anything — you can bring this walkthrough
back at any time.

## Reopen it

- Click the $(mortar-board) button at the top of the **GemStone** sidebar
  (in the **Versions** view header — the easiest way back), or
- **Help → Welcome** (the Welcome tab lists all walkthroughs), or
- **Command Palette** (`Cmd/Ctrl + Shift + P`) → **"Welcome: Open Walkthrough..."**
  → **Get Started with GemStone**.

## Make it auto-open again

This walkthrough opens automatically **once per machine**, shortly after you
install the extension. After that it stays out of your way.

To make it auto-open again the next time VS Code starts, run:

> **Command Palette → "GemStone: Reset Getting Started"**

## Where that setting lives

The "already shown" flag is stored in VS Code's **global state** (the
`state.vscdb` global storage database) under the key
`gemstone.hasSeenGettingStarted`, owned by the `gemtalksystems.gemstone-ide`
extension. The **Reset Getting Started** command above is the supported way to
clear it — clearing it by hand isn't necessary.

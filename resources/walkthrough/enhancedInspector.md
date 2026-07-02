# Try the enhanced inspector

The **enhanced inspector** replaces the plain list of instance variables with
rich, object-specific views, so you can explore an object more deeply.

It requires **GemStone 3.7.5 or later** and isn't part of a stock GemStone
image, so it's installed once per stone. On older stones Jasper keeps the default
Inspector and won't offer to install it. Rather than install it here, you choose
*how* Jasper should handle it when you connect to a supported stone:

- **Ask on connect** — Jasper offers to install it when you reach a stone that
  lacks it (the default).
- **Always install** — install it automatically on connect.
- **Never** — stick with the default Inspector.

[Enhanced Inspector Auto-Install…](command:gemstone.configureEnhancedInspectorAutoInstall)

You can change this anytime from the Command Palette — press `Ctrl+Shift+P`
(`⇧⌘P` on macOS) and run
[GemStone: Enhanced Inspector Auto-Install…](command:workbench.action.quickOpen?%5B%22%3EEnhanced%20Inspector%20Auto-Install%22%5D).
Installing itself requires a SystemUser login and commits the supporting classes
to the database; the Auto-Install picker explains this when you make your choice.

<!-- The link above pre-fills the Command Palette with a search string that must
     match the command's palette label (package.json command title "Enhanced
     Inspector Auto-Install…"). If that title is renamed, update this search too. -->


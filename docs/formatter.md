# Smalltalk Formatter Settings

Fine-tune the Smalltalk formatter under `gemstoneSmalltalk.formatter.*` in your VS Code settings. Every option also shows up in the VS Code Settings UI with a live description; this page is the reference if you'd rather see them all in one place.

| Setting | Default | Description |
|---------|---------|-------------|
| `spacesInsideParens` | false | `( x )` vs `(x)` |
| `spacesInsideBrackets` | false | `[ x ]` vs `[x]` |
| `spacesInsideBraces` | false | `{ x }` vs `{x}` |
| `spacesAroundAssignment` | true | `x := y` vs `x:=y` |
| `spacesAroundBinarySelectors` | true | `a + b` vs `a+b` |
| `spaceAfterCaret` | false | `^ x` vs `^x` |
| `blankLineAfterMethodPattern` | true | Blank line between pattern and body |
| `maxLineLength` | 0 | Line wrapping (0 = off) |
| `continuationIndent` | 2 | Indent for continuation lines |
| `multiKeywordThreshold` | 2 | Keywords before splitting across lines |
| `removeUnnecessaryParens` | true | Remove parens based on Smalltalk precedence |

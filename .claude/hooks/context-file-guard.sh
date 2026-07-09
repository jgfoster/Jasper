#!/usr/bin/env bash
#
# PreToolUse hook: when an Edit/Write targets a context file (a CLAUDE.md or a
# .claude/rules/*.md), inject the editing contract in .claude/hooks/context-contract.md
# as additionalContext so the model sees it before making the change. No-op
# (silent, exit 0) for every other file, and for anything that fails to parse.
#
set -euo pipefail

input="$(cat)"

file_path="$(node -e '
  try {
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(data?.tool_input?.file_path || "");
  } catch {
    process.stdout.write("");
  }
' <<<"$input")"

if [[ -z "$file_path" ]]; then
  exit 0
fi

case "$file_path" in
  */CLAUDE.md | CLAUDE.md | */.claude/rules/*.md)
    ;;
  *)
    exit 0
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
contract_path="$script_dir/context-contract.md"

node -e '
  const fs = require("fs");
  const contractPath = process.argv[1];
  const contract = fs.readFileSync(contractPath, "utf8");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: contract,
    },
  }));
' "$contract_path"

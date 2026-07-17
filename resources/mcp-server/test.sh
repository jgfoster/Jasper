#!/usr/bin/env bash
# Integration smoke test for the native GemStone MCP server.
#
# Starts the server in its own gem (one session) via run-server.sh, then acts as an
# MCP client (a separate process) driving the Streamable HTTP transport end-to-end:
# initialize, the initialized notification, tools/list, every core tool, the error
# paths, the SSE GET stream, and DELETE. Compiles + runs a throwaway method to exercise
# compile_method/commit, then cleans it up. Shuts the server down on exit.
#
# Configure (or export before running):
#   GEMSTONE    - GemStone product directory (required)
#   GS_STONE    - stone name        (default: gs64stone)
#   GS_USER     - GemStone user     (default: DataCurator)
#   GS_PASS     - GemStone password (default: swordfish)
#   GS_MCP_PORT - test port         (default: 8011, kept off the usual 8000)
#
# Exit status 0 = all checks passed.
set -uo pipefail
cd "$(dirname "$0")"

: "${GEMSTONE:?Set GEMSTONE to your GemStone product directory}"
export GS_STONE="${GS_STONE:-gs64stone}"
export GS_USER="${GS_USER:-DataCurator}"
export GS_PASS="${GS_PASS:-swordfish}"
PORT="${GS_MCP_PORT:-8011}"
URL="http://127.0.0.1:$PORT/mcp"
SERVER_LOG="$(mktemp -t gsmcp-server.XXXXXX)"

PASS=0; FAIL=0
WRAPPER_PID=""

cleanup() {
  echo
  echo "Tearing down server on port $PORT ..."
  local pid
  pid="$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)"
  [ -n "$pid" ] && kill $pid 2>/dev/null
  [ -n "$WRAPPER_PID" ] && kill "$WRAPPER_PID" 2>/dev/null
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

# check NAME EXPECTED-SUBSTRING ACTUAL
check() {
  if printf '%s' "$3" | grep -qF -- "$2"; then
    printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %s\n' "$1"
    printf '      expected to contain: %s\n' "$2"
    printf '      got: %s\n' "$3"
    FAIL=$((FAIL+1))
  fi
}

# post  -- reads a JSON-RPC body from stdin, returns the response body
post() { curl -s -m 10 "$URL" --data-binary @-; }

echo "=== GemStone MCP server integration test ==="
echo "Stone=$GS_STONE  User=$GS_USER  Port=$PORT"
echo

# ---------------------------------------------------------------------------
echo "[1/3] Starting server gem (session A) ..."
GS_MCP_PORT="$PORT" ./run-server.sh > "$SERVER_LOG" 2>&1 &
WRAPPER_PID=$!
for i in $(seq 1 60); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 0.5; done
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "  ERROR: server did not start listening on $PORT. Server log:"
  sed 's/^/      /' "$SERVER_LOG"
  exit 1
fi
echo "  server is listening on 127.0.0.1:$PORT"
echo

# ---------------------------------------------------------------------------
echo "[2/3] Driving requests from the client (session B) ..."

# --- handshake ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}
JSON
)
check "initialize returns protocolVersion"    '"protocolVersion"'        "$r"
check "initialize returns serverInfo name"    '"name":"gemstone-mcp"'    "$r"

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL" --data-binary @- <<'JSON'
{"jsonrpc":"2.0","method":"notifications/initialized"}
JSON
)
check "initialized notification returns 202"  '202'                      "$code"

# --- tools/list ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
JSON
)
for t in execute_code status describe_class get_method_source compile_method; do
  check "tools/list includes $t"              "\"name\":\"$t\""          "$r"
done

# --- execute_code ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"3 + 4"}}}
JSON
)
check "execute_code 3+4 => 7"                 '"text":"7"'               "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"| x | x := 6. x * 7"}}}
JSON
)
check "execute_code multi-statement => 42"    '"text":"42"'              "$r"

# --- status (prints the server gem's session id) ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"status","arguments":{}}}
JSON
)
check "status reports user"                   'user='                    "$r"
echo "      server session: $(printf '%s' "$r" | grep -oE 'session=[0-9]+')"

# --- describe_class / get_method_source ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"describe_class","arguments":{"className":"GsMcpServer"}}}
JSON
)
check "describe_class GsMcpServer"            'superclass='              "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_method_source","arguments":{"className":"GsMcpServer","selector":"stop"}}}
JSON
)
check "get_method_source GsMcpServer>>stop"   'running := false'         "$r"

# --- compile_method round-trip on a throwaway class, then clean up ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"| c | c := (System myUserProfile objectNamed: #GsMcpSmokeClass) ifNil: [Object subclass: 'GsMcpSmokeClass' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()]. c comment: 'Artifact of an aborted GsMcp server test (gs-mcp/test.sh). Safe to remove.'. System commitTransaction. 'ready'"}}}
JSON
)
check "create throwaway test class"           'ready'                    "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"compile_method","arguments":{"className":"GsMcpSmokeClass","source":"answer\n  ^42","category":"smoke"}}}
JSON
)
check "compile_method commits"                'and committed'            "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"GsMcpSmokeClass new answer"}}}
JSON
)
check "compiled method runs => 42"            '"text":"42"'              "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"UserGlobals removeKey: #GsMcpSmokeClass ifAbsent: [nil]. System commitTransaction. 'cleaned'"}}}
JSON
)
check "cleanup throwaway test class"          'cleaned'                  "$r"

# --- error paths ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"1/0"}}}
JSON
)
check "execute_code 1/0 => isError true"      '"isError":true'           "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":13,"method":"no/such/method"}
JSON
)
check "unknown method => -32601"              '-32601'                   "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"does_not_exist","arguments":{}}}
JSON
)
check "unknown tool => -32602"                '-32602'                   "$r"

# ===========================================================================
# Expanded tool set (full Jasper parity)
# ===========================================================================

# --- tools/list reports the full set ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":20,"method":"tools/list"}
JSON
)
# count name fields that are string values (tool names), not nested 'name' properties
n=$(printf '%s' "$r" | grep -o '"name":"' | wc -l | tr -d ' ')
check "tools/list reports 31 tools (got $n)"  "31"                       "$n"

# --- session/transaction ---
for t in abort commit refresh; do
  r=$(post <<JSON
{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"$t","arguments":{}}}
JSON
)
  check "$t works"                            '"isError":false'          "$r"
done

# --- listing ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"list_dictionaries","arguments":{}}}
JSON
)
check "list_dictionaries includes UserGlobals" 'UserGlobals'             "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"list_classes","arguments":{"dictionaryName":"UserGlobals"}}}
JSON
)
check "list_classes(UserGlobals) has GsMcpServer" 'GsMcpServer'          "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":24,"method":"tools/call","params":{"name":"list_all_classes","arguments":{}}}
JSON
)
check "list_all_classes tags dictionary"      'GsMcpServer  (UserGlobals)' "$r"

# --- browsing ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":25,"method":"tools/call","params":{"name":"get_class_definition","arguments":{"className":"GsMcpServer"}}}
JSON
)
check "get_class_definition is a subclass: expr" 'subclass:'             "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":26,"method":"tools/call","params":{"name":"get_class_hierarchy","arguments":{"className":"GsMcpServer"}}}
JSON
)
check "get_class_hierarchy shows Object"       'Object'                  "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":27,"method":"tools/call","params":{"name":"list_methods","arguments":{"className":"GsMcpServer"}}}
JSON
)
check "list_methods shows runOnPort:"          'runOnPort:'              "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":28,"method":"tools/call","params":{"name":"export_class_source","arguments":{"className":"GsMcpTool"}}}
JSON
)
check "export_class_source is file-in format"  'set compile_env'         "$r"

# --- search ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":29,"method":"tools/call","params":{"name":"find_implementors","arguments":{"selector":"runOnPort:"}}}
JSON
)
check "find_implementors finds runOnPort:"     'GsMcpServer>>runOnPort:' "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"find_senders","arguments":{"selector":"serveGetStream:"}}}
JSON
)
check "find_senders finds the caller"          'buildRoutes'       "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"find_references_to","arguments":{"name":"GsMcpTool"}}}
JSON
)
check "find_references_to GsMcpTool"           'GsMcpToolRegistry'       "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"search_method_source","arguments":{"pattern":"writeSseStreamHeaders","dictionaryName":"UserGlobals"}}}
JSON
)
check "search_method_source finds usage"       'serveGetStream:'         "$r"

# --- testing (SUnit, read-only against a kernel test) ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":33,"method":"tools/call","params":{"name":"list_test_classes","arguments":{}}}
JSON
)
check "list_test_classes includes SUnitTest"   'SUnitTest'               "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":34,"method":"tools/call","params":{"name":"run_test_class","arguments":{"className":"SUnitTest"}}}
JSON
)
check "run_test_class SUnitTest reports passed" 'passed'                 "$r"

# --- mutation + failing-test path on a throwaway TestCase, then clean up ---
r=$(post <<'JSON'
{"jsonrpc":"2.0","id":35,"method":"tools/call","params":{"name":"compile_class_definition","arguments":{"source":"TestCase subclass: 'GsMcpParityTest' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()"}}}
JSON
)
check "compile_class_definition creates class" 'committed class: GsMcpParityTest' "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":36,"method":"tools/call","params":{"name":"compile_method","arguments":{"className":"GsMcpParityTest","source":"testWillFail self assert: 1 = 2","category":"tests"}}}
JSON
)
check "compile_method onto parity class"       'and committed'           "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":37,"method":"tools/call","params":{"name":"run_test_method","arguments":{"className":"GsMcpParityTest","selector":"testWillFail"}}}
JSON
)
check "run_test_method reports the failure"    '1 failed'                "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":38,"method":"tools/call","params":{"name":"describe_test_failure","arguments":{"className":"GsMcpParityTest","selector":"testWillFail"}}}
JSON
)
check "describe_test_failure gives detail"     'Assertion failed'        "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":39,"method":"tools/call","params":{"name":"list_failing_tests","arguments":{"classNames":["GsMcpParityTest"]}}}
JSON
)
check "list_failing_tests lists the failure"   'GsMcpParityTest>>testWillFail' "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"set_class_comment","arguments":{"className":"GsMcpParityTest","comment":"throwaway parity test"}}}
JSON
)
check "set_class_comment commits"              'and committed'           "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"delete_method","arguments":{"className":"GsMcpParityTest","selector":"testWillFail"}}}
JSON
)
check "delete_method removes the method"       'Deleted method'          "$r"

r=$(post <<'JSON'
{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"delete_class","arguments":{"className":"GsMcpParityTest"}}}
JSON
)
check "delete_class removes the class"         'Deleted class'           "$r"

# --- transport: SSE GET stream ---
r=$(curl -s -i -N -m 3 "$URL" 2>&1 | head -12)
check "GET /mcp => text/event-stream"         'text/event-stream'        "$r"
check "GET /mcp sends 'connected' comment"    ': connected'              "$r"

# --- transport: DELETE ---
r=$(curl -s -i -m 10 -X DELETE "$URL" 2>&1 | head -1)
check "DELETE /mcp => 200"                     '200'                     "$r"

# ---------------------------------------------------------------------------
echo
echo "[3/3] Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

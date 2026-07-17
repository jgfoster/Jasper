set compile_env: 0
! ------------------- Class definition for GsMcpServerWithGrailTest
expectvalue /Class
doit
GsTestCase subclass: 'GsMcpServerWithGrailTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()
%
expectvalue /Class
doit
GsMcpServerWithGrailTest comment:
'Tests for the optional Grail-powered python tools on GsMcpServerWithGrail (eval_python /
compile_python). Loaded only on a Grail-equipped image (see load-grail.gs); the base suites
(GsMcpToolTest, GsMcpDispatcherTest, GsMcpTransportTest) cover the Grail-free server. Uses valid
Python and a transpile-time semantic error only -- Python *syntax* and *runtime* errors crash
the gem, so those two paths are switched-off tripwires gated by class-side flags.'
%
expectvalue /Class
doit
GsMcpServerWithGrailTest category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpServerWithGrailTest
removeallmethods GsMcpServerWithGrailTest
removeallclassmethods GsMcpServerWithGrailTest
! ------------------- Class methods for GsMcpServerWithGrailTest
category: 'enablement'
classmethod: GsMcpServerWithGrailTest
pythonRuntimeErrorsThrow
  "Whether Grail raises a catchable exception on a Python *runtime* error (e.g. 1/0) instead
   of crashing the gem. Currently false: a runtime exception crashes the session below the
   Smalltalk exception layer, just as a syntax error does (a Grail bug; a fix is in progress).
   Flip to true once Grail is fixed to activate testToolsCallWrapsPythonRuntimeErrorAsIsError.
   WARNING: returning true while the bug remains will crash the server gem when that test runs."
  ^false
%
category: 'enablement'
classmethod: GsMcpServerWithGrailTest
pythonSyntaxErrorsThrow
  "Whether Grail raises a catchable exception on a Python *syntax* error instead of crashing
   the gem. Currently false: `def (:` and similar malformed input crash the session below the
   Smalltalk exception layer (a Grail parser bug; a fix is in progress). Flip to true once
   Grail is fixed to activate testToolsCallWrapsPythonSyntaxErrorAsIsError.
   WARNING: returning true while the bug remains will crash the server gem when that test runs."
  ^false
%
! ------------------- Instance methods for GsMcpServerWithGrailTest
category: 'helpers'
method: GsMcpServerWithGrailTest
dispatch: requestDict
  "Route requestDict through a dispatcher over the Grail server's registry; answer the response."
  ^(GsMcpDispatcher withToolRegistry: GsMcpServerWithGrail new toolRegistry) handle: requestDict
%
category: 'helpers'
method: GsMcpServerWithGrailTest
includesCS: aSubstring in: aString
  "Case-sensitive substring test (String>>includesString: is case-INsensitive)."
  ^(aString findString: aSubstring startingAt: 1) > 0
%
category: 'helpers'
method: GsMcpServerWithGrailTest
mcp
  "A fresh Grail server whose tool_* handlers we exercise directly (no socket)."
  ^GsMcpServerWithGrail new
%
category: 'helpers'
method: GsMcpServerWithGrailTest
oneArg: key value: value
  | d |
  d := Dictionary new.
  d at: key put: value.
  ^d
%
category: 'helpers'
method: GsMcpServerWithGrailTest
request: methodName params: paramsDict
  | d |
  d := Dictionary new.
  d at: 'jsonrpc' put: '2.0'.
  d at: 'id' put: 1.
  d at: 'method' put: methodName.
  paramsDict ifNotNil: [d at: 'params' put: paramsDict].
  ^d
%
category: 'helpers'
method: GsMcpServerWithGrailTest
toolCall: toolName args: argsDict
  ^self request: 'tools/call' params:
    (Dictionary new at: 'name' put: toolName; at: 'arguments' put: argsDict; yourself)
%
category: 'tests'
method: GsMcpServerWithGrailTest
testCompilePython
  "Transpile a Python assignment to Smalltalk."
  self assert: (self includesCS: '__mul__'
    in: (self mcp tool_compile_python: (self oneArg: 'code' value: 'x = 6 * 7')))
%
category: 'tests'
method: GsMcpServerWithGrailTest
testEvalPython
  "Evaluate a Python expression and get the printString of the result."
  self assert: (self mcp tool_eval_python: (self oneArg: 'code' value: '6 * 7')) equals: '42'
%
category: 'tests'
method: GsMcpServerWithGrailTest
testToolsCallPythonPrintReturnsNone
  "Pins current Grail behavior: Python print() succeeds and yields None. It no longer raises
   the dead-stdout ImproperOperation (2364) it once did after the dispatcher's abort. A
   tripwire: if print reverts to raising (or starts crashing), this flags the change."
  | result |
  result := (self dispatch: (self toolCall: 'eval_python' args: (Dictionary new at: 'code' put: 'print(6 * 7)'; yourself))) at: 'result'.
  self deny: (result at: 'isError').
  self assert: ((result at: 'content') first at: 'text') equals: 'None'
%
category: 'tests'
method: GsMcpServerWithGrailTest
testToolsCallWrapsPythonErrorAsIsError
  "A Python *semantic* error (undefined name) reaches Grail and raises a catchable CompileError,
   which the dispatcher wraps as isError -- confirming the python tools have no own error
   handling and rely on handleToolsCall:id:. Uses a semantic error, never a syntax/runtime error
   (which crash the gem until Grail is fixed)."
  | result text |
  result := (self dispatch: (self toolCall: 'eval_python' args: (Dictionary new at: 'code' put: 'undefined_xyz'; yourself))) at: 'result'.
  self assert: (result at: 'isError').
  text := (result at: 'content') first at: 'text'.
  self assert: (text includesString: 'CompileError').
  self assert: (text includesString: 'undefined_xyz')
%
category: 'tests'
method: GsMcpServerWithGrailTest
testToolsCallWrapsPythonRuntimeErrorAsIsError
  "Tripwire for the day Grail stops crashing on a Python *runtime* exception. Guarded by
   GsMcpServerWithGrailTest class>>pythonRuntimeErrorsThrow (currently false), so today it
   no-ops: a runtime error like `1 / 0` still crashes the gem (uncatchable, below the Smalltalk
   exception layer), just as a syntax error does. Once Grail raises instead, flip
   pythonRuntimeErrorsThrow to true and this verifies the error surfaces as isError, like the
   CompileError path. When it first runs for real, tighten the text check to whatever a fixed
   Grail actually raises."
  | result text |
  self class pythonRuntimeErrorsThrow ifFalse: [^self].
  result := (self dispatch: (self toolCall: 'eval_python' args: (Dictionary new at: 'code' put: '1 / 0'; yourself))) at: 'result'.
  self assert: (result at: 'isError').
  text := (result at: 'content') first at: 'text'.
  self assert: text isEmpty not
%
category: 'tests'
method: GsMcpServerWithGrailTest
testToolsCallWrapsPythonSyntaxErrorAsIsError
  "Tripwire for the day Grail stops crashing on malformed Python. Guarded by
   GsMcpServerWithGrailTest class>>pythonSyntaxErrorsThrow (currently false), so today it
   no-ops: a Python *syntax* error still crashes the gem and must never be sent through a live
   suite. Once Grail raises instead, flip pythonSyntaxErrorsThrow to true and this verifies a
   syntax error surfaces as isError, like the CompileError path. When it first runs for real,
   tighten the text check to whatever exception a fixed Grail actually raises."
  | result text |
  self class pythonSyntaxErrorsThrow ifFalse: [^self].
  result := (self dispatch: (self toolCall: 'eval_python' args: (Dictionary new at: 'code' put: 'def (:'; yourself))) at: 'result'.
  self assert: (result at: 'isError').
  text := (result at: 'content') first at: 'text'.
  self assert: text isEmpty not
%
category: 'tests'
method: GsMcpServerWithGrailTest
testToolsListHasPythonToolsAnd33
  "The Grail server registers 33 tools -- the base 31 plus eval_python and compile_python --
   alphabetically."
  | tools names |
  tools := ((self dispatch: (self request: 'tools/list' params: nil)) at: 'result') at: 'tools'.
  names := (tools collect: [:d | d at: 'name']) asArray.
  self assert: names size equals: 33.
  self assert: names equals: names asSortedCollection asArray.
  self assert: (names includes: 'eval_python').
  self assert: (names includes: 'compile_python')
%

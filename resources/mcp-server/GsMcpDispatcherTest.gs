set compile_env: 0
! ------------------- Class definition for GsMcpDispatcherTest
expectvalue /Class
doit
GsTestCase subclass: 'GsMcpDispatcherTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()

%
! ------------------- Remove existing behavior from GsMcpDispatcherTest
removeallmethods GsMcpDispatcherTest
removeallclassmethods GsMcpDispatcherTest
! ------------------- Class methods for GsMcpDispatcherTest
! ------------------- Instance methods for GsMcpDispatcherTest
category: 'helpers'
method: GsMcpDispatcherTest
dispatch: requestDict
  "Route requestDict through a fresh dispatcher; answer the response Dictionary (or nil)."
  ^(GsMcpDispatcher withToolRegistry: GsMcpServer new toolRegistry) handle: requestDict
%
category: 'helpers'
method: GsMcpDispatcherTest
notification: methodName
  "A JSON-RPC notification (no id)."
  | d |
  d := Dictionary new.
  d at: 'jsonrpc' put: '2.0'.
  d at: 'method' put: methodName.
  ^d
%
category: 'helpers'
method: GsMcpDispatcherTest
request: methodName params: paramsDict
  | d |
  d := Dictionary new.
  d at: 'jsonrpc' put: '2.0'.
  d at: 'id' put: 1.
  d at: 'method' put: methodName.
  paramsDict ifNotNil: [d at: 'params' put: paramsDict].
  ^d
%
category: 'tests'
method: GsMcpDispatcherTest
testInitialize
  | result |
  result := (self dispatch: (self request: 'initialize' params: Dictionary new)) at: 'result'.
  self assert: (result at: 'protocolVersion') equals: '2024-11-05'.
  self assert: ((result at: 'serverInfo') at: 'name') equals: 'gemstone-mcp'.
  self assert: ((result at: 'capabilities') includesKey: 'tools')
%
category: 'tests'
method: GsMcpDispatcherTest
testNilRequestReturnsParseError
  self assert: (((self dispatch: nil) at: 'error') at: 'code') equals: -32700
%
category: 'tests'
method: GsMcpDispatcherTest
testNotificationReturnsNil
  self assert: (self dispatch: (self notification: 'notifications/initialized')) isNil
%
category: 'tests'
method: GsMcpDispatcherTest
testToolsCallSuccessEnvelope
  | result |
  result := (self dispatch: (self toolCall: 'execute_code' args: (Dictionary new at: 'code' put: '3 + 4'; yourself))) at: 'result'.
  self deny: (result at: 'isError').
  self assert: ((result at: 'content') first at: 'text') equals: '7'
%
category: 'tests'
method: GsMcpDispatcherTest
testToolsCallWrapsErrorsAsIsError
  | result |
  result := (self dispatch: (self toolCall: 'execute_code' args: (Dictionary new at: 'code' put: '1/0'; yourself))) at: 'result'.
  self assert: (result at: 'isError').
  self assert: (((result at: 'content') first at: 'text') includesString: 'ZeroDivide')
%
category: 'tests'
method: GsMcpDispatcherTest
testToolsListIsAlphabeticalAnd31
  | tools names |
  tools := ((self dispatch: (self request: 'tools/list' params: nil)) at: 'result') at: 'tools'.
  names := (tools collect: [:d | d at: 'name']) asArray.
  self assert: names size equals: 31.
  self assert: names equals: names asSortedCollection asArray
%
category: 'tests'
method: GsMcpDispatcherTest
testUnknownMethodReturns32601
  | resp |
  resp := self dispatch: (self request: 'no/such/method' params: nil).
  self assert: ((resp at: 'error') at: 'code') equals: -32601
%
category: 'tests'
method: GsMcpDispatcherTest
testUnknownToolReturns32602
  | resp |
  resp := self dispatch: (self toolCall: 'does_not_exist' args: Dictionary new).
  self assert: ((resp at: 'error') at: 'code') equals: -32602
%
category: 'helpers'
method: GsMcpDispatcherTest
toolCall: toolName args: argsDict
  ^self request: 'tools/call' params:
    (Dictionary new at: 'name' put: toolName; at: 'arguments' put: argsDict; yourself)
%

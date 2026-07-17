set compile_env: 0
! ------------------- Class definition for GsMcpDispatcher
expectvalue /Class
doit
Object subclass: 'GsMcpDispatcher'
  instVarNames: #( toolRegistry serverName serverVersion protocolVersion)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()
%
expectvalue /Class
doit
GsMcpDispatcher comment:
'The JSON-RPC 2.0 / MCP routing layer. Given a parsed request Dictionary it routes
initialize / tools/list / tools/call and notifications, invokes tools via the
registry, and returns a response Dictionary (or nil for notifications). Aborts the
transaction before each tools/call so the view reflects commits from other sessions.'
%
expectvalue /Class
doit
GsMcpDispatcher category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpDispatcher
removeallmethods GsMcpDispatcher
removeallclassmethods GsMcpDispatcher
! ------------------- Class methods for GsMcpDispatcher
category: 'instance creation'
classmethod: GsMcpDispatcher
withToolRegistry: aRegistry
  ^self new setRegistry: aRegistry
%
! ------------------- Instance methods for GsMcpDispatcher
category: 'initialization'
method: GsMcpDispatcher
setRegistry: aRegistry
  toolRegistry := aRegistry.
  protocolVersion := '2024-11-05'.
  serverName := 'gemstone-mcp'.
  serverVersion := '0.1.0'.
  ^self
%
category: 'dispatch'
method: GsMcpDispatcher
handle: requestDict
  "Route a parsed JSON-RPC request Dictionary. Returns a response Dictionary,
   or nil when no response should be sent (notifications)."
  | method id |
  requestDict isNil ifTrue: [^self errorFor: nil code: -32700 message: 'Parse error'].
  method := requestDict at: 'method' ifAbsent: [nil].
  id := requestDict at: 'id' ifAbsent: [nil].
  method isNil ifTrue: [^self errorFor: id code: -32600 message: 'Invalid Request'].
  method = 'initialize' ifTrue: [^self resultFor: id with: self initializeResult].
  method = 'tools/list' ifTrue: [^self resultFor: id with: self toolsListResult].
  method = 'tools/call' ifTrue: [
    ^self handleToolsCall: (requestDict at: 'params' ifAbsent: [Dictionary new]) id: id].
  (method beginsWith: 'notifications/') ifTrue: [^nil].
  id isNil ifTrue: [^nil].
  ^self errorFor: id code: -32601 message: 'Method not found: ' , method
%
category: 'dispatch'
method: GsMcpDispatcher
handleToolsCall: params id: id
  "Refresh the view, look up and invoke the named tool, wrap the result."
  | name tool |
  name := params at: 'name' ifAbsent: [nil].
  name isNil ifTrue: [^self errorFor: id code: -32602 message: 'Missing tool name'].
  tool := toolRegistry at: name.
  tool isNil ifTrue: [^self errorFor: id code: -32602 message: 'Unknown tool: ' , name].
  System abortTransaction.
  ^[ | text |
     text := tool callWith: (params at: 'arguments' ifAbsent: [Dictionary new]).
     self resultFor: id with: (self contentText: text isError: false) ]
   on: Error
   do: [:ex | self resultFor: id with:
       (self contentText: ([ex description] on: Error do: [:e | ex messageText ifNil: ['(error)']]) isError: true) ]
%
category: 'responses'
method: GsMcpDispatcher
resultFor: id with: resultObj
  | d |
  d := Dictionary new.
  d at: 'jsonrpc' put: '2.0'.
  d at: 'id' put: id.
  d at: 'result' put: resultObj.
  ^d
%
category: 'responses'
method: GsMcpDispatcher
errorFor: id code: aCode message: aMessage
  | d err |
  err := Dictionary new.
  err at: 'code' put: aCode.
  err at: 'message' put: aMessage.
  d := Dictionary new.
  d at: 'jsonrpc' put: '2.0'.
  d at: 'id' put: id.
  d at: 'error' put: err.
  ^d
%
category: 'responses'
method: GsMcpDispatcher
contentText: aString isError: aBool
  "Build the MCP tools/call result envelope: {content:[{type:text,text:...}], isError:bool}."
  | item content d |
  item := Dictionary new.
  item at: 'type' put: 'text'.
  item at: 'text' put: (aString ifNil: ['']).
  content := Array with: item.
  d := Dictionary new.
  d at: 'content' put: content.
  d at: 'isError' put: aBool.
  ^d
%
category: 'responses'
method: GsMcpDispatcher
initializeResult
  | caps tools info d |
  tools := Dictionary new.
  caps := Dictionary new.
  caps at: 'tools' put: tools.
  info := Dictionary new.
  info at: 'name' put: serverName.
  info at: 'version' put: serverVersion.
  d := Dictionary new.
  d at: 'protocolVersion' put: protocolVersion.
  d at: 'capabilities' put: caps.
  d at: 'serverInfo' put: info.
  ^d
%
category: 'responses'
method: GsMcpDispatcher
toolsListResult
  | d |
  d := Dictionary new.
  d at: 'tools' put: toolRegistry descriptors.
  ^d
%

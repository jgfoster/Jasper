set compile_env: 0
! ------------------- Class definition for GsMcpToolRegistry
expectvalue /Class
doit
Object subclass: 'GsMcpToolRegistry'
  instVarNames: #( tools)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()
%
expectvalue /Class
doit
GsMcpToolRegistry comment:
'Holds the set of GsMcpTool instances keyed by tool name. Produces the descriptor
list for MCP tools/list and looks up tools for tools/call.'
%
expectvalue /Class
doit
GsMcpToolRegistry category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpToolRegistry
removeallmethods GsMcpToolRegistry
removeallclassmethods GsMcpToolRegistry
! ------------------- Class methods for GsMcpToolRegistry
category: 'instance creation'
classmethod: GsMcpToolRegistry
new
  ^super new initialize
%
! ------------------- Instance methods for GsMcpToolRegistry
category: 'initialization'
method: GsMcpToolRegistry
initialize
  tools := Dictionary new
%
category: 'registration'
method: GsMcpToolRegistry
register: aTool
  tools at: aTool name put: aTool.
  ^aTool
%
category: 'registration'
method: GsMcpToolRegistry
name: aName description: aDescription inputSchema: aSchema do: aBlock
  "Convenience: build and register a tool in one line."
  ^self register:
    (GsMcpTool name: aName description: aDescription inputSchema: aSchema handler: aBlock)
%
category: 'accessing'
method: GsMcpToolRegistry
at: aName
  "Return the tool registered under aName, or nil."
  ^tools at: aName ifAbsent: [nil]
%
category: 'accessing'
method: GsMcpToolRegistry
descriptors
  "An Array of MCP tool descriptors for tools/list, sorted alphabetically by tool name."
  ^(tools keys asSortedCollection asArray) collect: [:toolName | (tools at: toolName) descriptor]
%

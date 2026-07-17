set compile_env: 0
! ------------------- Class definition for GsMcpTool
expectvalue /Class
doit
Object subclass: 'GsMcpTool'
  instVarNames: #( name description schema handler)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()
%
expectvalue /Class
doit
GsMcpTool comment:
'A single MCP tool: a name, human description, JSON-Schema (a Dictionary) for its
arguments, and a one-argument handler block [:argsDict | aString] that performs the
work and returns a String. Part of the native GemStone MCP server (see GsMcpServer).'
%
expectvalue /Class
doit
GsMcpTool category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpTool
removeallmethods GsMcpTool
removeallclassmethods GsMcpTool
! ------------------- Class methods for GsMcpTool
category: 'instance creation'
classmethod: GsMcpTool
name: aName description: aDescription inputSchema: aSchema handler: aBlock
  "aSchema is a Dictionary describing the JSON Schema of the tool's arguments.
   aBlock is a one-argument block [:argsDict | ...] returning a String result."
  ^self new
    setName: aName description: aDescription inputSchema: aSchema handler: aBlock
%
! ------------------- Instance methods for GsMcpTool
category: 'initialization'
method: GsMcpTool
setName: aName description: aDescription inputSchema: aSchema handler: aBlock
  name := aName.
  description := aDescription.
  schema := aSchema.
  handler := aBlock.
  ^self
%
category: 'accessing'
method: GsMcpTool
name
  ^name
%
category: 'converting'
method: GsMcpTool
descriptor
  "The MCP tools/list entry for this tool."
  | d |
  d := Dictionary new.
  d at: 'name' put: name.
  d at: 'description' put: description.
  d at: 'inputSchema' put: schema.
  ^d
%
category: 'evaluating'
method: GsMcpTool
callWith: argsDict
  "Invoke the handler with the supplied arguments Dictionary (may be nil).
   Returns a String. Any error raised propagates to the dispatcher."
  ^handler value: (argsDict ifNil: [Dictionary new])
%

set compile_env: 0
! ------------------- Class definition for GsMcpServerWithGrail
expectvalue /Class
doit
GsMcpServer subclass: 'GsMcpServerWithGrail'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()
%
expectvalue /Class
doit
GsMcpServerWithGrail comment:
'A GsMcpServer that additionally registers the GemStone-Python (Grail) tools -- eval_python
and compile_python. Kept as an optional subclass so the base server loads and runs on images
without Grail/ModuleAst: load this file only into a Grail-equipped image. run-server.sh boots
this class when its file has been loaded, otherwise the base server.

The two tools call ModuleAst directly with no capability check and no own error handling
(errors propagate to GsMcpDispatcher>>handleToolsCall:id:, as with execute_code). They require
an image where Grail raises exceptions on Python syntax/runtime errors rather than crashing the
gem.'
%
expectvalue /Class
doit
GsMcpServerWithGrail category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpServerWithGrail
removeallmethods GsMcpServerWithGrail
removeallclassmethods GsMcpServerWithGrail
! ------------------- Class methods for GsMcpServerWithGrail
! ------------------- Instance methods for GsMcpServerWithGrail
category: 'initialization'
method: GsMcpServerWithGrail
initialize
  "Register the base tools (super), then add the Grail-powered python tools."
  super initialize.
  self registerPythonTools.
  ^self
%
category: 'tool registration'
method: GsMcpServerWithGrail
registerPythonTools
  "Handlers live in the 'tools - python' category. These require an image with
   GemStone-Python (Grail/ModuleAst) whose parser raises exceptions on syntax errors
   rather than crashing the gem; no capability check is performed."
  | codeArg |
  codeArg := self objectSchema:
    (Dictionary new at: 'code' put: (self propString: 'Python source code'); yourself)
    required: (Array with: 'code').
  toolRegistry name: 'compile_python'
    description: 'Transpile Python source to Smalltalk via Grail (ModuleAst) and return the generated Smalltalk source. Requires GemStone-Python in the image.'
    inputSchema: codeArg do: [:args | self tool_compile_python: args].
  toolRegistry name: 'eval_python'
    description: 'Evaluate Python source via Grail (ModuleAst) and return the printString of the result. Requires GemStone-Python in the image.'
    inputSchema: codeArg do: [:args | self tool_eval_python: args].
  ^self
%
category: 'tools - python'
method: GsMcpServerWithGrail
tool_compile_python: args
  "Transpile Python source to Smalltalk via Grail and answer the generated source.
   See tool_eval_python: for the image requirements and error-handling contract."
  ^self capResult: (ModuleAst parseSource: (args at: 'code')) smalltalkSource
%
category: 'tools - python'
method: GsMcpServerWithGrail
tool_eval_python: args
  "Evaluate Python source via Grail and answer the printString of the result.
   No ModuleAst capability check and no own error handling: errors propagate to
   GsMcpDispatcher>>handleToolsCall:id: (as with execute_code). Requires an image
   with GemStone-Python (ModuleAst) whose parser raises on syntax/runtime errors rather
   than crashing the gem."
  ^self capResult: (ModuleAst evaluateSource: (args at: 'code')) printString
%

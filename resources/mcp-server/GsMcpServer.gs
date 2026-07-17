set compile_env: 0
! ------------------- Class definition for GsMcpServer
expectvalue /Class
doit
Object subclass: 'GsMcpServer'
  instVarNames: #( dispatcher isRunning mutex
                    routesTable serverSocket toolRegistry )
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()

%
expectvalue /Class
doit
GsMcpServer comment: 
'Native GemStone MCP server. Runs a blocking HTTP/1.1 accept loop on localhost that
speaks JSON-RPC 2.0 / MCP (single POST /mcp endpoint), dispatching tool calls to
direct in-image Smalltalk execution. Replaces the Node.js + GCI/FFI bridge.

IMPORTANT: runOnPort: is BLOCKING and is meant to be the main activity of a
dedicated gem. Forked GsProcesses only run while the gem is actively executing
Smalltalk, so a background fork in an idle GCI session would never serve requests.

Start (from a dedicated gem / topaz session):
    GsMcpServer runOnPort: 8000

Test it:
    curl -s localhost:8000/mcp -d ''{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}''
'
%
expectvalue /Class
doit
GsMcpServer category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpServer
removeallmethods GsMcpServer
removeallclassmethods GsMcpServer
! ------------------- Class methods for GsMcpServer
category: 'instance creation'
classmethod: GsMcpServer
new
  ^super new initialize
%
category: 'instance creation'
classmethod: GsMcpServer
runOnPort: aPort
  "Convenience: create a server and run its (blocking) accept loop. Intended as
   the main activity of a dedicated gem."
  ^self new runOnPort: aPort
%
! ------------------- Instance methods for GsMcpServer
category: 'schema building'
method: GsMcpServer
boolProperty: aDescription
  | d |
  d := Dictionary new.
  d at: 'type' put: 'boolean'.
  d at: 'description' put: aDescription.
  ^d
%
category: 'running'
method: GsMcpServer
buildRoutes
  "HTTP method -> [:req :conn | ...] handler table for the Streamable HTTP transport.
   Built once in initialize and cached in `routesTable`. Unknown methods get a 405 in
   handleConnection: (the at:ifAbsent: branch)."
  | d |
  d := Dictionary new.
  d at: 'POST'   put: [:req :conn | self servePost: req on: conn].
  d at: 'GET'    put: [:req :conn | self serveGetStream: conn].
  d at: 'DELETE' put: [:req :conn | conn writeStatus: 200 reason: 'OK' body: ''].
  ^d
%
category: 'private'
method: GsMcpServer
capResult: aString
  "Cap an arbitrary tool result at 50000 characters so a huge value can't swamp the
   client. Shared by execute_code (and by eval_python/compile_python in GsMcpServerWithGrail)."
  ^aString size > 50000
    ifTrue: [(aString copyFrom: 1 to: 50000) , ' ...[truncated]']
    ifFalse: [aString]
%
category: 'private'
method: GsMcpServer
classNameFromDefinition: source
  "The class name in a 'Super subclass: ''Name'' ...' definition: the substring between the
   first two single quotes, as a Symbol. Returns nil if the source has no quoted literal
   (e.g. a symbol-form name) -- callers then treat it as a plain redefine."
  | q1 q2 |
  q1 := source indexOf: $' ifAbsent: [^nil].
  q2 := source indexOf: $' startingAt: q1 + 1 ifAbsent: [^nil].
  ^(source copyFrom: q1 + 1 to: q2 - 1) asSymbol
%
category: 'private'
method: GsMcpServer
dictNamed: aName
  "Find a symbol dictionary by name in the current symbol list, or nil."
  System myUserProfile symbolList do: [:d | d name asString = aName ifTrue: [^d]].
  ^nil
%
category: 'private'
method: GsMcpServer
flattenMethods: aCollection
  "Flatten into a flat OrderedCollection of GsNMethod. Accepts a flat collection of GsNMethod
   (implementorsOf:/referencesToObject:) or a nested collection of collections (sendersOf:)."
  | methods |
  methods := OrderedCollection new.
  aCollection do: [:e |
    (e isKindOf: GsNMethod)
      ifTrue: [methods add: e]
      ifFalse: [(e isKindOf: Collection) ifTrue: [
        e do: [:m | (m isKindOf: GsNMethod) ifTrue: [methods add: m]]]]].
  ^methods
%
category: 'private'
method: GsMcpServer
formatMethodList: aCollection
  "Format GsNMethods as readable lines: Class>>selector  [category]. Accepts flat or nested
   collections of GsNMethod (see flattenMethods:)."
  | methods s |
  methods := self flattenMethods: aCollection.
  methods isEmpty ifTrue: [^'(none)'].
  s := WriteStream on: String new.
  methods do: [:m | | cat |
    cat := [m inClass categoryOfSelector: m selector] on: Error do: [:e | nil].
    s nextPutAll: m inClass name asString; nextPutAll: '>>'; nextPutAll: m selector asString.
    cat ifNotNil: [s nextPutAll: '  ['; nextPutAll: cat asString; nextPutAll: ']'].
    s nextPut: Character lf].
  ^s contents
%
category: 'private'
method: GsMcpServer
formatTestResult: aTestResult label: aLabel
  "Summary line plus one line per non-passing test. GemStone's TestResult reports each failure/
   error as a descriptive String (e.g. 'SomeTest debug: #testFoo'); emit those.
   Cross-version: GS 3.6.2's TestResult returns the SAME set from #failures and #errors (and an
   inflated #runCount), so label #failures FAIL and only the #errors NOT already in #failures as
   ERROR, and derive run = passed + failed + errorOnly. (Neither collection repeats a test
   internally, so the reject: is the only de-duplication needed.) On 3.7.x the two sets are
   disjoint, so output is unchanged there; on 3.6.2 (where everything lands in #failures) all
   non-passing tests read as FAIL. Never use aTestResult printString: its printOn: varies by
   SUnit version and can send #shouldPass to the String entries, raising an MNU."
  | failed errorOnly passed s |
  failed := aTestResult failures collect: [:t | t asString].
  errorOnly := (aTestResult errors collect: [:t | t asString])
    reject: [:k | failed includes: k].
  passed := aTestResult passedCount.
  s := WriteStream on: String new.
  s nextPutAll: aLabel; nextPutAll: ': '.
  s nextPutAll: (passed + failed size + errorOnly size) printString; nextPutAll: ' run, '.
  s nextPutAll: passed printString; nextPutAll: ' passed, '.
  s nextPutAll: failed size printString; nextPutAll: ' failed, '.
  s nextPutAll: errorOnly size printString; nextPutAll: ' errors'.
  (failed isEmpty and: [errorOnly isEmpty]) ifFalse: [
    s nextPut: Character lf.
    failed asSortedCollection do: [:k | s nextPutAll: '  FAIL  '; nextPutAll: k; nextPut: Character lf].
    errorOnly asSortedCollection do: [:k | s nextPutAll: '  ERROR '; nextPutAll: k; nextPut: Character lf]].
  ^s contents
%
category: 'running'
method: GsMcpServer
handleConnection: aConnection
  "Streamable HTTP routing for one connection: POST = JSON-RPC, GET = standalone SSE
   stream, DELETE = session end. The verb is looked up in the cached `routesTable` dictionary;
   unknown verbs fall through to 405. Runs in its own GsProcess; errors are contained."
  [ | req httpMethod handler |
    req := aConnection readRequest.
    req isNil ifFalse: [
      httpMethod := (req at: 'method' ifAbsent: ['']) asUppercase.
      handler := routesTable
        at: httpMethod
        ifAbsent: [[:rq :conn | conn writeStatus: 405 reason: 'Method Not Allowed' body: '']].
      handler value: req value: aConnection]
  ] on: Error do: [:ex |
    self log: 'GsMcpServer handleConnection: error: ' , (ex messageText ifNil: [ex description]).
    [aConnection writeStatus: 500 reason: 'Internal Server Error'
       body: '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"Internal error"}}']
      on: Error do: [:e | nil]].
  aConnection close
%
category: 'initialization'
method: GsMcpServer
initialize
  toolRegistry := GsMcpToolRegistry new.
  dispatcher := GsMcpDispatcher withToolRegistry: toolRegistry.
  mutex := Semaphore forMutualExclusion.
  routesTable := self buildRoutes.
  isRunning := false.
  self registerBrowsingTools.
  self registerExecutionTools.
  self registerListingTools.
  self registerMutationTools.
  self registerSearchTools.
  self registerSessionTools.
  self registerTestTools.
  ^self
%
category: 'private'
method: GsMcpServer
linesFrom: aCollectionOfStrings
  "Sort the strings and join them one per line; '(none)' if empty."
  | s |
  aCollectionOfStrings isEmpty ifTrue: [^'(none)'].
  s := WriteStream on: String new.
  (aCollectionOfStrings asSortedCollection asArray) do: [:n |
    s nextPutAll: n asString; nextPut: Character lf].
  ^s contents
%
category: 'private'
method: GsMcpServer
log: aString
  "Best-effort logging to the gem's log file; never fails the caller."
  [GsFile gciLogServer: aString] on: Error do: [:ex | nil]
%
category: 'private'
method: GsMcpServer
methodsReportFor: aBehavior label: aLabel
  "Group aBehavior's selectors by category into a readable report."
  | byCat s |
  byCat := Dictionary new.
  aBehavior selectors do: [:sel | | cat |
    cat := (aBehavior categoryOfSelector: sel) ifNil: [#'(uncategorized)'].
    (byCat at: cat asString ifAbsentPut: [OrderedCollection new]) add: sel asString].
  s := WriteStream on: String new.
  s nextPutAll: aLabel; nextPutAll: ' methods:'; nextPut: Character lf.
  byCat keys asSortedCollection do: [:cat |
    s nextPutAll: '  '; nextPutAll: cat; nextPut: Character lf.
    (byCat at: cat) asSortedCollection do: [:sel | s nextPutAll: '    '; nextPutAll: sel; nextPut: Character lf]].
  ^s contents
%
category: 'schema building'
method: GsMcpServer
objectSchema: propsDict required: requiredArray
  | d |
  d := Dictionary new.
  d at: 'type' put: 'object'.
  d at: 'properties' put: propsDict.
  d at: 'required' put: requiredArray.
  ^d
%
category: 'private'
method: GsMcpServer
parseBody: aString
  "Parse a JSON-RPC request body to its Dictionary, or nil if empty/malformed.
   Cross-version: GS 3.7.x's JsonParser raises on bad input, but 3.6.2's (PetitParser-based)
   returns a PPFailure instead of raising -- so reject any non-Dictionary result, not just
   exceptions. A valid JSON-RPC request is always an object, so nil here -> the dispatcher
   answers -32700 Parse error."
  (aString isNil or: [aString isEmpty]) ifTrue: [^nil].
  ^[ | parsed |
     parsed := JsonParser parse: aString.
     (parsed isKindOf: Dictionary) ifTrue: [parsed] ifFalse: [nil] ]
   on: Error do: [:ex | nil]
%
category: 'schema building'
method: GsMcpServer
propString: aDescription
  | d |
  d := Dictionary new.
  d at: 'type' put: 'string'.
  d at: 'description' put: aDescription.
  ^d
%
category: 'private'
method: GsMcpServer
recompileMethodsFrom: oldClass into: newClass named: classNameSymbol
  "Recompile every instance- and class-side method of oldClass onto newClass, preserving
   category and environmentId. Commit (apply-and-report) and return a report listing any
   methods that failed to recompile under the new shape (each with its CompileError details,
   the same descriptor a failed compile_method returns)."
  | sides failures total classNameString s |
  failures := OrderedCollection new.
  total := 0.
  sides := Array
    with: (Array with: 'instance' with: oldClass with: newClass)
    with: (Array with: 'class' with: oldClass class with: newClass class).
  sides do: [:triple | | side src tgt |
    side := triple at: 1. src := triple at: 2. tgt := triple at: 3.
    src selectors do: [:sel | | errs |
      total := total + 1.
      errs := [tgt
        compileMethod: (src sourceCodeAt: sel)
        dictionaries: System myUserProfile symbolList
        category: ((src categoryOfSelector: sel) ifNil: ['other']) asString
        environmentId: (src compiledMethodAt: sel) environmentId.
        nil] on: CompileError do: [:ex | ex errorDetails].
      errs ifNotNil: [failures add: (Array with: side with: sel with: errs)]]].
  System commitTransaction.
  classNameString := classNameSymbol asString.
  s := WriteStream on: String new.
  s nextPutAll: 'Redefined ' , classNameString , '; recompiled ' , (total - failures size) printString
    , '/' , total printString , ' methods'.
  failures isEmpty
    ifTrue: [s nextPutAll: '; all recompiled. Committed.']
    ifFalse: [s nextPutAll: '; ' , failures size printString , ' failed (committed anyway):'; nextPut: Character lf.
      failures do: [:f |
        s nextPutAll: '  ' , (f at: 1) , ' ' , classNameString , '>>' , (f at: 2) asString , ' - ' , (f at: 3) printString;
          nextPut: Character lf]].
  ^s contents
%
category: 'tool registration'
method: GsMcpServer
registerBrowsingTools
  "Handlers live in the 'tools - browsing' category."
  | classArg |
  classArg := self objectSchema:
    (Dictionary new at: 'className' put: (self propString: 'Name of the class'); yourself)
    required: (Array with: 'className').
  toolRegistry name: 'describe_class'
    description: 'Describe a class: superclass, instance variables, and selectors.'
    inputSchema: classArg do: [:args | self tool_describe_class: args].
  toolRegistry name: 'export_class_source'
    description: 'Export a class as a Topaz file-in (class definition plus all methods).'
    inputSchema: classArg do: [:args | self tool_export_class_source: args].
  toolRegistry name: 'get_class_definition'
    description: 'Return the class definition (superclass, instance/class variables, pools) as a source expression.'
    inputSchema: classArg do: [:args | self tool_get_class_definition: args].
  toolRegistry name: 'get_class_hierarchy'
    description: 'Show the superclass chain (top-down, indented) and the direct subclasses of a class.'
    inputSchema: classArg do: [:args | self tool_get_class_hierarchy: args].
  toolRegistry name: 'get_method_source'
    description: 'Return the source code of a method. Set meta=true for the class-side method.'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'className' put: (self propString: 'Name of the class');
        at: 'selector' put: (self propString: 'Method selector, e.g. printOn:');
        at: 'meta' put: (self boolProperty: 'true for the class-side method (default false)');
        yourself)
      required: (Array with: 'className' with: 'selector'))
    do: [:args | self tool_get_method_source: args].
  toolRegistry name: 'list_methods'
    description: 'List a class instance-side and class-side method selectors, grouped by category.'
    inputSchema: classArg do: [:args | self tool_list_methods: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerExecutionTools
  "Handlers live in the 'tools - execution' category."
  toolRegistry
    name: 'execute_code'
    description: 'Execute GemStone Smalltalk code and return the printString of the result. Accepts a single expression or a sequence of statements.'
    inputSchema: (self objectSchema:
        (Dictionary new at: 'code' put: (self propString: 'Smalltalk source to evaluate'); yourself)
        required: (Array with: 'code'))
    do: [:args | self tool_execute_code: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerListingTools
  "Handlers live in the 'tools - listing' category."
  | noArgs dictArg |
  noArgs := self objectSchema: Dictionary new required: #().
  dictArg := self objectSchema:
    (Dictionary new at: 'dictionaryName' put: (self propString: 'Name of the symbol dictionary'); yourself)
    required: (Array with: 'dictionaryName').
  toolRegistry name: 'list_all_classes'
    description: 'List every class across all dictionaries in the symbol list, tagged with its dictionary.'
    inputSchema: noArgs do: [:args | self tool_list_all_classes: args].
  toolRegistry name: 'list_classes'
    description: 'List the classes defined in a given symbol dictionary.'
    inputSchema: dictArg do: [:args | self tool_list_classes: args].
  toolRegistry name: 'list_dictionaries'
    description: 'List the symbol dictionaries in the current symbol list, in lookup order.'
    inputSchema: noArgs do: [:args | self tool_list_dictionaries: args].
  toolRegistry name: 'list_dictionary_entries'
    description: 'List every entry in a symbol dictionary, tagged as (class) or (global).'
    inputSchema: dictArg do: [:args | self tool_list_dictionary_entries: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerMutationTools
  "Handlers live in the 'tools - mutation' category."
  | classArg dictArg |
  classArg := self objectSchema:
    (Dictionary new at: 'className' put: (self propString: 'Name of the class'); yourself)
    required: (Array with: 'className').
  dictArg := self objectSchema:
    (Dictionary new at: 'dictionaryName' put: (self propString: 'Name of the symbol dictionary'); yourself)
    required: (Array with: 'dictionaryName').
  toolRegistry name: 'add_dictionary'
    description: 'Create a new symbol dictionary, append it to the user symbol list, and commit.'
    inputSchema: dictArg do: [:args | self tool_add_dictionary: args].
  toolRegistry name: 'compile_class_definition'
    description: 'Evaluate a class-definition expression (e.g. Object subclass: ... inDictionary: ...), then commit. The source must evaluate to a class; other expressions are rejected (use execute_code for those). On a shape-changing redefinition of an existing class, by default recompiles its existing methods onto the new version (a raw redefine drops them) and reports any that fail; refused if the class has subclasses.'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'source' put: (self propString: 'Full class-definition Smalltalk expression including the subclass: send and inDictionary:');
        at: 'recompileMethods' put: (self boolProperty: 'Default true: after a shape change, recompile the class existing methods onto the new version and report failures (refused if the class has subclasses). False: redefine raw, dropping all methods.');
        yourself)
      required: (Array with: 'source'))
    do: [:args | self tool_compile_class_definition: args].
  toolRegistry name: 'compile_method'
    description: 'Compile (add or update) a method on a class, then commit. Set meta=true for class-side. Category defaults to "mcp".'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'className' put: (self propString: 'Name of the class');
        at: 'source' put: (self propString: 'Full method source including the selector line');
        at: 'category' put: (self propString: 'Method category (optional, default mcp)');
        at: 'meta' put: (self boolProperty: 'true for the class-side method (default false)');
        yourself)
      required: (Array with: 'className' with: 'source'))
    do: [:args | self tool_compile_method: args].
  toolRegistry name: 'delete_class'
    description: 'Remove a class from its dictionary and commit. Destructive.'
    inputSchema: classArg do: [:args | self tool_delete_class: args].
  toolRegistry name: 'delete_method'
    description: 'Remove a method from a class and commit. Set meta=true for the class-side method. Destructive.'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'className' put: (self propString: 'Name of the class');
        at: 'selector' put: (self propString: 'Selector of the method to remove');
        at: 'meta' put: (self boolProperty: 'true for the class-side method (default false)');
        yourself)
      required: (Array with: 'className' with: 'selector'))
    do: [:args | self tool_delete_method: args].
  toolRegistry name: 'remove_dictionary'
    description: 'Remove a symbol dictionary from the user symbol list and commit. Destructive.'
    inputSchema: dictArg do: [:args | self tool_remove_dictionary: args].
  toolRegistry name: 'set_class_comment'
    description: 'Set (replace) the class comment and commit.'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'className' put: (self propString: 'Name of the class');
        at: 'comment' put: (self propString: 'New comment text');
        yourself)
      required: (Array with: 'className' with: 'comment'))
    do: [:args | self tool_set_class_comment: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerSearchTools
  "Handlers live in the 'tools - search' category."
  | selectorArg |
  selectorArg := self objectSchema:
    (Dictionary new at: 'selector' put: (self propString: 'Method selector to search for'); yourself)
    required: (Array with: 'selector').
  toolRegistry name: 'find_implementors'
    description: 'Find all methods that implement a given selector.'
    inputSchema: selectorArg do: [:args | self tool_find_implementors: args].
  toolRegistry name: 'find_references_to'
    description: 'Find all methods that reference a named global (e.g. a class or shared variable).'
    inputSchema: (self objectSchema:
      (Dictionary new at: 'name' put: (self propString: 'Name of the global / class to find references to'); yourself)
      required: (Array with: 'name'))
    do: [:args | self tool_find_references_to: args].
  toolRegistry name: 'find_senders'
    description: 'Find all methods that send a given selector. Capped at 200 results (senders of a common selector can number in the thousands).'
    inputSchema: selectorArg do: [:args | self tool_find_senders: args].
  toolRegistry name: 'search_method_source'
    description: 'Search method source code for a substring. Optionally scope to one dictionary (recommended; searching all dictionaries scans the kernel and can be slow). Capped at 200 hits.'
    inputSchema: (self objectSchema:
      (Dictionary new
        at: 'pattern' put: (self propString: 'Substring to search for in method source (case-sensitive)');
        at: 'dictionaryName' put: (self propString: 'Optional: limit the search to this dictionary');
        yourself)
      required: (Array with: 'pattern'))
    do: [:args | self tool_search_method_source: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerSessionTools
  "Handlers live in the 'tools - session' category."
  | noArgs |
  noArgs := self objectSchema: Dictionary new required: #().
  toolRegistry name: 'abort'
    description: 'Abort the current transaction, discarding uncommitted changes and refreshing the session view.'
    inputSchema: noArgs do: [:args | self tool_abort: args].
  toolRegistry name: 'commit'
    description: 'Commit the current transaction, persisting all changes.'
    inputSchema: noArgs do: [:args | self tool_commit: args].
  toolRegistry name: 'refresh'
    description: 'Refresh the session view to see changes committed by other sessions (aborts any uncommitted work).'
    inputSchema: noArgs do: [:args | self tool_refresh: args].
  toolRegistry name: 'status'
    description: 'Report the GemStone session: user, session id, stone, and whether there are uncommitted changes.'
    inputSchema: noArgs do: [:args | self tool_status: args].
  ^self
%
category: 'tool registration'
method: GsMcpServer
registerTestTools
  "Handlers live in the 'tools - testing' category."
  | noArgs classArg methodArg |
  noArgs := self objectSchema: Dictionary new required: #().
  classArg := self objectSchema:
    (Dictionary new at: 'className' put: (self propString: 'Name of the TestCase subclass'); yourself)
    required: (Array with: 'className').
  methodArg := self objectSchema:
    (Dictionary new
      at: 'className' put: (self propString: 'Name of the TestCase subclass');
      at: 'selector' put: (self propString: 'Test method selector, e.g. testFoo');
      yourself)
    required: (Array with: 'className' with: 'selector').
  toolRegistry name: 'describe_test_failure'
    description: 'Re-run a single test method and return the failure or error detail.'
    inputSchema: methodArg do: [:args | self tool_describe_test_failure: args].
  toolRegistry name: 'list_failing_tests'
    description: 'Run test classes (a given list, or all TestCase subclasses) and list only the failing/erroring test methods.'
    inputSchema: (self objectSchema:
      (Dictionary new at: 'classNames' put:
        (Dictionary new at: 'type' put: 'array';
          at: 'items' put: (Dictionary new at: 'type' put: 'string'; yourself);
          at: 'description' put: 'Optional: TestCase subclass names to run (default: all)'; yourself);
        yourself)
      required: #())
    do: [:args | self tool_list_failing_tests: args].
  toolRegistry name: 'list_test_classes'
    description: 'List all TestCase subclasses in the symbol list.'
    inputSchema: noArgs do: [:args | self tool_list_test_classes: args].
  toolRegistry name: 'run_test_class'
    description: 'Run all test methods in a TestCase subclass and report the result.'
    inputSchema: classArg do: [:args | self tool_run_test_class: args].
  toolRegistry name: 'run_test_method'
    description: 'Run a single test method and report the result.'
    inputSchema: methodArg do: [:args | self tool_run_test_method: args].
  ^self
%
category: 'accessing'
method: GsMcpServer
toolRegistry
  ^toolRegistry
%
category: 'private'
method: GsMcpServer
resolveClass: aName
  "Resolve a class by name in the current symbol list, or nil if not a class."
  | obj |
  obj := System myUserProfile objectNamed: aName asSymbol.
  ^(obj isKindOf: Behavior) ifTrue: [obj] ifFalse: [nil]
%
category: 'running'
method: GsMcpServer
runOnPort: aPort
  "Bind a localhost-only listener and run the accept loop until #stop.
   BLOCKING: this is meant to be the gem's main activity (forked GsProcesses
   only run while the gem is actively executing Smalltalk)."
  serverSocket := GsSocket new.
  (serverSocket makeServer: 16 atPort: aPort atAddress: '127.0.0.1')
    ifNil: [^self error: 'makeServer failed on port ' , aPort printString , ': ' , serverSocket lastErrorString].
  isRunning := true.
  self log: 'GsMcpServer listening on 127.0.0.1:' , aPort printString.
  [isRunning] whileTrue: [
    | client |
    client := serverSocket acceptTimeoutMs: 500.
    client ifNotNil: [self serve: client]].
  serverSocket close.
  self log: 'GsMcpServer stopped.'.
  ^self
%
category: 'running'
method: GsMcpServer
serve: aClientSocket
  "Handle each connection in its own GsProcess so a slow or stalled client cannot
   block the accept loop. The forked process runs during the loop's accept waits."
  [self handleConnection: (GsMcpHttpConnection on: aClientSocket)] fork
%
category: 'running'
method: GsMcpServer
serveGetStream: conn
  "Open the standalone MCP SSE stream (server -> client). This server currently emits no
   server-initiated messages, so the stream stays open with periodic keepalive comments
   until the client disconnects (write fails) or the server stops."
  (conn writeSseStreamHeaders) ifNil: [^self].
  (conn writeSseComment: 'connected') ifNil: [^self].
  [isRunning] whileTrue: [
    (Delay forSeconds: 15) wait.
    (conn writeSseComment: 'keepalive') ifNil: [^self]]
%
category: 'running'
method: GsMcpServer
servePost: req on: conn
  "Handle a JSON-RPC POST. Dispatch is serialized via the mutex so the shared session
   transaction stays consistent across concurrent connections."
  | parsed response |
  parsed := self parseBody: (req at: 'body' ifAbsent: ['']).
  response := mutex critical: [dispatcher handle: parsed].
  response isNil
    ifTrue: [conn writeStatus: 202 reason: 'Accepted' body: '']
    ifFalse: [conn writeJson: response asJson]
%
category: 'controlling'
method: GsMcpServer
stop
  "Request a graceful shutdown; the accept loop exits within one accept timeout."
  isRunning := false
%
category: 'tools - session'
method: GsMcpServer
tool_abort: args
  System abortTransaction.
  ^'Transaction aborted; view refreshed.'
%
category: 'tools - mutation'
method: GsMcpServer
tool_add_dictionary: args
  | name up d |
  name := args at: 'dictionaryName'.
  ^(self dictNamed: name) notNil
    ifTrue: ['Dictionary already exists: ' , name]
    ifFalse: [up := System myUserProfile.
      d := up createDictionary: name asSymbol.
      up insertDictionary: d at: up symbolList size + 1.
      System commitTransaction.
      'Created dictionary: ' , name]
%
category: 'tools - session'
method: GsMcpServer
tool_commit: args
  ^System commitTransaction
    ifTrue: ['Transaction committed.']
    ifFalse: ['Commit failed due to conflicts; the transaction is still open.']
%
category: 'tools - mutation'
method: GsMcpServer
tool_compile_class_definition: args
  "Evaluate a class-definition expression and commit. If recompileMethods is true (default)
   and this is a shape-changing redefinition of an existing class (which would otherwise drop
   all its methods), recompile the prior version's methods onto the new version and report any
   that fail. Refused when the class has subclasses (handle the hierarchy manually, or pass
   recompileMethods=false to redefine raw)."
  | source recompile name oldClass newClass |
  source := args at: 'source'.
  recompile := (args at: 'recompileMethods' ifAbsent: [true]) ~~ false.
  name := self classNameFromDefinition: source.
  oldClass := (recompile and: [name notNil]) ifTrue: [self resolveClass: name] ifFalse: [nil].
  (recompile and: [oldClass notNil and: [oldClass subclasses isEmpty not]]) ifTrue: [
    ^'Refused: ' , name asString , ' has subclasses '
      , (oldClass subclasses collect: [:c | c name asString]) asArray printString
      , '. Recompiling methods across a subclass hierarchy is unsupported; pass recompileMethods=false to redefine without preserving methods, or update the hierarchy manually.'].
  newClass := source evaluate.
  (newClass isKindOf: Behavior) ifFalse: [
    System abortTransaction.
    ^'Source did not evaluate to a class (got ' , newClass class name asString
      , '). Use execute_code to evaluate arbitrary expressions.'].
  (recompile not or: [oldClass isNil or: [oldClass == newClass]]) ifTrue: [
    System commitTransaction.
    ^'Compiled and committed class: ' , newClass name asString].
  ^self recompileMethodsFrom: oldClass into: newClass named: name
%
category: 'tools - mutation'
method: GsMcpServer
tool_compile_method: args
  | cls target errs |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [
      target := ((args at: 'meta' ifAbsent: [false]) == true) ifTrue: [cls class] ifFalse: [cls].
      errs := target
        compileMethod: (args at: 'source')
        dictionaries: System myUserProfile symbolList
        category: (args at: 'category' ifAbsent: ['mcp']).
      errs isNil
        ifTrue: [System commitTransaction. 'Compiled ' , (args at: 'className') , ' and committed.']
        ifFalse: [System abortTransaction. 'Compile errors: ' , errs printString]]
%
category: 'tools - mutation'
method: GsMcpServer
tool_delete_class: args
  | cls arr dict |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [
      arr := System myUserProfile dictionaryAndSymbolOf: cls.
      arr isNil
        ifTrue: ['Class is not resident in a dictionary: ' , (args at: 'className')]
        ifFalse: [dict := arr at: 1.
          dict removeKey: (arr at: 2).
          System commitTransaction.
          'Deleted class ' , (args at: 'className') , ' from ' , dict name asString , ' and committed.']]
%
category: 'tools - mutation'
method: GsMcpServer
tool_delete_method: args
  | cls target sel |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [
      target := ((args at: 'meta' ifAbsent: [false]) == true) ifTrue: [cls class] ifFalse: [cls].
      sel := (args at: 'selector') asSymbol.
      (target selectors includes: sel)
        ifFalse: ['Method not found: ' , (args at: 'className') , '>>' , (args at: 'selector')]
        ifTrue: [target removeSelector: sel.
          System commitTransaction.
          'Deleted method ' , (args at: 'className') , '>>' , (args at: 'selector') , ' and committed.']]
%
category: 'tools - browsing'
method: GsMcpServer
tool_describe_class: args
  | cls nl |
  cls := self resolveClass: (args at: 'className').
  nl := String with: Character lf.
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [
      'name=' , cls name , nl ,
      'superclass=' , (cls superclass isNil ifTrue: ['nil'] ifFalse: [cls superclass name]) , nl ,
      'instVarNames=' , cls instVarNames printString , nl ,
      'selectors=' , (cls selectors asSortedCollection asArray) printString]
%
category: 'tools - testing'
method: GsMcpServer
tool_describe_test_failure: args
  "Re-run one test in isolation (runCase lets the exception propagate instead of being swallowed
   by TestCase>>run) and report the failure detail. Uses ex description -- which for a
   MessageNotUnderstood spells out the error number, the receiver's class, and the missing
   selector -- rather than ex messageText, which is nil for a DNU."
  | cls sel label |
  cls := self resolveClass: (args at: 'className').
  cls isNil ifTrue: [^'Class not found: ' , (args at: 'className')].
  sel := (args at: 'selector') asSymbol.
  label := (args at: 'className') , '>>' , (args at: 'selector').
  ^[(cls selector: sel) runCase. label , ' passed (no failure).']
    on: Error, TestFailure
    do: [:ex | | detail |
      detail := [ex description] on: Error do: [:e | ex messageText ifNil: ['(no detail available)']].
      label , ' - ' , ex class name asString , ': ' , detail asString]
%
category: 'tools - execution'
method: GsMcpServer
tool_execute_code: args
  "Code is wrapped by GsMcpDispatcher>>handleToolsCall:id: to catch errors"
  ^self capResult: (args at: 'code') evaluate printString
%
category: 'tools - browsing'
method: GsMcpServer
tool_export_class_source: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil ifTrue: ['Class not found: ' , (args at: 'className')] ifFalse: [cls fileOutClass]
%
category: 'tools - search'
method: GsMcpServer
tool_find_implementors: args
  ^self formatMethodList: (ClassOrganizer new implementorsOf: (args at: 'selector') asSymbol)
%
category: 'tools - search'
method: GsMcpServer
tool_find_references_to: args
  | obj |
  obj := System myUserProfile objectNamed: (args at: 'name') asSymbol.
  ^obj isNil
    ifTrue: ['Global not found: ' , (args at: 'name')]
    ifFalse: [self formatMethodList: (ClassOrganizer new referencesToObject: obj)]
%
category: 'tools - search'
method: GsMcpServer
tool_find_senders: args
  "Senders of a common selector can number in the thousands, so cap the output. Unlike
   search_method_source (which stops scanning at the cap and can't know the total), sendersOf:
   returns the full set first, so we can report the true total in the truncation note."
  | cap flat total |
  cap := 200.
  flat := self flattenMethods: (ClassOrganizer new sendersOf: (args at: 'selector') asSymbol).
  total := flat size.
  total > cap ifTrue: [flat := flat copyFrom: 1 to: cap].
  ^(total > cap
      ifTrue: ['(showing first ' , cap printString , ' of ' , total printString , ')' , (String with: Character lf)]
      ifFalse: [''])
    , (self formatMethodList: flat)
%
category: 'tools - browsing'
method: GsMcpServer
tool_get_class_definition: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil ifTrue: ['Class not found: ' , (args at: 'className')] ifFalse: [cls definition]
%
category: 'tools - browsing'
method: GsMcpServer
tool_get_class_hierarchy: args
  | cls s chain c subs |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil ifTrue: ['Class not found: ' , (args at: 'className')] ifFalse: [
    s := WriteStream on: String new.
    chain := OrderedCollection new. c := cls.
    [c notNil] whileTrue: [chain addFirst: c. c := c superclass].
    1 to: chain size do: [:i |
      ((i - 1) * 2) timesRepeat: [s nextPut: Character space].
      s nextPutAll: (chain at: i) name asString; nextPut: Character lf].
    s nextPutAll: 'Direct subclasses:'; nextPut: Character lf.
    subs := (cls subclasses collect: [:x | x name asString]).
    subs isEmpty
      ifTrue: [s nextPutAll: '  (none)']
      ifFalse: [subs asSortedCollection do: [:n | s nextPutAll: '  '; nextPutAll: n; nextPut: Character lf]].
    s contents]
%
category: 'tools - browsing'
method: GsMcpServer
tool_get_method_source: args
  | cls target src |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [
      target := ((args at: 'meta' ifAbsent: [false]) == true) ifTrue: [cls class] ifFalse: [cls].
      src := [target sourceCodeAt: (args at: 'selector') asSymbol] on: Error do: [:ex | nil].
      src isNil
        ifTrue: ['No such method: ' , (args at: 'className') , '>>' , (args at: 'selector')]
        ifFalse: [src]]
%
category: 'tools - listing'
method: GsMcpServer
tool_list_all_classes: args
  | names |
  names := OrderedCollection new.
  System myUserProfile symbolList do: [:d |
    d values do: [:v | (v isKindOf: Behavior) ifTrue: [names add: v name asString , '  (' , d name asString , ')']]].
  ^self linesFrom: names
%
category: 'tools - listing'
method: GsMcpServer
tool_list_classes: args
  | dict |
  dict := self dictNamed: (args at: 'dictionaryName').
  ^dict isNil
    ifTrue: ['Dictionary not found: ' , (args at: 'dictionaryName')]
    ifFalse: [self linesFrom: ((dict values select: [:v | v isKindOf: Behavior]) collect: [:c | c name asString])]
%
category: 'tools - listing'
method: GsMcpServer
tool_list_dictionaries: args
  | s |
  s := WriteStream on: String new.
  System myUserProfile symbolList do: [:d | s nextPutAll: d name asString; nextPut: Character lf].
  ^s contents
%
category: 'tools - listing'
method: GsMcpServer
tool_list_dictionary_entries: args
  | dict lines |
  dict := self dictNamed: (args at: 'dictionaryName').
  ^dict isNil
    ifTrue: ['Dictionary not found: ' , (args at: 'dictionaryName')]
    ifFalse: [lines := OrderedCollection new.
      dict keysAndValuesDo: [:k :v |
        lines add: k asString , ((v isKindOf: Behavior) ifTrue: ['  (class)'] ifFalse: ['  (global)'])].
      self linesFrom: lines]
%
category: 'tools - testing'
method: GsMcpServer
tool_list_failing_tests: args
  | names classes out |
  classes := OrderedCollection new.
  names := args at: 'classNames' ifAbsent: [nil].
  names isNil
    ifTrue: [classes addAll: (ClassOrganizer new allSubclassesOf: (System myUserProfile objectNamed: #TestCase))]
    ifFalse: [names do: [:n | | c | c := self resolveClass: n. c ifNotNil: [classes add: c]]].
  out := WriteStream on: String new.
  classes do: [:cls | | res |
    res := cls suite run.
    res failures do: [:t | out nextPutAll: 'FAIL  '; nextPutAll: t asString; nextPut: Character lf].
    res errors do: [:t | out nextPutAll: 'ERROR '; nextPutAll: t asString; nextPut: Character lf]].
  ^out contents isEmpty ifTrue: ['(no failing tests)'] ifFalse: [out contents]
%
category: 'tools - browsing'
method: GsMcpServer
tool_list_methods: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil ifTrue: ['Class not found: ' , (args at: 'className')] ifFalse: [
    (self methodsReportFor: cls label: 'Instance') , (String with: Character lf)
      , (self methodsReportFor: cls class label: 'Class')]
%
category: 'tools - testing'
method: GsMcpServer
tool_list_test_classes: args
  | tc |
  tc := System myUserProfile objectNamed: #TestCase.
  ^tc isNil
    ifTrue: ['TestCase is not available in this image.']
    ifFalse: [self linesFrom: ((ClassOrganizer new allSubclassesOf: tc) collect: [:c | c name asString])]
%
category: 'tools - session'
method: GsMcpServer
tool_refresh: args
  System abortTransaction.
  ^'View refreshed.'
%
category: 'tools - mutation'
method: GsMcpServer
tool_remove_dictionary: args
  | name dict up |
  name := args at: 'dictionaryName'.
  dict := self dictNamed: name.
  ^dict isNil
    ifTrue: ['Dictionary not found: ' , name]
    ifFalse: [up := System myUserProfile.
      up removeDictionaryAt: (up symbolList indexOf: dict).
      up symbolList do: [:d | (d at: name asSymbol ifAbsent: [nil]) == dict ifTrue: [d removeKey: name asSymbol ifAbsent: [nil]]].
      System commitTransaction.
      'Removed dictionary: ' , name]
%
category: 'tools - testing'
method: GsMcpServer
tool_run_test_class: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [self formatTestResult: cls suite run label: cls name asString]
%
category: 'tools - testing'
method: GsMcpServer
tool_run_test_method: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil
    ifTrue: ['Class not found: ' , (args at: 'className')]
    ifFalse: [self formatTestResult: (cls selector: (args at: 'selector') asSymbol) run
      label: (args at: 'className') , '>>' , (args at: 'selector')]
%
category: 'tools - search'
method: GsMcpServer
tool_search_method_source: args
  | pattern cap hits dicts |
  pattern := args at: 'pattern'.
  cap := 200.
  hits := OrderedCollection new.
  dicts := (args at: 'dictionaryName' ifAbsent: [nil])
    ifNil: [System myUserProfile symbolList asArray]
    ifNotNil: [:dname | | d | d := self dictNamed: dname. d isNil ifTrue: [#()] ifFalse: [Array with: d]].
  dicts do: [:dict | dict values do: [:v | (v isKindOf: Behavior) ifTrue: [
    (Array with: v with: v class) do: [:beh | beh selectors do: [:sel |
      hits size < cap ifTrue: [ | src |
        src := [beh sourceCodeAt: sel] on: Error do: [:e | nil].
        (src notNil and: [src includesString: pattern]) ifTrue: [
          hits add: beh name asString , '>>' , sel asString]]]]]]].
  ^(hits size >= cap ifTrue: ['(truncated at ' , cap printString , ' hits)' , (String with: Character lf)] ifFalse: [''])
    , (self linesFrom: hits)
%
category: 'tools - mutation'
method: GsMcpServer
tool_set_class_comment: args
  | cls |
  cls := self resolveClass: (args at: 'className').
  ^cls isNil ifTrue: ['Class not found: ' , (args at: 'className')] ifFalse: [
    cls comment: (args at: 'comment').
    System commitTransaction.
    'Comment set on ' , cls name asString , ' and committed.']
%
category: 'tools - session'
method: GsMcpServer
tool_status: args
  ^'user=' , System myUserProfile userId ,
   ' session=' , System session printString ,
   ' stone=' , System stoneName ,
   ' uncommittedChanges=' , System needsCommit printString
%

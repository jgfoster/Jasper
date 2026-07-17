set compile_env: 0
! ------------------- Class definition for GsMcpToolTest
expectvalue /Class
doit
GsTestCase subclass: 'GsMcpToolTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()

%
! ------------------- Remove existing behavior from GsMcpToolTest
removeallmethods GsMcpToolTest
removeallclassmethods GsMcpToolTest
! ------------------- Class methods for GsMcpToolTest
! ------------------- Instance methods for GsMcpToolTest
category: 'helpers'
method: GsMcpToolTest
createFixtureClass
  "Create the throwaway fixture class in UserGlobals (committed), with one instance-side and one
   class-side method so the browsing/search tools have something to report. tearDown removes it."
  | c |
  c := Object subclass: 'GsMcpTestFixture'
    instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
    inDictionary: UserGlobals options: #().
  c comment: 'Throwaway fixture created by GsMcpToolTest. Safe to remove.'.
  c compileMethod: 'probeAnswer ^''probeAnswerBody''' dictionaries: System myUserProfile symbolList category: 'probing'.
  c class compileMethod: 'probeClassSide ^''probeClassBody''' dictionaries: System myUserProfile symbolList category: 'probing'.
  System commitTransaction.
  ^c
%
category: 'helpers'
method: GsMcpToolTest
createTestSuiteFixture
  "Create a throwaway GsTestCase subclass with a passing test, a failing test, and two erroring
   tests: testErrors (a ZeroDivide) and testDnu (a doesNotUnderstand, whose missing selector the
   describe tool should surface). Committed; tearDown removes it."
  | c |
  c := GsTestCase subclass: 'GsMcpTestSuiteFixture'
    instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
    inDictionary: UserGlobals options: #().
  c compileMethod: 'testPasses self assert: true' dictionaries: System myUserProfile symbolList category: 'tests'.
  c compileMethod: 'testFails self assert: false' dictionaries: System myUserProfile symbolList category: 'tests'.
  c compileMethod: 'testErrors 1/0' dictionaries: System myUserProfile symbolList category: 'tests'.
  c compileMethod: 'testDnu ^self zzzNoSuchSelector' dictionaries: System myUserProfile symbolList category: 'tests'.
  System commitTransaction.
  ^c
%
category: 'helpers'
method: GsMcpToolTest
mcp
  "A fresh server whose tool_* handlers we exercise directly (no socket)."
  ^GsMcpServer new
%
category: 'helpers'
method: GsMcpToolTest
oneArg: key value: value
  | d |
  d := Dictionary new.
  d at: key put: value.
  ^d
%
category: 'helpers'
method: GsMcpToolTest
includesCS: aSubstring in: aString
  "Case-sensitive substring test. GemStone's String>>includesString: is case-INsensitive
   (e.g. 'FAIL' matches the 'fail' in 'failed'), so use findString:startingAt: (which is
   case-sensitive) for assert:/deny: substring checks."
  ^(aString findString: aSubstring startingAt: 1) > 0
%
category: 'running'
method: GsMcpToolTest
tearDown
  "Force-remove any throwaway fixtures a test created, then commit, so nothing leaks."
  | up dict |
  up := System myUserProfile.
  #(GsMcpTestSub GsMcpTestFixture GsMcpTestSuiteFixture) do: [:sym |
    (up objectNamed: sym) ifNotNil: [:cls |
      (up dictionaryAndSymbolOf: cls) ifNotNil: [:arr | (arr at: 1) removeKey: (arr at: 2) ifAbsent: [nil]]]].
  dict := up symbolList detect: [:d | d name asString = 'GsMcpTestDict'] ifNone: [nil].
  dict ifNotNil: [up removeDictionaryAt: (up symbolList indexOf: dict)].
  UserGlobals removeKey: #GsMcpTestDict ifAbsent: [nil].
  UserGlobals removeKey: #GsMcpTestSub ifAbsent: [nil].
  UserGlobals removeKey: #GsMcpTestFixture ifAbsent: [nil].
  UserGlobals removeKey: #GsMcpTestSuiteFixture ifAbsent: [nil].
  System commitTransaction
%
category: 'tools - session'
method: GsMcpToolTest
testAbort
  "tool_abort must discard uncommitted work. Commit a fixture as a baseline, change its comment
   without committing, abort, then confirm both the 'aborted' report and that the change reverted.
   (tearDown removes GsMcpTestFixture.)"
  | cls out baseline |
  cls := self createFixtureClass.
  baseline := cls comment.
  cls comment: 'uncommitted - should be discarded by abort'.
  self assert: (cls comment = 'uncommitted - should be discarded by abort').
  out := self mcp tool_abort: Dictionary new.
  self assert: (self includesCS: 'aborted' in: out).
  self assert: (cls comment = baseline)
%
category: 'tools - mutation'
method: GsMcpToolTest
testAddDictionary
  | out |
  out := self mcp tool_add_dictionary: (self oneArg: 'dictionaryName' value: 'GsMcpTestDict').
  self assert: (self includesCS: 'Created dictionary' in: out).
  self assert: (self includesCS: 'GsMcpTestDict' in: (self mcp tool_list_dictionaries: Dictionary new))
%
category: 'tools - session'
method: GsMcpToolTest
testCommit
  "tool_commit must persist changes. Change the fixture's comment, commit via the tool, then
   abort with the primitive (not tool_abort, so this test doesn't depend on that tool); the
   change must survive the abort, proving it was committed. (tearDown removes GsMcpTestFixture.)"
  | cls out changed |
  cls := self createFixtureClass.
  changed := 'committed change - should survive abort'.
  cls comment: changed.
  out := self mcp tool_commit: Dictionary new.
  self assert: (self includesCS: 'committed' in: out).
  System abortTransaction.
  self assert: (cls comment = changed)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinition
  | out |
  out := self mcp tool_compile_class_definition: (self oneArg: 'source' value:
    'Object subclass: ''GsMcpTestFixture'' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()').
  self assert: (self includesCS: 'committed class: GsMcpTestFixture' in: out).
  self assert: (System myUserProfile objectNamed: #GsMcpTestFixture) notNil
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinitionRejectsNonClass
  "A source that evaluates to something other than a class is rejected and directed to
   execute_code, and nothing is committed."
  | out |
  out := self mcp tool_compile_class_definition: (self oneArg: 'source' value: '3 + 4').
  self assert: (self includesCS: 'did not evaluate to a class' in: out).
  self assert: (self includesCS: 'execute_code' in: out).
  self deny: (self includesCS: 'committed' in: out)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinitionPreservesMethods
  "Default recompileMethods=true: a shape change keeps the class's methods."
  | cls out |
  cls := Object subclass: 'GsMcpTestFixture' instVarNames: #(a) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
  cls compileMethod: 'getA ^a' dictionaries: System myUserProfile symbolList category: 'acc'.
  System commitTransaction.
  out := self mcp tool_compile_class_definition: (self oneArg: 'source' value:
    'Object subclass: ''GsMcpTestFixture'' instVarNames: #(a b) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()').
  self assert: (self includesCS: 'recompiled 1/1' in: out).
  self assert: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #getA).
  self assert: ((System myUserProfile objectNamed: #GsMcpTestFixture) instVarNames includes: #b)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinitionRawWhenFlagFalse
  "recompileMethods=false reproduces the raw redefine: methods are dropped."
  | cls out |
  cls := Object subclass: 'GsMcpTestFixture' instVarNames: #(a) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
  cls compileMethod: 'getA ^a' dictionaries: System myUserProfile symbolList category: 'acc'.
  System commitTransaction.
  out := self mcp tool_compile_class_definition: (Dictionary new
    at: 'source' put: 'Object subclass: ''GsMcpTestFixture'' instVarNames: #(a b) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()';
    at: 'recompileMethods' put: false; yourself).
  self deny: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #getA)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinitionRefusesWithSubclasses
  "With recompile on (default), a class that has subclasses is refused rather than redefined."
  | cls out |
  cls := Object subclass: 'GsMcpTestFixture' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
  cls subclass: 'GsMcpTestSub' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
  System commitTransaction.
  out := self mcp tool_compile_class_definition: (self oneArg: 'source' value:
    'Object subclass: ''GsMcpTestFixture'' instVarNames: #(a) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()').
  self assert: (self includesCS: 'Refused' in: out).
  self assert: (self includesCS: 'GsMcpTestSub' in: out)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileClassDefinitionReportsRecompileFailure
  "A method that no longer compiles under the new shape is reported, but the redefinition
   (and the methods that did recompile) still applies."
  | cls out |
  cls := Object subclass: 'GsMcpTestFixture' instVarNames: #(a) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
  cls compileMethod: 'getA ^a' dictionaries: System myUserProfile symbolList category: 'acc'.
  cls compileMethod: 'withLocal | tmp | tmp := 5. ^tmp' dictionaries: System myUserProfile symbolList category: 'acc'.
  System commitTransaction.
  "adding ivar 'tmp' collides with withLocal's temporary -> that one fails to recompile"
  out := self mcp tool_compile_class_definition: (self oneArg: 'source' value:
    'Object subclass: ''GsMcpTestFixture'' instVarNames: #(a tmp) classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()').
  self assert: (self includesCS: 'recompiled 1/2' in: out).
  self assert: (self includesCS: 'failed' in: out).
  self assert: (self includesCS: 'withLocal' in: out).
  self deny: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #withLocal).
  self assert: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #getA)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileMethod
  | out |
  self createFixtureClass.
  out := self mcp tool_compile_method:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'source' put: 'answer ^42'; at: 'category' put: 'tmp'; yourself).
  self assert: (self includesCS: 'and committed' in: out).
  self assert: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #answer)
%
category: 'tools - mutation'
method: GsMcpToolTest
testCompileMethodMeta
  "meta=true compiles onto the class side, not the instance side."
  | out cls |
  cls := self createFixtureClass.
  out := self mcp tool_compile_method:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'source' put: 'classAnswer ^42'; at: 'category' put: 'tmp'; at: 'meta' put: true; yourself).
  self assert: (self includesCS: 'and committed' in: out).
  self assert: (cls class canUnderstand: #classAnswer).
  self deny: (cls canUnderstand: #classAnswer)
%
category: 'tools - mutation'
method: GsMcpToolTest
testDeleteClass
  | out |
  self createFixtureClass.
  out := self mcp tool_delete_class: (self oneArg: 'className' value: 'GsMcpTestFixture').
  self assert: (self includesCS: 'Deleted class' in: out).
  self assert: (System myUserProfile objectNamed: #GsMcpTestFixture) isNil
%
category: 'tools - mutation'
method: GsMcpToolTest
testDeleteMethod
  | out |
  self createFixtureClass.
  (System myUserProfile objectNamed: #GsMcpTestFixture)
    compileMethod: 'answer ^42' dictionaries: System myUserProfile symbolList category: 'tmp'.
  System commitTransaction.
  out := self mcp tool_delete_method:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'selector' put: 'answer'; yourself).
  self assert: (self includesCS: 'Deleted method' in: out).
  self deny: ((System myUserProfile objectNamed: #GsMcpTestFixture) canUnderstand: #answer)
%
category: 'tools - mutation'
method: GsMcpToolTest
testDeleteMethodMeta
  "meta=true deletes a class-side method."
  | out cls |
  cls := self createFixtureClass.
  cls class compileMethod: 'classAnswer ^42' dictionaries: System myUserProfile symbolList category: 'tmp'.
  System commitTransaction.
  out := self mcp tool_delete_method:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'selector' put: 'classAnswer'; at: 'meta' put: true; yourself).
  self assert: (self includesCS: 'Deleted method' in: out).
  self deny: (cls class canUnderstand: #classAnswer)
%
category: 'tools - browsing'
method: GsMcpToolTest
testDescribeClass
  | out |
  self createFixtureClass.
  out := self mcp tool_describe_class: (self oneArg: 'className' value: 'GsMcpTestFixture').
  self assert: (self includesCS: 'name=GsMcpTestFixture' in: out).
  self assert: (self includesCS: 'superclass=Object' in: out)
%
category: 'tools - testing'
method: GsMcpToolTest
testDescribeTestFailureOnPassingTest
  | out |
  out := self mcp tool_describe_test_failure:
    (Dictionary new at: 'className' put: 'SUnitTest'; at: 'selector' put: 'testAssert'; yourself).
  self assert: out = 'SUnitTest>>testAssert passed (no failure).'
%
category: 'tools - testing'
method: GsMcpToolTest
testDescribeTestFailureOnFailingTest
  "A failing test reports the failure detail, not 'passed'."
  | out |
  self createTestSuiteFixture.
  out := self mcp tool_describe_test_failure:
    (Dictionary new at: 'className' put: 'GsMcpTestSuiteFixture'; at: 'selector' put: 'testFails'; yourself).
  self assert: (self includesCS: 'testFails' in: out).
  self assert: (self includesCS: 'TestFailure' in: out).
  self deny: (self includesCS: 'passed' in: out)
%
category: 'tools - testing'
method: GsMcpToolTest
testDescribeTestFailureOnError
  "An erroring test reports the error class and message."
  | out |
  self createTestSuiteFixture.
  out := self mcp tool_describe_test_failure:
    (Dictionary new at: 'className' put: 'GsMcpTestSuiteFixture'; at: 'selector' put: 'testErrors'; yourself).
  self assert: (self includesCS: 'testErrors' in: out).
  self assert: (self includesCS: 'ZeroDivide' in: out)
%
category: 'tools - testing'
method: GsMcpToolTest
testDescribeTestFailureNamesMissingSelector
  "For a doesNotUnderstand, describe_test_failure surfaces the missing selector -- which lives in
   the exception's description, not its class name and not its (nil) messageText. This exercises
   the description path the old handler lacked, without depending on our SUnit version: a DNU's
   description always names the selector, whether or not messageText is populated."
  | out |
  self createTestSuiteFixture.
  out := self mcp tool_describe_test_failure:
    (Dictionary new at: 'className' put: 'GsMcpTestSuiteFixture'; at: 'selector' put: 'testDnu'; yourself).
  self assert: (self includesCS: 'zzzNoSuchSelector' in: out)
%
category: 'tools - execution'
method: GsMcpToolTest
testExecuteCode
  self assert: (self mcp tool_execute_code: (self oneArg: 'code' value: '3 + 4')) equals: '7'
%
category: 'tools - execution'
method: GsMcpToolTest
testExecuteCodeMultiStatement
  self assert: (self mcp tool_execute_code: (self oneArg: 'code' value: '| x | x := 6. x * 7')) equals: '42'
%
category: 'tools - execution'
method: GsMcpToolTest
testExecuteCodeTruncates
  "Oversized results are capped by GsMcpServer>>capResult: at 50000 chars plus a marker.
   capResult: is shared by execute_code and the python tools, so this guards all three."
  | out |
  out := self mcp tool_execute_code: (self oneArg: 'code' value: '(String new: 60000)').
  self assert: (self includesCS: '...[truncated]' in: out).
  self assert: out size equals: 50000 + ' ...[truncated]' size
%
category: 'tools - browsing'
method: GsMcpToolTest
testExportClassSource
  | src |
  self createFixtureClass.
  src := self mcp tool_export_class_source: (self oneArg: 'className' value: 'GsMcpTestFixture').
  self assert: (self includesCS: 'Object subclass: ''GsMcpTestFixture''' in: src).
  "export_class_source is a full file-in (definition + methods): assert the method source is
   present. (Marker is 'probeAnswer', not 'removeallmethods' -- GS 3.6.2's fileOutClass omits
   the removeallmethods line that 3.7.x emits, but both include the method bodies.)"
  self assert: (self includesCS: 'probeAnswer' in: src)
%
category: 'tools - search'
method: GsMcpToolTest
testFindImplementors
  "add: has many implementors; confirm more than one distinct result comes back."
  | impls |
  impls := (self mcp tool_find_implementors: (self oneArg: 'selector' value: 'add:'))
    subStrings: (String with: Character lf).
  self assert: (impls includes: 'Array>>add:  [Adding]').
  self assert: (impls includes: 'Set>>add:  [Adding]')
%
category: 'tools - search'
method: GsMcpToolTest
testFindImplementorsNone
  "No implementors: formatMethodList: returns '(none)'. 'foo-bar:' is not a legal Smalltalk
   selector, so nothing will ever implement it."
  self assert: (self mcp tool_find_implementors: (self oneArg: 'selector' value: 'foo-bar:')) = '(none)'
%
category: 'tools - search'
method: GsMcpToolTest
testFindReferencesTo
  "Boolean is referenced by many kernel methods (the tool does not truncate); confirm more
   than one result via two of Boolean's own, very stable logical-operation methods."
  | refs |
  refs := (self mcp tool_find_references_to: (self oneArg: 'name' value: 'Boolean'))
    subStrings: (String with: Character lf).
  self assert: (refs includes: 'Boolean>>&  [Logical Operations]').
  self assert: (refs includes: 'Boolean>>|  [Logical Operations]')
%
category: 'tools - search'
method: GsMcpToolTest
testFindReferencesToNone
  "An undefined global: the handler reports 'Global not found:' and never reaches
   formatMethodList:. 'Foo-Bar' is not a legal identifier, so it will never be defined."
  self assert: (self mcp tool_find_references_to: (self oneArg: 'name' value: 'Foo-Bar')) = 'Global not found: Foo-Bar'
%
category: 'tools - search'
method: GsMcpToolTest
testFindSenders
  "serveGetStream: is sent from the GET route block in buildRoutes. Few senders -> not capped."
  | out |
  out := self mcp tool_find_senders: (self oneArg: 'selector' value: 'serveGetStream:').
  self assert: (self includesCS: 'buildRoutes' in: out).
  self deny: (self includesCS: 'showing first' in: out)
%
category: 'tools - search'
method: GsMcpToolTest
testFindSendersTruncated
  "= has well over 200 senders, so the output is capped at 200 method lines and prefixed with
   a count note. Assert the note is present and exactly 200 method lines come back (the note
   line and any trailing blank have no '>>', so counting '>>' lines is robust)."
  | out lines methodLines |
  out := self mcp tool_find_senders: (self oneArg: 'selector' value: '=').
  self assert: (self includesCS: '(showing first 200 of ' in: out).
  lines := out subStrings: (String with: Character lf).
  methodLines := lines select: [:l | self includesCS: '>>' in: l].
  self assert: methodLines size = 200
%
category: 'tools - browsing'
method: GsMcpToolTest
testGetClassDefinition
  | def |
  self createFixtureClass.
  def := self mcp tool_get_class_definition: (self oneArg: 'className' value: 'GsMcpTestFixture').
  self assert: (self includesCS: 'Object subclass: ''GsMcpTestFixture''' in: def).
  self deny: (self includesCS: 'removeallmethods GsMcpTestFixture' in: def)
%
category: 'tools - browsing'
method: GsMcpToolTest
testGetClassHierarchy
  "Integer has a fixed hierarchy (its special subclasses can't be extended), so we can
   assert the tool's full output exactly: superclass chain (2-space indent per level) then
   sorted direct subclasses."
  | out lf expected |
  lf := String with: Character lf.
  expected := 'Object' , lf ,
    '  Magnitude' , lf ,
    '    Number' , lf ,
    '      Integer' , lf ,
    'Direct subclasses:' , lf ,
    '  LargeInteger' , lf ,
    '  SmallInteger' , lf.
  out := self mcp tool_get_class_hierarchy: (self oneArg: 'className' value: 'Integer').
  self assert: out = expected
%
category: 'tools - browsing'
method: GsMcpToolTest
testGetMethodSource
  | out |
  self createFixtureClass.
  out := self mcp tool_get_method_source:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'selector' put: 'probeAnswer'; yourself).
  self assert: (self includesCS: 'probeAnswerBody' in: out)
%
category: 'tools - browsing'
method: GsMcpToolTest
testGetMethodSourceMeta
  "meta=true returns the class-side method (probeClassSide is class-side only)."
  | out |
  self createFixtureClass.
  out := self mcp tool_get_method_source:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'selector' put: 'probeClassSide'; at: 'meta' put: true; yourself).
  self assert: (self includesCS: 'probeClassBody' in: out)
%
category: 'tools - browsing'
method: GsMcpToolTest
testGetMethodSourceMissing
  "A nonexistent selector reports 'No such method' rather than raising (sourceCodeAt: raises a
   LookupError for an absent selector, so the handler wraps it)."
  | out |
  self createFixtureClass.
  out := self mcp tool_get_method_source:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'selector' put: 'noSuchSelectorXyz'; yourself).
  self assert: (self includesCS: 'No such method' in: out)
%
category: 'tools - listing'
method: GsMcpToolTest
testListAllClasses
  | out |
  self createFixtureClass.
  out := self mcp tool_list_all_classes: Dictionary new.
  self assert: (self includesCS: 'GsMcpTestFixture  (UserGlobals)' in: out).
  self assert: (self includesCS: 'Boolean  (Globals)' in: out)
%
category: 'tools - listing'
method: GsMcpToolTest
testListClasses
  | classes |
  self createFixtureClass.
  classes := (self mcp tool_list_classes: (self oneArg: 'dictionaryName' value: 'UserGlobals'))
    subStrings: (String with: Character lf).
  self assert: (classes includes: 'GsMcpTestFixture').
  self deny: (classes includes: 'Boolean')
%
category: 'tools - listing'
method: GsMcpToolTest
testListDictionaries
  self assert: (self includesCS: 'UserGlobals' in: (self mcp tool_list_dictionaries: Dictionary new))
%
category: 'tools - listing'
method: GsMcpToolTest
testListDictionaryEntries
  | entries |
  self createFixtureClass.
  entries := (self mcp tool_list_dictionary_entries: (self oneArg: 'dictionaryName' value: 'UserGlobals'))
    subStrings: (String with: Character lf).
  self assert: (entries includes: 'GsMcpTestFixture  (class)').
  self deny: (entries includes: 'Boolean  (class)')
%
category: 'tools - testing'
method: GsMcpToolTest
testListFailingTests
  "Scoped to the fixture, the report lists its failing and erroring tests."
  | out |
  self createTestSuiteFixture.
  out := self mcp tool_list_failing_tests:
    (self oneArg: 'classNames' value: (Array with: 'GsMcpTestSuiteFixture')).
  self assert: (self includesCS: 'FAIL' in: out).
  self assert: (self includesCS: '#testFails' in: out).
  self assert: (self includesCS: 'ERROR' in: out).
  self assert: (self includesCS: '#testErrors' in: out)
%
category: 'tools - testing'
method: GsMcpToolTest
testListFailingTestsNone
  "A suite with no failures yields the empty-result sentinel."
  self assert: (self includesCS: 'no failing tests' in: (self mcp tool_list_failing_tests:
    (self oneArg: 'classNames' value: (Array with: 'SUnitTest'))))
%
category: 'tools - browsing'
method: GsMcpToolTest
testListMethods
  "list_methods shows both instance-side and class-side selectors."
  | methods |
  self createFixtureClass.
  methods := self mcp tool_list_methods: (self oneArg: 'className' value: 'GsMcpTestFixture').
  self assert: (self includesCS: 'probeAnswer' in: methods).
  self assert: (self includesCS: 'probeClassSide' in: methods)
%
category: 'tools - testing'
method: GsMcpToolTest
testListTestClasses
  self assert: (self includesCS: 'SUnitTest' in: (self mcp tool_list_test_classes: Dictionary new))
%
category: 'tools - session'
method: GsMcpToolTest
testRefresh
  "tool_refresh reveals the committed view, discarding uncommitted work (it is
   System abortTransaction under a friendlier name). Commit a fixture baseline, change its
   comment without committing, refresh, and confirm the committed comment is restored.
   A true cross-session refresh (another gem commits, we see it) is an integration concern,
   not a unit test. (tearDown removes GsMcpTestFixture.)"
  | cls out baseline |
  cls := self createFixtureClass.
  baseline := cls comment.
  cls comment: 'uncommitted - should be dropped by refresh'.
  self assert: (cls comment = 'uncommitted - should be dropped by refresh').
  out := self mcp tool_refresh: Dictionary new.
  self assert: (self includesCS: 'refreshed' in: out).
  self assert: (cls comment = baseline)
%
category: 'tools - mutation'
method: GsMcpToolTest
testRemoveDictionary
  | out |
  self mcp tool_add_dictionary: (self oneArg: 'dictionaryName' value: 'GsMcpTestDict').
  out := self mcp tool_remove_dictionary: (self oneArg: 'dictionaryName' value: 'GsMcpTestDict').
  self assert: (self includesCS: 'Removed dictionary' in: out).
  self deny: (self includesCS: 'GsMcpTestDict' in: (self mcp tool_list_dictionaries: Dictionary new))
%
category: 'tools - testing'
method: GsMcpToolTest
testRunTestClass
  "Run a suite with a passing, a failing, and erroring tests; the report names each non-passing
   test on its own line and summarizes the counts. Assert '1 passed' (only testPasses passes on
   every version) and that both the failing (#testFails) and erroring (#testErrors) tests are
   listed. We assert the FAIL marker but NOT ERROR: GS 3.6.2's TestResult can't distinguish
   errors from failures, so formatTestResult: labels every non-passing test FAIL there (3.7.x
   still shows ERROR for the real errors). includesCS: is case-sensitive, so 'FAIL' matches the
   line marker, not the word 'failed'."
  | out |
  self createTestSuiteFixture.
  out := self mcp tool_run_test_class: (self oneArg: 'className' value: 'GsMcpTestSuiteFixture').
  self assert: (self includesCS: '1 passed' in: out).
  self assert: (self includesCS: 'FAIL' in: out).
  self assert: (self includesCS: '#testFails' in: out).
  self assert: (self includesCS: '#testErrors' in: out)
%
category: 'tools - testing'
method: GsMcpToolTest
testRunTestMethod
  "A passing method reports a pass with no FAIL line; a failing method reports a FAIL line.
   includesCS: is case-sensitive, so the deny of 'FAIL' on the passing run is correct: it does
   NOT match the word 'failed' in the count summary."
  | pass fail |
  self createTestSuiteFixture.
  pass := self mcp tool_run_test_method:
    (Dictionary new at: 'className' put: 'GsMcpTestSuiteFixture'; at: 'selector' put: 'testPasses'; yourself).
  self assert: (self includesCS: '1 passed' in: pass).
  self deny: (self includesCS: 'FAIL' in: pass).
  fail := self mcp tool_run_test_method:
    (Dictionary new at: 'className' put: 'GsMcpTestSuiteFixture'; at: 'selector' put: 'testFails'; yourself).
  self assert: (self includesCS: '1 failed' in: fail).
  self assert: (self includesCS: 'FAIL' in: fail).
  self assert: (self includesCS: '#testFails' in: fail)
%
category: 'tools - testing'
method: GsMcpToolTest
testTestingToolsClassNotFound
  "The testing tools that resolve a class name report 'Class not found:' for an unknown class
   rather than erroring. 'Foo-Bar' is not a legal identifier, so it can never resolve."
  | badClass badMethod |
  badClass := self oneArg: 'className' value: 'Foo-Bar'.
  badMethod := Dictionary new at: 'className' put: 'Foo-Bar'; at: 'selector' put: 'testAnything'; yourself.
  self assert: (self mcp tool_run_test_class: badClass) = 'Class not found: Foo-Bar'.
  self assert: (self mcp tool_run_test_method: badMethod) = 'Class not found: Foo-Bar'.
  self assert: (self mcp tool_describe_test_failure: badMethod) = 'Class not found: Foo-Bar'
%
category: 'tools - search'
method: GsMcpToolTest
testSearchMethodSource
  | out |
  self createFixtureClass.
  out := self mcp tool_search_method_source:
    (Dictionary new at: 'pattern' put: 'probeAnswerBody'; at: 'dictionaryName' put: 'UserGlobals'; yourself).
  self assert: (self includesCS: 'GsMcpTestFixture>>probeAnswer' in: out)
%
category: 'tools - search'
method: GsMcpToolTest
testSearchMethodSourceTruncated
  "'self' appears in far more than 200 kernel methods, so scoping to Globals overflows the cap:
   the output is prefixed with the truncation note and holds exactly 200 hit lines (the note
   line has no '>>', so counting '>>' lines is robust)."
  | out lines hitLines |
  out := self mcp tool_search_method_source:
    (Dictionary new at: 'pattern' put: 'self'; at: 'dictionaryName' put: 'Globals'; yourself).
  self assert: (self includesCS: '(truncated at 200 hits)' in: out).
  lines := out subStrings: (String with: Character lf).
  hitLines := lines select: [:l | self includesCS: '>>' in: l].
  self assert: hitLines size = 200
%
category: 'tools - mutation'
method: GsMcpToolTest
testSetClassComment
  | out |
  self createFixtureClass.
  out := self mcp tool_set_class_comment:
    (Dictionary new at: 'className' put: 'GsMcpTestFixture'; at: 'comment' put: 'hello there'; yourself).
  self assert: (self includesCS: 'committed' in: out).
  self assert: (System myUserProfile objectNamed: #GsMcpTestFixture) comment equals: 'hello there'
%
category: 'tools - session'
method: GsMcpToolTest
testStatus
  self assert: (self includesCS: 'user=' in: (self mcp tool_status: Dictionary new))
%

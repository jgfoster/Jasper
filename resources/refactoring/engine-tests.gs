! Class declarations

doit
| cls |
cls := TestCase subclass: 'GsClassHistoryTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the class-definition history view + redo, built on GemStone''s
native classHistory:

  - forClassNamed: answers one JSON object per version, newest first, carrying the
    version index, the name it had then, its oop, timeStamp, userId, an isCurrent
    flag, its definition source, and the methods added / removed / modified relative
    to the previous version;
  - the baseline version lists all of its methods as ''added'';
  - forClassNamed: is read-only (no commit);
  - revertClassNamed:toIndex: restores a historical version''s shape and methods as
    a NEW version under the current name, bumping the history, without committing;
  - an unbound name / out-of-range index answer an error envelope.

setUp builds a two-version fixture in UserGlobals (a shape change plus a modified,
an unchanged, and an added method) and tearDown removes it.
'.
true.
%

removeallmethods GsClassHistoryTest
removeallclassmethods GsClassHistoryTest

doit
| cls |
cls := TestCase subclass: 'GsRefactoringChangeSetTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the non-committing change-set model: sequential ids, JSON
serialization (including string escaping and the null selector on a class
definition edit), per-change selection, and -- the binding invariant -- that
staging changes never dirties the transaction into needing a commit.
'.
true.
%

removeallmethods GsRefactoringChangeSetTest
removeallclassmethods GsRefactoringChangeSetTest

doit
| cls |
cls := TestCase subclass: 'GsRefactoringEnvironmentTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the read-only all-dictionaries environment: class resolution
and enumeration span every dictionary (not just UserGlobals); instance-variable
access is found for reads and writes across a class hierarchy and excludes
methods that never touch the variable; the instance-variable name argument
accepts a String or a Symbol; and the queries never dirty the transaction.

setUp builds a throwaway three-class hierarchy in UserGlobals and tearDown
removes it, so the assertions have known, self-contained answers.
'.
true.
%

removeallmethods GsRefactoringEnvironmentTest
removeallclassmethods GsRefactoringEnvironmentTest

doit
| cls |
cls := TestCase subclass: 'GsRenameClassRefactoringTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the rename-class refactoring:

  - the target class is staged as a #classRename whose new/old source is the
    class definition with the name changed;
  - every descendant is staged as a #classReparent (a direct child''s definition
    has its superclass name rewritten; a deeper descendant''s is unchanged but
    still staged, because its version must be recompiled to re-point at the new
    parent chain);
  - a reference to the old name in an OUTSIDE class''s method body is staged as a
    #methodRecompile with the reference rewritten minimal-diff, while the same
    name inside a comment or a #Symbol literal is left untouched;
  - the renamed subtree''s OWN methods are NOT staged as #methodRecompile (they are
    rewritten during copy-forward at apply);
  - scope selects which referencing methods are affected and counts the out-of-scope
    remainder, but re-parenting and the rebind are always done;
  - building the change set compiles nothing and commits nothing;
  - the server-side apply creates the new class version (bumping the class
    history), copies methods forward, re-parents descendants, rewrites external
    references, and removes the old name -- all without committing;
  - a new name already in use is reported as a collision precondition.

setUp builds a throwaway hierarchy plus an unrelated referencing class in
UserGlobals with fixture-unique names, and tearDown removes them (including the
rename target name).
'.
true.
%

removeallmethods GsRenameClassRefactoringTest
removeallclassmethods GsRenameClassRefactoringTest

doit
| cls |
cls := TestCase subclass: 'GsRenameInstanceVariableRefactoringTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the rename-instance-variable refactoring:

  - every read and write of the variable in the defining class and in
    subclasses is renamed;
  - a same-named block argument (and the references it captures) is left alone,
    even in a method that also has a genuine reference to the variable -- the
    shadowing case that a blind text or #replace:with: rewrite gets wrong;
  - a method whose reference is entirely shadowed, and a method that never
    touches the variable, produce no change at all (no false positives);
  - the method''s own selector, and other instance variables, are untouched;
  - the class definition is edited to carry the renamed instVarNames list;
  - building the change set recompiles nothing and commits nothing.

setUp builds a throwaway two-class hierarchy in UserGlobals and tearDown removes
it. The block-argument fixtures shadow the instance variable on purpose, which
the compiler warns about; the warning is resumed so the fixture still installs.
'.
true.
%

removeallmethods GsRenameInstanceVariableRefactoringTest
removeallclassmethods GsRenameInstanceVariableRefactoringTest

doit
| cls |
cls := TestCase subclass: 'GsRenameMethodRefactoringTest'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Tests-Core'.
cls comment: '
Correctness of the rename-method refactoring:

  - a keyword rename with an argument reorder rewrites the implementor signature
    AND every call site, moving each argument with its keyword;
  - unary and binary selectors rename too;
  - the selector spelling inside a comment or string literal is NEVER rewritten
    (an AST message-node rewrite, not text substitution);
  - super-sends and cascades are rewritten;
  - scope (#class / #hierarchy / #wholeSystem) selects which implementors and
    senders are affected, and the out-of-scope remainder is counted;
  - implementors are staged as #methodRename (compile-new + remove-old), senders
    as #methodRecompile;
  - building the change set compiles nothing and commits nothing;
  - the paginated preview returns byte-bounded pages with a next offset / done
    flag, and the server-side apply compiles new / removes old for all changes
    except the deselected ones, without committing.

setUp builds a throwaway hierarchy plus an unrelated sender class in UserGlobals
and tearDown removes them. The rename target (#movePointX:y:) is a spelling
unique to the fixture, so image-wide implementor/sender search finds only it.
'.
true.
%

removeallmethods GsRenameMethodRefactoringTest
removeallclassmethods GsRenameMethodRefactoringTest

! Class implementations

category: 'asserting'
method: GsClassHistoryTest
assert: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) > 0
%

category: 'fixture'
method: GsClassHistoryTest
compile: aSource in: aClass
	aClass compileMethod: aSource dictionaries: System myUserProfile symbolList category: 'fixture'
%

category: 'asserting'
method: GsClassHistoryTest
deny: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) = 0
%

category: 'fixture'
method: GsClassHistoryTest
fixture
	^UserGlobals at: #GsCHFixture
%

category: 'running'
method: GsClassHistoryTest
setUp
	| c |
	super setUp.
	"Version 1: instVar a; methods m1, common."
	c := Object
		subclass: 'GsCHFixture'
		instVarNames: #('a')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'm1 ^a' in: c.
	self compile: 'common ^1' in: c.
	"Version 2 (current): shape change adds b (new version starts empty); re-add m1
	 unchanged, modify common, add m2."
	c := Object
		subclass: 'GsCHFixture'
		instVarNames: #('a' 'b')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'm1 ^a' in: c.
	self compile: 'common ^2' in: c.
	self compile: 'm2 ^b' in: c
%

category: 'running'
method: GsClassHistoryTest
tearDown
	UserGlobals removeKey: #GsCHFixture ifAbsent: [].
	super tearDown
%

category: 'tests'
method: GsClassHistoryTest
testForClassNamedCarriesVersionMetadata
	| json |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.

	self assert: json includesSubstring: '"name":"GsCHFixture"'.
	self assert: json includesSubstring: '"isCurrent":true'.
	self assert: json includesSubstring: '"userId":'.
	self assert: json includesSubstring: '"timeStamp":'.
	self assert: json includesSubstring: '"oop":'.
	"Both versions present; the current one names both instVars."
	self assert: json includesSubstring: '"index":2'.
	self assert: json includesSubstring: '"index":1'
%

category: 'tests'
method: GsClassHistoryTest
testChangedMethodsDiffCurrentAgainstPrevious
	| json |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.

	"Current version (2): common modified, m2 added, m1 unchanged (not listed)."
	self assert: json includesSubstring: '"selector":"common","change":"modified"'.
	self assert: json includesSubstring: '"selector":"m2","change":"added"'
%

category: 'tests'
method: GsClassHistoryTest
testBaselineListsMethodsAsAdded
	| json baselineTail |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.
	"The baseline is the last object in the (newest-first) array."
	baselineTail := json copyFrom: (json indexOfSubCollection: '"index":1') to: json size.

	self assert: baselineTail includesSubstring: '"selector":"m1","change":"added"'.
	self assert: baselineTail includesSubstring: '"selector":"common","change":"added"'
%

category: 'tests'
method: GsClassHistoryTest
testTimeStampIsLocaleNeutralIso
	"The timestamp is emitted as a locale-neutral ISO-8601 string
	 (yyyy-mm-ddTHH:MM:SS) so the client can render it in the user's own locale:
	 a four-digit year, dashes at positions 5 and 8, a T at position 11."
	| json i s |
	json := GsClassHistory forClassNamed: 'GsCHFixture'.
	i := json indexOfSubCollection: '"timeStamp":"'.
	self assert: i > 0.
	s := json copyFrom: i + '"timeStamp":"' size to: json size.

	self assert: ((s copyFrom: 1 to: 4) allSatisfy: [:c | c isDigit]).
	self assert: (s at: 5) equals: $-.
	self assert: (s at: 8) equals: $-.
	self assert: (s at: 11) equals: $T
%

category: 'tests'
method: GsClassHistoryTest
testForClassNamedDoesNotCommit
	| before |
	before := System needsCommit.
	GsClassHistory forClassNamed: 'GsCHFixture'.
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsClassHistoryTest
testForClassNamedUnboundNameIsError
	self assert: (GsClassHistory forClassNamed: 'GsCHNoSuchClass')
		includesSubstring: '"error"'
%

category: 'tests'
method: GsClassHistoryTest
testRevertRestoresHistoricalShapeAndMethods
	| res current |
	res := GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 1.
	self assert: res includesSubstring: '"reverted":true'.

	current := self fixture.
	"Restored the version-1 shape (only a) and its methods, as a new version."
	self assert: current instVarNames asArray equals: #(#'a').
	self assert: (current includesSelector: #m1).
	self assert: (current includesSelector: #common).
	self assert: (current includesSelector: #m2) not.
	"common was restored to its version-1 source."
	self assert: (current compiledMethodAt: #common environmentId: 0 otherwise: nil) sourceString
		includesSubstring: '^1'.
	self assert: current classHistory size >= 3
%

category: 'tests'
method: GsClassHistoryTest
testRestoreAcrossRenameRenamesBackAndReparents
	"A class with a subclass and an external reference, renamed, then restored to the
	 pre-rename version: the restore renames the class back, re-parents the subclass,
	 and rewrites the external reference back -- restore is a full rename-back, not just
	 a shape/method redo."
	| base sub other renamed restored |
	base := Object
		subclass: 'GsCHRenBase'
		instVarNames: #('x') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	base compileMethod: 'foo ^x' dictionaries: System myUserProfile symbolList category: 'fixture'.
	sub := base
		subclass: 'GsCHRenSub'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsCHRenOther'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other compileMethod: 'make ^GsCHRenBase new'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	[ "rename GsCHRenBase -> GsCHRenAsset"
	 (GsRenameClassRefactoring class: base renameTo: 'GsCHRenAsset' scope: #wholeSystem)
		applyDeselected: #().
	 renamed := UserGlobals at: #GsCHRenAsset.
	 "restore to the original (pre-rename) version"
	 GsClassHistory
		revertClassNamed: 'GsCHRenAsset'
		toIndex: (renamed classHistory findFirst: [:v | v name asString = 'GsCHRenBase']).
	 restored := UserGlobals at: #GsCHRenBase ifAbsent: [nil].

	 self assert: (UserGlobals includesKey: #GsCHRenBase).
	 self assert: (UserGlobals includesKey: #GsCHRenAsset) not.
	 self assert: (UserGlobals at: #GsCHRenSub) superclass == restored.
	 self assert: ((UserGlobals at: #GsCHRenOther)
		compiledMethodAt: #make environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsCHRenBase new' ]
		ensure: [
			#('GsCHRenSub' 'GsCHRenOther' 'GsCHRenBase' 'GsCHRenAsset')
				do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]]
%

category: 'tests'
method: GsClassHistoryTest
testRevertDoesNotCommit
	| before |
	before := System needsCommit.
	GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 1.
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsClassHistoryTest
testRemoveVersionTrimsHistory
	| res |
	self assert: self fixture classHistory size >= 2.
	res := GsClassHistory removeVersionOf: 'GsCHFixture' index: 1.

	self assert: res includesSubstring: '"removed":true'.
	self assert: self fixture classHistory size equals: 1
%

category: 'tests'
method: GsClassHistoryTest
testRemoveVersionRefusesCurrent
	| current |
	current := self fixture classHistory indexOf: self fixture.
	self assert: (GsClassHistory removeVersionOf: 'GsCHFixture' index: current)
		includesSubstring: '"error"'
%

category: 'tests'
method: GsClassHistoryTest
testRemoveVersionDoesNotCommit
	| before |
	before := System needsCommit.
	GsClassHistory removeVersionOf: 'GsCHFixture' index: 1.
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsClassHistoryTest
testRevertOutOfRangeIsError
	self assert: (GsClassHistory revertClassNamed: 'GsCHFixture' toIndex: 99)
		includesSubstring: '"error"'
%

category: 'tests'
method: GsRefactoringChangeSetTest
testChangeWithIdFindsStagedChangeOrNil
	| cs staged |
	cs := GsRefactoringChangeSet new.
	staged := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'a2'.

	self assert: (cs changeWithId: '1') == staged.
	self assert: (cs changeWithId: '99') isNil
%

category: 'tests'
method: GsRefactoringChangeSetTest
testClassDefinitionEditSerializesWithNullSelector
	| cs json |
	cs := GsRefactoringChangeSet new.
	cs addClassDefinitionEditInDictionary: 'UserGlobals' className: 'Foo' oldSource: 'old' newSource: 'new'.

	json := cs jsonString.

	self assert: (json includesString: '"kind":"classDefinitionEdit"').
	self assert: (json includesString: '"selector":null').
	self assert: (json includesString: '"category":null').
	self assert: (json includesString: '"isMeta":false')
%

category: 'tests'
method: GsRefactoringChangeSetTest
testEmptyChangeSetSerializesToEmptyJsonArray
	| cs |
	cs := GsRefactoringChangeSet new.

	self assert: cs isEmpty.
	self assert: cs size equals: 0.
	self assert: cs jsonString equals: '[]'
%

category: 'tests'
method: GsRefactoringChangeSetTest
testJsonEscapesQuotesBackslashesAndControlCharacters
	| cs json src |
	src := 'q"b\' , (String with: Character tab) , (String with: Character lf).
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: src.

	json := cs jsonString.

	self assert: (json includesString: 'q\"b\\\t\n')
%

category: 'tests'
method: GsRefactoringChangeSetTest
testSelectedChangesReturnsOnlyRequestedIds
	| cs selected ids |
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'a2'.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #b category: 'accessing' oldSource: 'b' newSource: 'b2'.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #c category: 'accessing' oldSource: 'c' newSource: 'c2'.

	selected := cs selectedChanges: #('1' '3').
	ids := selected collect: [:c | c id].

	self assert: selected size equals: 2.
	self assert: (ids includes: '1').
	self assert: (ids includes: '3').
	self deny: (ids includes: '2')
%

category: 'tests'
method: GsRefactoringChangeSetTest
testSerializesAStagedMethodRecompile
	| cs json |
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: true selector: #bar category: 'accessing' oldSource: 'bar ^1' newSource: 'bar ^2'.

	json := cs jsonString.

	self assert: (json includesString: '"kind":"methodRecompile"').
	self assert: (json includesString: '"className":"Foo"').
	self assert: (json includesString: '"isMeta":true').
	self assert: (json includesString: '"selector":"bar"').
	self assert: (json includesString: '"category":"accessing"').
	self assert: (json includesString: '"newSource":"bar ^2"')
%

category: 'tests'
method: GsRefactoringChangeSetTest
testStagedChangesReceiveSequentialStringIds
	| cs first second |
	cs := GsRefactoringChangeSet new.

	first := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'b'.
	second := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #c category: 'accessing' oldSource: 'c' newSource: 'd'.

	self assert: first id equals: '1'.
	self assert: second id equals: '2'.
	self assert: cs size equals: 2
%

category: 'tests'
method: GsRefactoringChangeSetTest
testStagingChangesNeverRequiresACommit
	| before cs |
	before := System needsCommit.
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'a2'.
	cs addClassDefinitionEditInDictionary: 'UserGlobals' className: 'Foo' oldSource: 'old' newSource: 'new'.
	cs jsonString.

	self assert: System needsCommit equals: before
%

category: 'private'
method: GsRefactoringEnvironmentTest
noAccessFixture
	^UserGlobals at: #GsRefEnvFixtureSubNoAccess
%

category: 'running'
method: GsRefactoringEnvironmentTest
setUp
	"A tiny throwaway hierarchy so the instance-variable queries have known,
	 self-contained answers: a superclass defining 'alpha' with a reader, a
	 writer and a non-accessing method; a subclass that reads the inherited
	 'alpha'; and a sibling subclass that never touches it."
	| supr sl |
	sl := System myUserProfile symbolList.
	supr := Object
		subclass: 'GsRefEnvFixtureSuper'
		instVarNames: #('alpha')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	supr compileMethod: 'readAlpha ^alpha' dictionaries: sl category: 'tests'.
	supr compileMethod: 'writeAlpha: x alpha := x' dictionaries: sl category: 'tests'.
	supr compileMethod: 'noTouch ^42' dictionaries: sl category: 'tests'.
	(supr
		subclass: 'GsRefEnvFixtureSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals)
		compileMethod: 'useAlpha ^alpha + 1' dictionaries: sl category: 'tests'.
	(supr
		subclass: 'GsRefEnvFixtureSubNoAccess'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals)
		compileMethod: 'other ^0' dictionaries: sl category: 'tests'
%

category: 'private'
method: GsRefactoringEnvironmentTest
subFixture
	^UserGlobals at: #GsRefEnvFixtureSub
%

category: 'private'
method: GsRefactoringEnvironmentTest
superFixture
	^UserGlobals at: #GsRefEnvFixtureSuper
%

category: 'running'
method: GsRefactoringEnvironmentTest
tearDown
	#('GsRefEnvFixtureSubNoAccess' 'GsRefEnvFixtureSub' 'GsRefEnvFixtureSuper')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testAllClassesSpansEveryDictionaryWithoutDuplicates
	| all |
	all := GsRefactoringEnvironment new allClasses.

	self assert: (all includes: Object).
	self assert: (all includes: self superFixture).
	self assert: (all occurrencesOf: Object) equals: 1
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testClassNamedResolvesClassesFromAnyDictionary
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env classNamed: #Object) == Object.
	self assert: (env classNamed: #GsRefEnvFixtureSuper) == self superFixture
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testDictionariesDefiningNameReflectWhereTheClassLives
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (((env dictionariesDefiningClassNamed: #Object) collect: [:d | d name])
		includes: #Globals).
	self assert: (((env dictionariesDefiningClassNamed: #GsRefEnvFixtureSuper) collect: [:d | d name])
		includes: #UserGlobals)
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testFindsInstanceMethodsThatReadOrWriteTheInstVar
	| sels |
	sels := GsRefactoringEnvironment new instanceMethodsAccessing: #alpha inClass: self superFixture.

	self assert: (sels includes: #readAlpha).
	self assert: (sels includes: #writeAlpha:).
	self deny: (sels includes: #noTouch)
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testHierarchyQueryIncludesTheDefiningClassAndAccessingSubclasses
	| classes |
	classes := (GsRefactoringEnvironment new
		classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture)
		collect: [:assoc | assoc key].

	self assert: (classes includes: self superFixture).
	self assert: (classes includes: self subFixture)
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testHierarchyQueryOmitsClassesThatNeverAccessTheInstVar
	| classes |
	classes := (GsRefactoringEnvironment new
		classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture)
		collect: [:assoc | assoc key].

	self deny: (classes includes: self noAccessFixture)
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testInstVarNameArgumentAcceptsAStringOrASymbol
	| env |
	env := GsRefactoringEnvironment new.

	self assert: (env instanceMethodsAccessing: 'alpha' inClass: self superFixture)
		equals: (env instanceMethodsAccessing: #alpha inClass: self superFixture)
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testReadOnlyQueriesDoNotChangeCommitState
	| env before |
	env := GsRefactoringEnvironment new.
	before := System needsCommit.

	env allClasses.
	env classNamed: #Object.
	env instanceMethodsAccessing: #alpha inClass: self superFixture.
	env classesAndSelectorsAccessing: #alpha inHierarchyOf: self superFixture.

	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsRefactoringEnvironmentTest
testUnknownClassNameResolvesToNil
	self assert: (GsRefactoringEnvironment new classNamed: #GsNoSuchClass_ZZZ) isNil
%

category: 'asserting'
method: GsRenameClassRefactoringTest
assert: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) > 0
%

category: 'fixture'
method: GsRenameClassRefactoringTest
baseFixture
	^UserGlobals at: #GsRCBase
%

category: 'fixture'
method: GsRenameClassRefactoringTest
changeOfKind: aKind for: aClassName in: aChangeSet
	^aChangeSet changes
		detect: [:c | c kind = aKind and: [c className asString = aClassName asString]]
		ifNone: [nil]
%

category: 'fixture'
method: GsRenameClassRefactoringTest
compile: aSource in: aClass
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
%

category: 'asserting'
method: GsRenameClassRefactoringTest
deny: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) = 0
%

category: 'fixture'
method: GsRenameClassRefactoringTest
renameTo: aName scope: scopeSymbol
	^GsRenameClassRefactoring
		class: self baseFixture
		renameTo: aName
		scope: scopeSymbol
%

category: 'running'
method: GsRenameClassRefactoringTest
setUp
	| base sub other |
	super setUp.
	base := Object
		subclass: 'GsRCBase'
		instVarNames: #('x')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRCSub'
		instVarNames: #('y')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsRCOther'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'foo ^x' in: base.
	"A self-reference inside the subtree, with the name also in a comment."
	self compile: 'makeSelf "GsRCBase is the receiver" ^GsRCBase new' in: base.
	"A subtree reference: GsRCSub is a descendant, so its GsRCBase reference is
	 handled by copy-forward, not staged as a #methodRecompile."
	self compile: 'bar ^GsRCBase new' in: sub.
	"An external reference plus a same-spelled comment AND a #Symbol literal that
	 must both survive the rewrite."
	self compile: 'usesBase "makes a GsRCBase" ^Array with: #GsRCBase with: GsRCBase new' in: other
%

category: 'fixture'
method: GsRenameClassRefactoringTest
subFixture
	^UserGlobals at: #GsRCSub
%

category: 'running'
method: GsRenameClassRefactoringTest
tearDown
	#('GsRCSub' 'GsRCOther' 'GsRCBase' 'GsRCRenamed')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []].
	super tearDown
%

category: 'tests'
method: GsRenameClassRefactoringTest
testClassRenameChangeStaged
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #classRename for: 'GsRCBase' in: cs.

	self assert: change notNil.
	self assert: change newName asString equals: 'GsRCRenamed'.
	self assert: change newSource includesSubstring: 'subclass: ''GsRCRenamed'''.
	self assert: change oldSource includesSubstring: 'subclass: ''GsRCBase'''.
	"The instVar list is preserved across the rename."
	self assert: change newSource includesSubstring: 'x'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testDescendantReparentStaged
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #classReparent for: 'GsRCSub' in: cs.

	self assert: change notNil.
	"A direct child's definition names the new superclass."
	self assert: change newSource includesSubstring: 'GsRCRenamed subclass: ''GsRCSub'''.
	self deny: change newSource includesSubstring: 'GsRCBase subclass:'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testExternalReferenceRewrittenCommentAndSymbolSafe
	| cs change |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.
	change := self changeOfKind: #methodRecompile for: 'GsRCOther' in: cs.

	self assert: change notNil.
	"The real reference is rewritten..."
	self assert: change newSource includesSubstring: 'GsRCRenamed new'.
	"...but the comment and the #Symbol literal keep the old spelling."
	self assert: change newSource includesSubstring: '"makes a GsRCBase"'.
	self assert: change newSource includesSubstring: '#GsRCBase'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testSubtreeOwnMethodsNotStagedAsReferenceRecompile
	| cs |
	cs := (self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.

	"GsRCSub>>bar and GsRCBase>>makeSelf reference the old name but live inside the
	 renamed subtree, so they are handled by copy-forward, not as #methodRecompile."
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCSub' in: cs) isNil.
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCBase' in: cs) isNil
%

category: 'tests'
method: GsRenameClassRefactoringTest
testBuildingChangeSetDoesNotCommit
	| before |
	before := System needsCommit.
	(self renameTo: 'GsRCRenamed' scope: #wholeSystem) changeSet.

	self assert: (UserGlobals includesKey: #GsRCBase).
	self assert: (UserGlobals includesKey: #GsRCRenamed) not.
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsRenameClassRefactoringTest
testClassScopeExcludesExternalReference
	| ref cs |
	ref := self renameTo: 'GsRCRenamed' scope: #class.
	cs := ref changeSet.

	"The external GsRCOther reference is out of #class scope and not staged..."
	self assert: (self changeOfKind: #methodRecompile for: 'GsRCOther' in: cs) isNil.
	self assert: ref outOfScopeReferenceCount >= 1.
	"...but the rename and the descendant reparent are structural and always staged."
	self assert: (self changeOfKind: #classRename for: 'GsRCBase' in: cs) notNil.
	self assert: (self changeOfKind: #classReparent for: 'GsRCSub' in: cs) notNil
%

category: 'tests'
method: GsRenameClassRefactoringTest
testNewNameCollisionDetected
	| ref |
	ref := self renameTo: 'GsRCOther' scope: #wholeSystem.
	self assert: ref newNameCollision notNil.
	self assert: ref outOfScopeJsonString includesSubstring: 'already in use'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testServerSideApplyReshapesStoneAndBumpsHistory
	| ref renamed sub other |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	ref applyDeselected: #().

	renamed := UserGlobals at: #GsRCRenamed ifAbsent: [nil].
	sub := UserGlobals at: #GsRCSub ifAbsent: [nil].
	other := UserGlobals at: #GsRCOther ifAbsent: [nil].

	"Old name gone, new name bound to a class carrying the copied-forward method."
	self assert: (UserGlobals includesKey: #GsRCBase) not.
	self assert: renamed notNil.
	self assert: (renamed includesSelector: #foo).
	"The class history records the rename: old version keeps the old name."
	self assert: renamed classHistory size >= 2.
	self assert: (renamed classHistory at: 1) name asString equals: 'GsRCBase'.
	"The descendant is re-parented onto the new version and its own reference rewritten."
	self assert: sub superclass == renamed.
	self assert: (sub compiledMethodAt: #bar environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCRenamed new'.
	"The external reference is rewritten."
	self assert: (other compiledMethodAt: #usesBase environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCRenamed new'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testApplyDoesNotCommit
	| before |
	before := System needsCommit.
	(self renameTo: 'GsRCRenamed' scope: #wholeSystem) applyDeselected: #().
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsRenameClassRefactoringTest
testApplyHonoursDeselectionOfExternalReference
	| ref refChangeId other |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	refChangeId := (self changeOfKind: #methodRecompile for: 'GsRCOther' in: ref changeSet) id.
	ref applyDeselected: (Array with: refChangeId).
	other := UserGlobals at: #GsRCOther ifAbsent: [nil].

	"The rename still happened, but the deselected external reference was left as-is."
	self assert: (UserGlobals includesKey: #GsRCRenamed).
	self assert: (other compiledMethodAt: #usesBase environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'GsRCBase new'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testPaginatedPreviewReturnsBoundedPages
	| ref total firstPage lastPage |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem.
	total := ref changeSet size.
	self assert: total > 1.

	firstPage := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: firstPage includesSubstring: '"nextOffset":2'.
	self assert: firstPage includesSubstring: '"done":false'.

	lastPage := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: lastPage includesSubstring: '"done":true'
%

category: 'tests'
method: GsRenameClassRefactoringTest
testRenamePreservesFormatAndInvariantOption
	"A rename must keep the class's exact format -- including the instancesInvariant
	 option (a format bit) -- not silently reset it to the superclass's format."
	| inv renamed |
	inv := Object
		_subclass: 'GsRCInv' instVarNames: #('y') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals newVersionOf: nil description: nil options: #(#instancesInvariant).
	[ (GsRenameClassRefactoring class: inv renameTo: 'GsRCInvR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCInvR.
	 self assert: renamed format equals: inv format ]
		ensure: [ #('GsRCInv' 'GsRCInvR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
%

category: 'tests'
method: GsRenameClassRefactoringTest
testRenamePreservesIndexableFormat
	"A rename of an indexable class must keep it indexable (format inherited from the
	 variable superclass), not turn it into a named/non-indexable class."
	| arr renamed |
	arr := Array
		subclass: 'GsRCArr' instVarNames: #('x') classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	[ (GsRenameClassRefactoring class: arr renameTo: 'GsRCArrR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCArrR.
	 self assert: renamed isIndexable.
	 self assert: renamed format equals: arr format.
	 self assert: renamed instVarNames asArray equals: #(#'x') ]
		ensure: [ #('GsRCArr' 'GsRCArrR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
%

category: 'tests'
method: GsRenameClassRefactoringTest
testRenamePreservesCategoryAndClassVars
	"A rename must keep the class category and the SHARED class-variable values (which
	 all versions of a class history reference)."
	| base renamed |
	base := Object
		subclass: 'GsRCCat' instVarNames: #() classVars: #('Tally') classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	base category: 'GsRC-Category-Test'.
	base := UserGlobals at: #GsRCCat.
	base class compileMethod: 'bump Tally := (Tally ifNil: [0]) + 5'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	base class compileMethod: 'tally ^Tally'
		dictionaries: System myUserProfile symbolList category: 'fixture'.
	base bump.
	[ (GsRenameClassRefactoring class: base renameTo: 'GsRCCatR' scope: #wholeSystem) applyDeselected: #().
	 renamed := UserGlobals at: #GsRCCatR.
	 self assert: renamed category equals: 'GsRC-Category-Test'.
	 self assert: renamed tally equals: 5 ]
		ensure: [ #('GsRCCat' 'GsRCCatR') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []] ]
%

category: 'fixture'
method: GsRenameClassRefactoringTest
renameTo: aName scope: scopeSymbol copyMethods: cm recompileSubclasses: rs
	"A rename of the fixture with the two non-committing options set (migrate and
	 remove-from-history stay OFF so the apply never commits, as a test must not)."
	| ref |
	ref := GsRenameClassRefactoring class: self baseFixture renameTo: aName scope: scopeSymbol.
	ref copyMethods: cm recompileSubclasses: rs migrateInstances: false removeOldFromHistory: false.
	^ref
%

category: 'tests'
method: GsRenameClassRefactoringTest
testCopyMethodsOptionOffLeavesNewVersionBare
	| ref renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: false recompileSubclasses: true.
	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.

	"With copy-methods off, the new version starts with an empty method dictionary."
	self assert: renamed selectors isEmpty.
	"...and the apply did not commit."
	self assert: System needsCommit
%

category: 'tests'
method: GsRenameClassRefactoringTest
testRecompileSubclassesOptionOffSkipsReparent
	| ref cs renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: false.
	cs := ref changeSet.
	"No #classReparent changes are staged when recompile-subclasses is off."
	self assert: (self changeOfKind: #classReparent for: 'GsRCSub' in: cs) isNil.

	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.
	"The subclass is left pointing at the old (superseded) version, not re-parented."
	self deny: (self subFixture superclass == renamed)
%

category: 'tests'
method: GsRenameClassRefactoringTest
testPruneSupersededVersionsTrimsHistoryToCurrent
	| ref renamed |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: true.
	ref applyDeselected: #().
	renamed := UserGlobals at: #GsRCRenamed.
	self assert: renamed classHistory size > 1.

	"Pruning (the remove-old-from-history option, exercised here without the commit)
	 trims the class history down to just the current version."
	ref pruneSupersededVersions.
	self assert: renamed classHistory size equals: 1.
	self assert: (renamed classHistory at: 1) == renamed.
	self assert: System needsCommit
%

category: 'tests'
method: GsRenameClassRefactoringTest
testMigrateAllInstancesNeverRaises
	"migrateAllInstances must answer an Integer failure count and never propagate an
	 exception, even when a migration cannot run. Here the structural rename has not
	 been committed, so migrateInstancesTo: raises TransactionError (it needs a clean
	 transaction) -- the method must CATCH that and count it, not blow up. The real
	 apply commits before migrating; the full migrate+commit path is exercised via the
	 GCI/MCP round trip (which needs committed instances and so cannot run in a
	 no-commit SUnit test)."
	| ref result |
	ref := self renameTo: 'GsRCRenamed' scope: #wholeSystem copyMethods: true recompileSubclasses: true.
	ref applyDeselected: #().
	result := ref migrateAllInstances.

	self assert: (result isKindOf: Integer).
	self assert: result >= 0
%

category: 'tests'
method: GsRenameClassRefactoringTest
testStartPreviewCarriesTotalsAndNames
	| json |
	json := (self renameTo: 'GsRCRenamed' scope: #wholeSystem)
		startPreviewToken: 'gsrc_test_tok' maxBytes: 200000.
	GsRenameClassRefactoring clearToken: 'gsrc_test_tok'.

	self assert: json includesSubstring: '"oldName":"GsRCBase"'.
	self assert: json includesSubstring: '"newName":"GsRCRenamed"'.
	self assert: json includesSubstring: 'classRename'.
	self assert: json includesSubstring: 'classReparent'
%

category: 'asserting'
method: GsRenameInstanceVariableRefactoringTest
assert: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) > 0
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
baseFixture
	^UserGlobals at: #GsRIVBase
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
classDefinitionChangeIn: aChangeSet
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit]
		ifNone: [nil]
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
compile: aSource in: aClass
	"Install aSource on aClass, resuming the shadow warning the block-argument
	 fixtures raise so they still compile."
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
%

category: 'asserting'
method: GsRenameInstanceVariableRefactoringTest
deny: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) = 0
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
methodChangeFor: aSelector in: aChangeSet
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
renameCountTo: aNewName
	"The staged change set for renaming the 'count' instance variable of the
	 fixture base class to aNewName."
	^(GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: aNewName) changeSet
%

category: 'running'
method: GsRenameInstanceVariableRefactoringTest
setUp
	"A base class with instance variables 'count' and 'other', and a subclass.
	 The methods exercise: a plain read, a read of a sibling variable, an
	 assignment, a genuine read alongside a shadowing block argument (mixed), a
	 fully shadowing block argument (blockOnly), a method that touches only the
	 sibling variable (getOther), a selector spelled like the variable (count),
	 and a subclass read (doubleCount)."
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsRIVBase'
		instVarNames: #('count' 'other')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRIVSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'combine ^count + other' in: base.
	self compile: 'count ^count' in: base.
	self compile: 'increment count := count + 1' in: base.
	self compile: 'mixed | s | s := count. ^[:count | count + 1] value: s' in: base.
	self compile: 'blockOnly ^[:count | count * count] value: 3' in: base.
	self compile: 'getOther ^other' in: base.
	self compile: 'doubleCount ^count * 2' in: sub
%

category: 'fixture'
method: GsRenameInstanceVariableRefactoringTest
subFixture
	^UserGlobals at: #GsRIVSub
%

category: 'running'
method: GsRenameInstanceVariableRefactoringTest
tearDown
	#('GsRIVSub' 'GsRIVBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit
	| before |
	before := System needsCommit.
	self renameCountTo: 'tally'.

	"The defining class still declares 'count' and its methods are unchanged:
	 building the preview recompiles nothing."
	self assert: (self baseFixture instVarNames includes: #count).
	self assert: (self baseFixture compiledMethodAt: #combine) sourceString
		includesSubstring: 'count'.
	"...and it never commits: the transaction's dirty state is unchanged."
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testFullyShadowedMethodProducesNoChange
	"blockOnly's only reference to 'count' is captured by a same-named block
	 argument, so the method does not access the instance variable at all."
	self assert: (self methodChangeFor: #blockOnly in: (self renameCountTo: 'tally')) isNil
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testLeavesOtherInstanceVariableReferencesUntouched
	| change |
	change := self methodChangeFor: #combine in: (self renameCountTo: 'tally').

	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testMethodSelectorSpelledLikeTheVariableIsNotRenamed
	"The 'count' method reads 'count'; only the variable reference is renamed --
	 the selector stays 'count'."
	| change |
	change := self methodChangeFor: #count in: (self renameCountTo: 'tally').

	self assert: change selector equals: #count.
	self assert: change newSource includesSubstring: 'count'.
	self assert: change newSource includesSubstring: 'tally'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testNonAccessingMethodProducesNoChange
	"getOther touches only the sibling variable 'other'."
	self assert: (self methodChangeFor: #getOther in: (self renameCountTo: 'tally')) isNil
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testPreviewJsonStringSerializesTheChangeSet
	| json |
	json := (GsRenameInstanceVariableRefactoring
		class: self baseFixture
		renameInstVar: 'count'
		to: 'tally') previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRecompile'.
	self assert: json includesSubstring: 'classDefinitionEdit'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testRenamesAssignmentInDefiningClass
	| change |
	change := self methodChangeFor: #increment in: (self renameCountTo: 'tally').

	self assert: change newSource includesSubstring: 'tally := tally + 1'.
	self deny: change newSource includesSubstring: 'count'.
	"The method's category travels with the change so the client can address it."
	self assert: change category equals: 'fixture'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testRenamesReferencesInSubclassMethods
	| change |
	change := self methodChangeFor: #doubleCount in: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change className equals: #GsRIVSub.
	self assert: change newSource includesSubstring: 'tally * 2'.
	self deny: change newSource includesSubstring: 'count'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testShadowingBlockArgumentAndItsReferencesAreNotRenamed
	"mixed reads the instance variable (s := count) and separately has a block
	 whose argument is also named count. Only the genuine reference is renamed;
	 the block argument declaration and the reference it captures stay 'count'."
	| change |
	change := self methodChangeFor: #mixed in: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change newSource includesSubstring: 's := tally'.
	self assert: change newSource includesSubstring: ':count'.
	self assert: change newSource includesSubstring: 'count + 1'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testStagesClassDefinitionEditWithRenamedInstVar
	| change |
	change := self classDefinitionChangeIn: (self renameCountTo: 'tally').

	self assert: change notNil.
	self assert: change className equals: #GsRIVBase.
	self assert: change oldSource includesSubstring: 'count'.
	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
%

category: 'tests'
method: GsRenameInstanceVariableRefactoringTest
testStagesOneChangePerAffectedMethodPlusClassDefinition
	"combine, count, increment, mixed (base) and doubleCount (subclass) are the
	 five accessing methods; blockOnly and getOther are excluded; plus the one
	 class-definition edit."
	| cs recompiles |
	cs := self renameCountTo: 'tally'.
	recompiles := cs changes select: [:c | c kind = #methodRecompile].

	self assert: recompiles size equals: 5.
	self assert: (self classDefinitionChangeIn: cs) notNil
%

category: 'asserting'
method: GsRenameMethodRefactoringTest
assert: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) > 0
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
baseFixture
	^UserGlobals at: #GsRMBase
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
compile: aSource in: aClass
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
%

category: 'asserting'
method: GsRenameMethodRefactoringTest
deny: aString includesSubstring: aSubstring
	self assert: (aString indexOfSubCollection: aSubstring) = 0
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
implementorChangeFor: aClassName in: aChangeSet
	^aChangeSet changes
		detect: [:c | c kind = #methodRename and: [c className asString = aClassName asString]]
		ifNone: [nil]
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
renamePartsTo: partsArray permutation: permArray scope: scopeSymbol
	"A rename of the fixture's #movePointX:y: to the given parts/permutation."
	^GsRenameMethodRefactoring
		class: self baseFixture
		renameSelector: #'movePointX:y:'
		toParts: partsArray
		permutation: permArray
		scope: scopeSymbol
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
senderChangeFor: aSelector in: aChangeSet
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector asString = aSelector asString]]
		ifNone: [nil]
%

category: 'running'
method: GsRenameMethodRefactoringTest
setUp
	| base sub other |
	super setUp.
	base := Object
		subclass: 'GsRMBase'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRMSub'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsRMOther'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'movePointX: x y: y
	"moves the point -- mentions movePointX:y: in this comment"
	^Array with: x with: y' in: base.
	self compile: 'ping
	^1' in: base.
	self compile: '+ aThing
	^aThing' in: base.
	self compile: 'caller
	"a caller of movePointX:y: and ping"
	self ping.
	^self movePointX: 1 y: 2' in: base.
	self compile: 'cascadeCaller
	^self movePointX: 1 y: 2; ping; yourself' in: base.
	self compile: 'movePointX: x y: y
	^super movePointX: x y: y' in: sub.
	self compile: 'usePoint
	^GsRMBase new movePointX: 3 y: 4' in: other
%

category: 'fixture'
method: GsRenameMethodRefactoringTest
subFixture
	^UserGlobals at: #GsRMSub
%

category: 'running'
method: GsRenameMethodRefactoringTest
tearDown
	#('GsRMSub' 'GsRMOther' 'GsRMBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []].
	super tearDown
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testBinarySelectorRenames
	| cs change |
	cs := (GsRenameMethodRefactoring
		class: self baseFixture renameSelector: #'+'
		toParts: #('%') permutation: #(1) scope: #class) changeSet.
	change := self implementorChangeFor: 'GsRMBase' in: cs.

	self assert: change notNil.
	self assert: change newSource includesSubstring: '% aThing'.
	self assert: change newSelector asString equals: '%'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testBuildingChangeSetDoesNotCommit
	| before |
	before := System needsCommit.
	(self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.

	self assert: (self baseFixture compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) notNil.
	self assert: System needsCommit equals: before
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testCascadeSendIsRewritten
	| change |
	change := self senderChangeFor: #cascadeCaller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'moveY: 2 x: 1'.
	self deny: change newSource includesSubstring: 'movePointX:'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testClassScopeExcludesSubclassAndUnrelatedSenders
	| ref cs |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	cs := ref changeSet.

	"Only GsRMBase's implementor is in scope; GsRMSub's override is not."
	self assert: (self implementorChangeFor: 'GsRMBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsRMSub' in: cs) isNil.
	self assert: ref outOfScopeImplementorCount equals: 1.
	"GsRMOther>>usePoint is an out-of-scope sender."
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsRMOther']) not).
	self assert: ref outOfScopeSenderCount >= 1
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testCommentSpellingIsNotRewritten
	| impl sender |
	impl := self implementorChangeFor: 'GsRMBase'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	"The implementor's comment names movePointX:y: and must keep it verbatim."
	self assert: impl newSource includesSubstring: 'mentions movePointX:y: in this comment'.
	sender := self senderChangeFor: #caller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.
	self assert: sender newSource includesSubstring: 'a caller of movePointX:y: and ping'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testHierarchyScopeIncludesSubclassExcludesUnrelated
	| ref cs |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #hierarchy.
	cs := ref changeSet.

	self assert: (self implementorChangeFor: 'GsRMBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsRMSub' in: cs) notNil.
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsRMOther']) not)
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testImplementorStagedAsRenameSenderAsRecompile
	| cs impl sender |
	cs := (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsRMBase' in: cs.
	sender := self senderChangeFor: #caller in: cs.

	self assert: impl kind equals: #methodRename.
	self assert: impl selector asString equals: 'movePointX:y:'.
	self assert: impl newSelector asString equals: 'moveY:x:'.
	self assert: sender kind equals: #methodRecompile.
	self assert: sender newSelector isNil
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testKeywordRenameReordersImplementorSignature
	| change |
	change := self implementorChangeFor: 'GsRMBase'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	"Signature reordered: keyword parts + their arguments move together."
	self assert: change newSource includesSubstring: 'moveY: y x: x'.
	"The body still binds x and y by name, unchanged."
	self assert: change newSource includesSubstring: '^Array with: x with: y'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testKeywordRenameReordersSenderArguments
	| change |
	change := self senderChangeFor: #caller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	self assert: change newSource includesSubstring: 'self moveY: 2 x: 1'.
	"Only the send changes; the comment naming movePointX:y: is preserved, so we
	 check the SEND spelling is gone, not the substring generally."
	self deny: change newSource includesSubstring: 'self movePointX:'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testPaginationReturnsBoundedPagesWithOffsets
	| ref total firstPage lastPage |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem.
	total := ref changeSet size.
	self assert: total > 1.

	"maxBytes of 1 forces one change per page (at least one is always emitted)."
	firstPage := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: firstPage includesSubstring: '"nextOffset":2'.
	self assert: firstPage includesSubstring: '"done":false'.

	lastPage := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: lastPage includesSubstring: '"done":true'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testPreviewJsonStringSerializesBothKinds
	| json |
	json := (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRename'.
	self assert: json includesSubstring: 'methodRecompile'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testServerSideApplyCompilesNewAndRemovesOld
	| ref base |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	ref applyDeselected: #().
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) isNil.
	"The sender was recompiled in place to call the new selector."
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'moveY: 2 x: 1'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testServerSideApplyHonoursDeselection
	| ref base senderId |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	senderId := (self senderChangeFor: #caller in: ref changeSet) id.
	ref applyDeselected: (Array with: senderId).
	base := self baseFixture.

	"The implementor was renamed, but the deselected sender was left untouched."
	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'movePointX: 1 y: 2'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testSuperSendIsRewritten
	| change |
	change := self implementorChangeFor: 'GsRMSub'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #hierarchy) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'super moveY: y x: x'
%

category: 'tests'
method: GsRenameMethodRefactoringTest
testUnarySelectorRenames
	| cs change |
	cs := (GsRenameMethodRefactoring
		class: self baseFixture renameSelector: #ping
		toParts: #('pong') permutation: #() scope: #class) changeSet.
	change := self implementorChangeFor: 'GsRMBase' in: cs.

	self assert: change notNil.
	self assert: change newSelector asString equals: 'pong'.
	"The sender's #ping send is rewritten to #pong."
	self assert: (self senderChangeFor: #caller in: cs) newSource includesSubstring: 'self pong'
%

! Extension methods

"
Correctness of the non-committing change-set model: sequential ids, JSON
serialization (including string escaping and the null selector on a class
definition edit), per-change selection, and -- the binding invariant -- that
staging changes never dirties the transaction into needing a commit.
"
Class {
	#name : 'GsRefactoringChangeSetTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testChangeWithIdFindsStagedChangeOrNil [
	| cs staged |
	cs := GsRefactoringChangeSet new.
	staged := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'a2'.

	self assert: (cs changeWithId: '1') == staged.
	self assert: (cs changeWithId: '99') isNil
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testClassDefinitionEditSerializesWithNullSelector [
	| cs json |
	cs := GsRefactoringChangeSet new.
	cs addClassDefinitionEditInDictionary: 'UserGlobals' className: 'Foo' oldSource: 'old' newSource: 'new'.

	json := cs jsonString.

	self assert: (json includesString: '"kind":"classDefinitionEdit"').
	self assert: (json includesString: '"selector":null').
	self assert: (json includesString: '"category":null').
	self assert: (json includesString: '"isMeta":false')
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testEmptyChangeSetSerializesToEmptyJsonArray [
	| cs |
	cs := GsRefactoringChangeSet new.

	self assert: cs isEmpty.
	self assert: cs size equals: 0.
	self assert: cs jsonString equals: '[]'
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testJsonEscapesQuotesBackslashesAndControlCharacters [
	| cs json src |
	src := 'q"b\' , (String with: Character tab) , (String with: Character lf).
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: src.

	json := cs jsonString.

	self assert: (json includesString: 'q\"b\\\t\n')
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testSelectedChangesReturnsOnlyRequestedIds [
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
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testSerializesAStagedMethodRecompile [
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
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testStagedChangesReceiveSequentialStringIds [
	| cs first second |
	cs := GsRefactoringChangeSet new.

	first := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'b'.
	second := cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #c category: 'accessing' oldSource: 'c' newSource: 'd'.

	self assert: first id equals: '1'.
	self assert: second id equals: '2'.
	self assert: cs size equals: 2
]

{ #category : 'tests' }
GsRefactoringChangeSetTest >> testStagingChangesNeverRequiresACommit [
	| before cs |
	before := System needsCommit.
	cs := GsRefactoringChangeSet new.
	cs addMethodRecompileInDictionary: 'UserGlobals' className: 'Foo' isMeta: false selector: #a category: 'accessing' oldSource: 'a' newSource: 'a2'.
	cs addClassDefinitionEditInDictionary: 'UserGlobals' className: 'Foo' oldSource: 'old' newSource: 'new'.
	cs jsonString.

	self assert: System needsCommit equals: before
]

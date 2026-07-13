"
A read-only wrapper over the whole symbol list -- ALL dictionaries, not just
UserGlobals -- that answers the structural questions a refactoring asks before
it changes anything: which classes exist and where, and which methods read or
write a given instance variable across a class hierarchy.

Instance-variable access is found with bytecode-level reflection
(GsNMethod>>instVarsAccessed), so it needs no source parse and finds accesses
the source text alone might miss. Every query here is read-only: nothing in
this class compiles a method or commits the transaction.
"
Class {
	#name : 'GsRefactoringEnvironment',
	#superclass : 'Object',
	#instVars : [
		'symbolList'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRefactoringEnvironment class >> new [
	"An environment over the current session's whole symbol list (all
	 dictionaries), which is the rename scope this engine operates in."
	^self onSymbolList: System myUserProfile symbolList
]

{ #category : 'instance creation' }
GsRefactoringEnvironment class >> onSymbolList: aSymbolList [
	^self basicNew setSymbolList: aSymbolList
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> allClasses [
	"Every class reachable in any dictionary of the symbol list, de-duplicated by
	 identity. Walks ALL dictionaries, not just UserGlobals."
	| set |
	set := IdentitySet new.
	self dictionariesDo: [:dict |
		dict do: [:value | (value isKindOf: Class) ifTrue: [set add: value]]].
	^set
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> classesAndSelectorsAccessing: anInstVarName inHierarchyOf: aClass [
	"The rename-instVar affected set: for aClass and every subclass, an
	 Association class -> sorted selectors of the instance methods that access
	 the named instance variable. Classes with no accessing method are omitted.
	 Read-only; computes nothing on the persistent store."
	| sym result classesToScan |
	sym := anInstVarName asSymbol.
	result := OrderedCollection new.
	classesToScan := OrderedCollection new.
	classesToScan add: aClass.
	classesToScan addAll: aClass allSubclasses.
	classesToScan do: [:cls | | sels |
		sels := self instanceMethodsAccessing: sym inClass: cls.
		sels isEmpty ifFalse: [result add: cls -> sels]].
	^result
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> classNamed: aName [
	"The first class bound to aName across all dictionaries (symbol-list order),
	 or nil. Mirrors objectNamed: shadowing so it agrees with the running image."
	| sym |
	sym := aName asSymbol.
	self dictionariesDo: [:dict |
		(dict at: sym ifAbsent: [nil]) ifNotNil: [:v |
			(v isKindOf: Class) ifTrue: [^v]]].
	^nil
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> dictionariesDefiningClassNamed: aName [
	"Every dictionary in which aName is bound to a class. More than one means the
	 name is shadowed; the result documents the all-dictionaries coverage a
	 rename must reckon with."
	| sym result |
	sym := aName asSymbol.
	result := OrderedCollection new.
	self dictionariesDo: [:dict |
		(dict at: sym ifAbsent: [nil]) ifNotNil: [:v |
			(v isKindOf: Class) ifTrue: [result add: dict]]].
	^result
]

{ #category : 'enumerating' }
GsRefactoringEnvironment >> dictionariesDo: aBlock [
	"Evaluate aBlock with each SymbolDictionary on the symbol list, in order."
	symbolList do: aBlock
]

{ #category : 'instance variables' }
GsRefactoringEnvironment >> instanceMethodsAccessing: anInstVarName inClass: aClass [
	"Selectors of aClass's OWN instance methods (environment 0) that read or write
	 the named instance variable, sorted. Uses bytecode-level reflection
	 (GsNMethod>>instVarsAccessed), so it needs no source parse and finds
	 accesses the source text alone could miss. The name is normalised to a
	 Symbol so a String or Symbol argument both work (and compare correctly on a
	 Unicode-comparison stone)."
	| sym result |
	sym := anInstVarName asSymbol.
	result := OrderedCollection new.
	aClass selectors do: [:sel | | m |
		m := aClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
		(m notNil and: [m instVarsAccessed includes: sym])
			ifTrue: [result add: sel]].
	^result asSortedCollection asArray
]

{ #category : 'private' }
GsRefactoringEnvironment >> setSymbolList: aSymbolList [
	symbolList := aSymbolList
]

{ #category : 'accessing' }
GsRefactoringEnvironment >> symbolList [
	^symbolList
]

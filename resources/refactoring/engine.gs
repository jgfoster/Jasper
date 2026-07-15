! Class declarations

doit
| cls |
cls := Object subclass: 'GsRefactoringChange'
  instVarNames: #('id' 'kind' 'dictName' 'className' 'isMeta' 'selector' 'category' 'oldSource' 'newSource')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
One individually-addressable change in a GsRefactoringChangeSet: a method to
recompile, or a class definition to edit. A change carries the old and new
source so a client can render a before/after diff, and an id so a client can
select which changes to apply. Building a change compiles and commits nothing.
'.
true.
%

removeallmethods GsRefactoringChange
removeallclassmethods GsRefactoringChange

doit
| cls |
cls := Object subclass: 'GsRefactoringChangeSet'
  instVarNames: #('changes' 'nextId')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
A non-committing set of individually-addressable changes that a refactoring
computes and a client previews before applying. Staging a change records it
only: the change set NEVER compiles a method or commits the transaction. The
client fetches jsonString for a per-change before/after preview, lets the user
select which changes to keep, and the client recompiles only the selected
ones (still without committing -- the user commits explicitly).
'.
true.
%

removeallmethods GsRefactoringChangeSet
removeallclassmethods GsRefactoringChangeSet

doit
| cls |
cls := Object subclass: 'GsRefactoringEnvironment'
  instVarNames: #('symbolList')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
A read-only wrapper over the whole symbol list -- ALL dictionaries, not just
UserGlobals -- that answers the structural questions a refactoring asks before
it changes anything: which classes exist and where, and which methods read or
write a given instance variable across a class hierarchy.

Instance-variable access is found with bytecode-level reflection
(GsNMethod>>instVarsAccessed), so it needs no source parse and finds accesses
the source text alone might miss. Every query here is read-only: nothing in
this class compiles a method or commits the transaction.
'.
true.
%

removeallmethods GsRefactoringEnvironment
removeallclassmethods GsRefactoringEnvironment

doit
| cls |
cls := Object subclass: 'GsRenameInstanceVariableRefactoring'
  instVarNames: #('environment' 'definingClass' 'oldName' 'newName' 'oldNameSym' 'changeSet')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Rename an instance variable across a class and all of its subclasses, over ALL
symbol-list dictionaries, without committing. This is the first refactoring the
engine ships.

It combines the environment and change-set with the vendored AST substrate:

  - GsRefactoringEnvironment finds the affected methods reflectively
    (GsNMethod>>instVarsAccessed), so the candidate set is exactly the methods
    that really read or write the variable -- a method whose own temp or
    argument shadows the variable is never a candidate, because at the bytecode
    level it does not access the instance variable at all.

  - RBParser parses each affected method and a scope-aware walk renames only the
    RBVariableNode occurrences that resolve to the instance variable, leaving a
    same-named block argument or temporary alone (the mixed case: a method that
    both accesses the ivar AND has a block temp of the same name). The rewriter''s
    own #replace:with: is deliberately NOT used here -- it is scope-blind and
    would rename a shadowing argument''s references while leaving its declaration,
    producing broken source.

  - The class definition itself is edited to carry the new instVarNames list.

Everything is staged into a GsRefactoringChangeSet: nothing here compiles a
method or commits the transaction. The client previews the change set (per-change
before/after), the user selects which changes to keep, and the client recompiles
only those -- still without committing.
'.
true.
%

removeallmethods GsRenameInstanceVariableRefactoring
removeallclassmethods GsRenameInstanceVariableRefactoring

! Class implementations

category: 'accessing'
method: GsRefactoringChange
className
	^className
%

category: 'accessing'
method: GsRefactoringChange
dictName
	^dictName
%

category: 'serializing'
method: GsRefactoringChange
hex2: anInteger
	"Two lowercase hex digits for a 0..255 code point."
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'accessing'
method: GsRefactoringChange
id
	^id
%

category: 'accessing'
method: GsRefactoringChange
category
	^category
%

category: 'accessing'
method: GsRefactoringChange
isMeta
	^isMeta
%

category: 'serializing'
method: GsRefactoringChange
jsonEscape: aString on: aStream
	"Escape aString per JSON string rules. Iterates characters so it is safe on
	 both byte Strings and Unicode strings (the 3.6.2 Unicode-literal trap)."
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [aStream nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [aStream nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [aStream nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [aStream nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [aStream nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [aStream nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
			ifFalse: [aStream nextPut: ch]]]]]]]
%

category: 'serializing'
method: GsRefactoringChange
jsonOn: aStream
	aStream nextPutAll: '{"id":'.
	self jsonValue: id on: aStream.
	aStream nextPutAll: ',"kind":'.
	self jsonValue: kind on: aStream.
	aStream nextPutAll: ',"dictName":'.
	self jsonValue: dictName on: aStream.
	aStream nextPutAll: ',"className":'.
	self jsonValue: className on: aStream.
	aStream nextPutAll: ',"isMeta":'.
	aStream nextPutAll: (isMeta == true ifTrue: ['true'] ifFalse: ['false']).
	aStream nextPutAll: ',"selector":'.
	self jsonValue: selector on: aStream.
	aStream nextPutAll: ',"category":'.
	self jsonValue: category on: aStream.
	aStream nextPutAll: ',"oldSource":'.
	self jsonValue: oldSource on: aStream.
	aStream nextPutAll: ',"newSource":'.
	self jsonValue: newSource on: aStream.
	aStream nextPut: $}
%

category: 'serializing'
method: GsRefactoringChange
jsonValue: aValue on: aStream
	"Emit aValue as a JSON string (or null). Symbols/Strings both render as
	 their characters; nil renders as the JSON null literal."
	aValue isNil ifTrue: [^aStream nextPutAll: 'null'].
	aStream nextPut: $".
	self jsonEscape: aValue asString on: aStream.
	aStream nextPut: $"
%

category: 'accessing'
method: GsRefactoringChange
kind
	^kind
%

category: 'accessing'
method: GsRefactoringChange
newSource
	^newSource
%

category: 'accessing'
method: GsRefactoringChange
oldSource
	^oldSource
%

category: 'accessing'
method: GsRefactoringChange
selector
	^selector
%

category: 'private'
method: GsRefactoringChange
setId: anId kind: aKind dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
	id := anId.
	kind := aKind.
	dictName := dn.
	className := cn.
	isMeta := aBool.
	selector := sel.
	category := cat.
	oldSource := os.
	newSource := ns
%

category: 'instance creation'
classmethod: GsRefactoringChange
classDefinitionEditId: anId dictName: dn className: cn oldSource: os newSource: ns
	^self new
		setId: anId kind: #classDefinitionEdit dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns
%

category: 'instance creation'
classmethod: GsRefactoringChange
methodRecompileId: anId dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
	^self new
		setId: anId kind: #methodRecompile dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
%

category: 'building'
method: GsRefactoringChangeSet
addClassDefinitionEditInDictionary: dn className: cn oldSource: os newSource: ns
	"Stage a class-definition edit. Records the change only; NEVER compiles or
	 commits. Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classDefinitionEditId: self nextIdString dictName: dn className: cn
		oldSource: os newSource: ns.
	changes add: change.
	^change
%

category: 'building'
method: GsRefactoringChangeSet
addMethodRecompileInDictionary: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
	"Stage a method recompile. Records the change only; NEVER compiles or
	 commits. The category travels with the change so a client can address the
	 method (e.g. build its editor URI) and recompile it under its own category.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodRecompileId: self nextIdString dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: ns.
	changes add: change.
	^change
%

category: 'accessing'
method: GsRefactoringChangeSet
changeWithId: anId
	^changes detect: [:c | c id = anId] ifNone: [nil]
%

category: 'accessing'
method: GsRefactoringChangeSet
changes
	^changes
%

category: 'initialization'
method: GsRefactoringChangeSet
initialize
	changes := OrderedCollection new.
	nextId := 1
%

category: 'testing'
method: GsRefactoringChangeSet
isEmpty
	^changes isEmpty
%

category: 'serializing'
method: GsRefactoringChangeSet
jsonOn: aStream
	aStream nextPut: $[.
	changes keysAndValuesDo: [:i :change |
		i = 1 ifFalse: [aStream nextPut: $,].
		change jsonOn: aStream].
	aStream nextPut: $]
%

category: 'serializing'
method: GsRefactoringChangeSet
jsonString
	| ws |
	ws := WriteStream on: String new.
	self jsonOn: ws.
	^ws contents
%

category: 'private'
method: GsRefactoringChangeSet
nextIdString
	| s |
	s := nextId printString.
	nextId := nextId + 1.
	^s
%

category: 'accessing'
method: GsRefactoringChangeSet
selectedChanges: aCollectionOfIds
	"The subset of changes whose ids are in aCollectionOfIds, preserving order.
	 Backs the client's per-change selective apply."
	| ids |
	ids := aCollectionOfIds asArray.
	^changes select: [:c | ids includes: c id]
%

category: 'accessing'
method: GsRefactoringChangeSet
size
	^changes size
%

category: 'instance creation'
classmethod: GsRefactoringChangeSet
new
	^self basicNew initialize
%

category: 'enumerating'
method: GsRefactoringEnvironment
allClasses
	"Every class reachable in any dictionary of the symbol list, de-duplicated by
	 identity. Walks ALL dictionaries, not just UserGlobals."
	| set |
	set := IdentitySet new.
	self dictionariesDo: [:dict |
		dict do: [:value | (value isKindOf: Class) ifTrue: [set add: value]]].
	^set
%

category: 'instance variables'
method: GsRefactoringEnvironment
classesAndSelectorsAccessing: anInstVarName inHierarchyOf: aClass
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
%

category: 'accessing'
method: GsRefactoringEnvironment
classNamed: aName
	"The first class bound to aName across all dictionaries (symbol-list order),
	 or nil. Mirrors objectNamed: shadowing so it agrees with the running image."
	| sym |
	sym := aName asSymbol.
	self dictionariesDo: [:dict |
		(dict at: sym ifAbsent: [nil]) ifNotNil: [:v |
			(v isKindOf: Class) ifTrue: [^v]]].
	^nil
%

category: 'accessing'
method: GsRefactoringEnvironment
dictionariesDefiningClassNamed: aName
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
%

category: 'enumerating'
method: GsRefactoringEnvironment
dictionariesDo: aBlock
	"Evaluate aBlock with each SymbolDictionary on the symbol list, in order."
	symbolList do: aBlock
%

category: 'instance variables'
method: GsRefactoringEnvironment
instanceMethodsAccessing: anInstVarName inClass: aClass
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
%

category: 'private'
method: GsRefactoringEnvironment
setSymbolList: aSymbolList
	symbolList := aSymbolList
%

category: 'accessing'
method: GsRefactoringEnvironment
symbolList
	^symbolList
%

category: 'instance creation'
classmethod: GsRefactoringEnvironment
new
	"An environment over the current session's whole symbol list (all
	 dictionaries), which is the rename scope this engine operates in."
	^self onSymbolList: System myUserProfile symbolList
%

category: 'instance creation'
classmethod: GsRefactoringEnvironment
onSymbolList: aSymbolList
	^self basicNew setSymbolList: aSymbolList
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
changeSet
	"The staged, non-committing change set for this rename, computed once and
	 cached. Building it compiles nothing and commits nothing."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
%

category: 'building'
method: GsRenameInstanceVariableRefactoring
buildChangeSet
	| cs |
	cs := GsRefactoringChangeSet new.
	self stageMethodRecompilesInto: cs.
	self stageClassDefinitionEditInto: cs.
	^cs
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
definingClass
	^definingClass
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
dictNameForClass: aClass
	"The name of the first dictionary that defines aClass, as a String, or nil.
	 Informational for the client preview; the method lives on the class object
	 regardless of how many dictionaries name it."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
environment
	^environment
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
node: aNode declaresName: aSymbol
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol?
	 A method or block declares its arguments; a sequence declares its
	 temporaries. Such a binding shadows the instance variable for that scope."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
newName
	^newName
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
oldName
	^oldName
%

category: 'accessing'
method: GsRenameInstanceVariableRefactoring
previewJsonString
	"The change-set preview the client fetches over GCI: a JSON array of staged
	 changes with per-change before/after source."
	^self changeSet jsonString
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
renameInSource: aString
	"Parse aString, rename the non-shadowed references to the instance variable,
	 and return the regenerated source -- or nil if nothing was renamed (so the
	 caller stages no spurious change from mere reformatting)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self renameNodesIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree formattedCode
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
renameInstVarInDefinition: defString
	"Return defString with the old instance-variable name replaced by the new one
	 inside the instVarNames: #( ... ) clause only. Tokenises the clause on
	 whitespace and rebuilds it, so a class variable or the class name sharing the
	 old spelling is untouched. Returns defString unchanged if no clause is found."
	| start openParen closeParen listStr names separators ws |
	start := defString indexOfSubCollection: 'instVarNames:'.
	start = 0 ifTrue: [^defString].
	openParen := defString indexOf: $( startingAt: start.
	openParen = 0 ifTrue: [^defString].
	closeParen := defString indexOf: $) startingAt: openParen.
	closeParen = 0 ifTrue: [^defString].
	listStr := defString copyFrom: openParen + 1 to: closeParen - 1.
	separators := String with: $  with: Character tab with: Character lf with: Character cr.
	names := (listStr subStrings: separators) reject: [:n | n isEmpty].
	ws := WriteStream on: String new.
	ws nextPutAll: (defString copyFrom: 1 to: openParen).
	names do: [:n |
		ws nextPut: $ ;
		   nextPutAll: (n asSymbol == oldNameSym ifTrue: [newName] ifFalse: [n])].
	ws nextPutAll: (defString copyFrom: closeParen to: defString size).
	^ws contents
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
renameNodesIn: aNode shadowed: shadowed
	"Recursively rename the instance-variable references at and under aNode,
	 returning how many nodes were renamed. shadowed is true when a same-named
	 argument or temporary in an enclosing scope has captured the name, in which
	 case no node here refers to the instance variable. A variable node is
	 renamed in place by setting its token value, which is what formattedCode
	 prints. Declaration nodes (arguments, temporaries) are visited as children
	 with shadowed already true for their own name, so they are never renamed."
	| count childShadowed |
	aNode isVariable ifTrue: [
		(shadowed not and: [aNode name asSymbol == oldNameSym])
			ifTrue: [aNode token value: newName. ^1].
		^0].
	count := 0.
	childShadowed := shadowed or: [self node: aNode declaresName: oldNameSym].
	aNode children do: [:child |
		count := count + (self renameNodesIn: child shadowed: childShadowed)].
	^count
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
setEnvironment: anEnvironment class: aClass oldName: oldNameString newName: newNameString
	environment := anEnvironment.
	definingClass := aClass.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldNameString asSymbol
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
stageClassDefinitionEditInto: aChangeSet
	"Stage the edit to the defining class's own definition: the instVarNames list
	 with the variable renamed. No compile, no commit."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameInstVarInDefinition: oldDef.
	newDef = oldDef ifTrue: [^self].
	aChangeSet
		addClassDefinitionEditInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		oldSource: oldDef
		newSource: newDef
%

category: 'private'
method: GsRenameInstanceVariableRefactoring
stageMethodRecompilesInto: aChangeSet
	"Stage a recompile for every instance method (defining class and subclasses)
	 that accesses the instance variable and whose non-shadowed references change."
	| affected |
	affected := environment
		classesAndSelectorsAccessing: oldName
		inHierarchyOf: definingClass.
	affected do: [:assoc | | cls dn |
		cls := assoc key.
		dn := self dictNameForClass: cls.
		assoc value do: [:sel | | m oldSrc newSrc cat |
			m := cls compiledMethodAt: sel environmentId: 0 otherwise: nil.
			m ifNotNil: [
				oldSrc := m sourceString.
				newSrc := self renameInSource: oldSrc.
				newSrc ifNotNil: [
					cat := ((cls categoryOfSelector: sel environmentId: 0)
						ifNil: ['as yet unclassified']) asString.
					aChangeSet
						addMethodRecompileInDictionary: dn
						className: cls name
						isMeta: false
						selector: sel
						category: cat
						oldSource: oldSrc
						newSource: newSrc]]]]
%

category: 'instance creation'
classmethod: GsRenameInstanceVariableRefactoring
class: aClass renameInstVar: oldNameString to: newNameString
	"Rename in the scope of the whole current symbol list (all dictionaries)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: oldNameString
		newName: newNameString
%

category: 'instance creation'
classmethod: GsRenameInstanceVariableRefactoring
environment: anEnvironment class: aClass oldName: oldNameString newName: newNameString
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: oldNameString
		newName: newNameString
%

! Extension methods

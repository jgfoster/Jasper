! Class declarations

doit
| cls |
cls := Object subclass: 'GsRefactoringChange'
  instVarNames: #('id' 'kind' 'dictName' 'className' 'isMeta' 'selector' 'newSelector' 'category' 'oldSource' 'newSource')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
One individually-addressable change in a GsRefactoringChangeSet: a method to
recompile, a method to rename (compile under a new selector, then remove the
old), or a class definition to edit. A change carries the old and new source so
a client can render a before/after diff, and an id so a client can select which
changes to apply. Building a change compiles and commits nothing.

A #methodRename change carries both the old selector (in `selector`) and the new
selector (in `newSelector`); every other kind leaves `newSelector` nil.
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

doit
| cls |
cls := Object subclass: 'GsRenameMethodRefactoring'
  instVarNames: #('environment' 'definingClass' 'oldSelector' 'newSelector' 'newParts' 'permutation' 'scopeKind' 'scopeDictName' 'changeSet' 'outOfScopeImplementorCount' 'outOfScopeSenderCount' 'skippedCount' 'skippedMethods' 'scopeClasses')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Rename a method / selector -- unary, binary, or keyword -- across its
implementors and senders, within a chosen scope, without committing. This is the
second refactoring the engine ships (after rename-instance-variable).

It is arity-preserving: the new selector must take the same number of arguments
as the old one. Within that, it covers the three keyword operations the UX cares
about -- renaming the whole selector, renaming part of a keyword, and reordering
arguments -- all expressed as (newParts, permutation):

  - newParts is the new keyword parts, in new order, e.g. #(''copyTo:'' ''from:'')
    for a two-keyword selector, #(''after'') for a unary, #(''+'') for a binary.
  - permutation maps a NEW argument position to the OLD argument index it draws
    from: permutation at: newIndex = oldArgIndex (the same convention Pharo''s
    RBChangeMethodNameRefactoring uses). Identity #(1 2 ...) means no reorder;
    #() for a zero-argument selector.

The rewrite preserves comments, string literals, and surrounding formatting: it
mutates the AST and registers RBStringReplacements so RBMethodNode>>newSource
splices the change into the original source (see R2-RenameMethod-Design.md). A
selector spelling inside a comment or string literal is never a message-send
node, so it is left untouched; symbol literals (#sel) and perform: sends are NOT
rewritten (they carry the selector as data, not as a send).

Scope governs which implementors and senders are affected -- #class, #hierarchy,
#dictionary (a named SymbolDictionary), or #wholeSystem. Whatever the scope,
implementors/senders that fall OUTSIDE it are counted (outOfScope*Count) so a
client can warn that they will not be changed.

Everything is staged into a GsRefactoringChangeSet: nothing here compiles a
method or commits the transaction. Implementors are staged as #methodRename
(compile under the new selector, then remove the old); senders are staged as
#methodRecompile (their own selector is unchanged -- only a send expression in
the body changes).
'.
true.
%

removeallmethods GsRenameMethodRefactoring
removeallclassmethods GsRenameMethodRefactoring

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
	"Escape aString per JSON string rules, emitting PURE ASCII: control characters
	 and any code point above 126 become \uXXXX escapes. This keeps the whole
	 payload a byte String, so the client's non-blocking GCI fetch (which reads
	 characters, not raw bytes) never trips over a Unicode-promoted result. A code
	 point above the BMP (rare in source) is emitted as '?' -- the JSON is
	 preview-only (apply uses the server-side source), so this is display-safe."
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [aStream nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [aStream nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [aStream nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [aStream nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [aStream nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [aStream nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
		ifFalse: [code > 126
			ifTrue: [code > 65535
				ifTrue: [aStream nextPut: $?]
				ifFalse: [aStream nextPutAll: '\u';
					nextPutAll: (self hex2: code // 256);
					nextPutAll: (self hex2: code \\ 256)]]
			ifFalse: [aStream nextPut: ch]]]]]]]]
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
	aStream nextPutAll: ',"newSelector":'.
	self jsonValue: newSelector on: aStream.
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
newSelector
	"The new selector for a #methodRename change; nil for every other kind."
	^newSelector
%

category: 'accessing'
method: GsRefactoringChange
selector
	^selector
%

category: 'private'
method: GsRefactoringChange
setNewSelector: aSelector
	newSelector := aSelector
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

category: 'instance creation'
classmethod: GsRefactoringChange
methodRenameId: anId dictName: dn className: cn isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat oldSource: os newSource: ns
	"A method whose selector changes: apply = compile newSource (under newSel),
	 then remove the old-selector method. `selector` holds the old selector."
	^(self new
		setId: anId kind: #methodRename dictName: dn className: cn
		isMeta: aBool selector: oldSel category: cat oldSource: os newSource: ns)
		setNewSelector: newSel
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

category: 'building'
method: GsRefactoringChangeSet
addMethodRenameInDictionary: dn className: cn isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat oldSource: os newSource: ns
	"Stage a method rename (selector changes). Records the change only; NEVER
	 compiles or commits. The client applies it as compile-new-then-remove-old.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodRenameId: self nextIdString dictName: dn className: cn
		isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat
		oldSource: os newSource: ns.
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

category: 'selectors'
method: GsRefactoringEnvironment
implementorsOf: aSelector
	"Every method that implements aSelector anywhere in the image, as an Array of
	 GsNMethod (instance- and class-side both; each answers its own inClass). Uses
	 the same ClassOrganizer reflection the client's implementorsOf query uses, so
	 the engine and the client agree on the affected set. Read-only."
	^(ClassOrganizer new implementorsOf: aSelector asSymbol) asArray
%

category: 'selectors'
method: GsRefactoringEnvironment
sendersOf: aSelector
	"Every method that sends aSelector anywhere in the image, as an Array of
	 GsNMethod. Uses the same ClassOrganizer reflection the client's sendersOf
	 query uses. Read-only; compiles and commits nothing."
	^(ClassOrganizer new sendersOf: aSelector asSymbol) at: 1
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

category: 'building'
method: GsRenameMethodRefactoring
buildChangeSet
	"Stage a #methodRename for every in-scope implementor and a #methodRecompile
	 for every in-scope sender, counting the out-of-scope remainder. Compiles
	 nothing and commits nothing."
	| cs implementorKeys |
	cs := GsRefactoringChangeSet new.
	outOfScopeImplementorCount := 0.
	outOfScopeSenderCount := 0.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	implementorKeys := IdentitySet new.
	(environment implementorsOf: oldSelector) do: [:m |
		"Isolate each method: one that cannot be parsed/rewritten (a source the
		 vendored AST does not accept, a primitive edge case) is skipped and
		 counted, never aborting the whole preview."
		[| base isMeta |
		 base := self baseClassOf: m.
		 isMeta := m inClass isMeta.
		 (self isClassInScope: base)
			ifTrue: [
				implementorKeys add: (self keyForClass: base isMeta: isMeta).
				self stageImplementorRename: m base: base isMeta: isMeta into: cs]
			ifFalse: [outOfScopeImplementorCount := outOfScopeImplementorCount + 1]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]].
	(environment sendersOf: oldSelector) do: [:m |
		[| base isMeta |
		 base := self baseClassOf: m.
		 isMeta := m inClass isMeta.
		 "skip a method that IS one of the implementors we already renamed -- its
		  own internal sends of oldSelector are rewritten by the implementor pass."
		 ((m selector == oldSelector)
			and: [implementorKeys includes: (self keyForClass: base isMeta: isMeta)])
			ifFalse: [
				(self isClassInScope: base)
					ifTrue: [self stageSenderRewrite: m base: base isMeta: isMeta into: cs]
					ifFalse: [outOfScopeSenderCount := outOfScopeSenderCount + 1]]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]].
	^cs
%

category: 'private'
method: GsRenameMethodRefactoring
baseClassOf: aMethod
	"The non-meta class of aMethod's defining class (a class-side method's inClass
	 is a metaclass). GemStone's Metaclass answers its instance class via
	 #thisClass (NOT #instanceClass, which is a Pharo-ism it does not understand)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
%

category: 'private'
method: GsRenameMethodRefactoring
buildNewSelector
	| ws |
	ws := WriteStream on: String new.
	newParts do: [:p | ws nextPutAll: p].
	^ws contents asSymbol
%

category: 'accessing'
method: GsRenameMethodRefactoring
changeSet
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
%

category: 'accessing'
method: GsRenameMethodRefactoring
definingClass
	^definingClass
%

category: 'private'
method: GsRenameMethodRefactoring
dictNameForClass: aClass
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
%

category: 'accessing'
method: GsRenameMethodRefactoring
environment
	^environment
%

category: 'testing'
method: GsRenameMethodRefactoring
isClassInScope: aClass
	scopeKind == #wholeSystem ifTrue: [^true].
	scopeKind == #class ifTrue: [^aClass == definingClass].
	scopeKind == #hierarchy ifTrue: [^self hierarchyScopeClasses includes: aClass].
	scopeKind == #dictionary ifTrue: [
		"Compare as Symbols -- scopeDictName is a client-supplied literal (Unicode
		 on 3.6.x); asSymbol canonicalises both sides and avoids the comparison trap."
		| wanted |
		wanted := scopeDictName asSymbol.
		^(environment dictionariesDefiningClassNamed: aClass name)
			anySatisfy: [:d | d name asSymbol == wanted]].
	^false
%

category: 'private'
method: GsRenameMethodRefactoring
hierarchyScopeClasses
	"The set of classes in definingClass's hierarchy (itself, its subclasses, and
	 its superclasses), computed ONCE and cached. Computing allSubclasses /
	 allSuperclasses per candidate made #hierarchy scope O(hierarchy x candidates)
	 -- slower than #wholeSystem, which skips the check entirely. An IdentitySet
	 membership test is O(1)."
	scopeClasses isNil ifTrue: [
		scopeClasses := IdentitySet new.
		scopeClasses add: definingClass.
		scopeClasses addAll: definingClass allSubclasses.
		scopeClasses addAll: definingClass allSuperclasses].
	^scopeClasses
%

category: 'private'
method: GsRenameMethodRefactoring
keyForClass: aClass isMeta: aBool
	"A stable identity key for a (class, side) pair, used to dedup a method that is
	 both an implementor and a sender of oldSelector."
	^Array with: aClass name asString with: aBool
%

category: 'accessing'
method: GsRenameMethodRefactoring
newSelector
	^newSelector
%

category: 'accessing'
method: GsRenameMethodRefactoring
oldSelector
	^oldSelector
%

category: 'accessing'
method: GsRenameMethodRefactoring
outOfScopeImplementorCount
	"How many implementors of oldSelector fall outside the chosen scope and will
	 NOT be renamed. Building the change set computes this."
	self changeSet.
	^outOfScopeImplementorCount
%

category: 'accessing'
method: GsRenameMethodRefactoring
outOfScopeJsonString
	"The out-of-scope / skipped warning payload for the client preview: implementors
	 and senders outside the chosen scope, plus methods that could not be rewritten
	 (and were skipped)."
	self changeSet.
	^'{"implementors":', outOfScopeImplementorCount printString,
	  ',"senders":', outOfScopeSenderCount printString,
	  ',"skipped":', skippedCount printString, '}'
%

category: 'private'
method: GsRenameMethodRefactoring
hex2: anInteger
	"Two lowercase hex digits for a 0..255 code point."
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'private'
method: GsRenameMethodRefactoring
jsonEscape: aString
	"JSON string escaping emitting PURE ASCII (control chars and code points above
	 126 become \uXXXX), for a class name, selector, or error message. Keeps the
	 payload a byte String so the client's non-blocking GCI fetch is never handed a
	 Unicode-promoted result."
	| ws |
	ws := WriteStream on: String new.
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [ws nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [ws nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [ws nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [ws nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [ws nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [ws nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
		ifFalse: [code > 126
			ifTrue: [code > 65535
				ifTrue: [ws nextPut: $?]
				ifFalse: [ws nextPutAll: '\u';
					nextPutAll: (self hex2: code // 256);
					nextPutAll: (self hex2: code \\ 256)]]
			ifFalse: [ws nextPut: ch]]]]]]]].
	^ws contents
%

category: 'private'
method: GsRenameMethodRefactoring
jsonQuote: aString
	"aString as a quoted, escaped JSON string."
	^'"', (self jsonEscape: aString), '"'
%

category: 'accessing'
method: GsRenameMethodRefactoring
outOfScopeSenderCount
	"How many senders of oldSelector fall outside the chosen scope and will NOT be
	 rewritten. Building the change set computes this."
	self changeSet.
	^outOfScopeSenderCount
%

category: 'accessing'
method: GsRenameMethodRefactoring
skippedMethodsJsonString
	"A JSON array of the methods that could not be rewritten (and were skipped) --
	 one object per method carrying its class and selector -- so the client can
	 list them."
	| ws |
	self changeSet.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	skippedMethods keysAndValuesDo: [:i :entry |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPutAll: '{"class":"'; nextPutAll: (self jsonEscape: (entry at: 1)).
		ws nextPutAll: '","selector":"'; nextPutAll: (self jsonEscape: (entry at: 2)).
		ws nextPutAll: '"}'].
	ws nextPut: $].
	^ws contents
%

category: 'accessing'
method: GsRenameMethodRefactoring
previewJsonString
	"The change-set preview the client fetches over GCI: a JSON array of staged
	 changes with per-change before/after source."
	^self changeSet jsonString
%

category: 'paginated preview'
method: GsRenameMethodRefactoring
pageJsonFrom: startIndex maxBytes: maxBytes
	"A page of staged changes (with source) starting at startIndex (1-based),
	 accumulating until roughly maxBytes -- so a page always fits the client's GCI
	 fetch buffer no matter how large the change set is. At least one change is
	 always emitted (progress guarantee, even if a single change exceeds maxBytes).
	 Answers an object with the changes array, the next offset, and a done flag."
	| all ws i |
	all := self changeSet changes.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	i := startIndex.
	[i <= all size and: [i = startIndex or: [ws position < maxBytes]]] whileTrue: [
		i > startIndex ifTrue: [ws nextPut: $,].
		(all at: i) jsonOn: ws.
		i := i + 1].
	ws nextPut: $].
	^'{"changes":', ws contents,
	  ',"nextOffset":', i printString,
	  ',"done":', (i > all size) printString, '}'
%

category: 'paginated preview'
method: GsRenameMethodRefactoring
startPreviewToken: token maxBytes: maxBytes
	"Build the change set, stash this refactoring in SessionTemps under token (so
	 later pages and the apply reuse it without rebuilding), and answer the first
	 page plus the totals. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
%

category: 'applying'
method: GsRenameMethodRefactoring
applyChange: aChange
	"Apply one staged change in the stone WITHOUT committing: compile the new
	 source, and for a genuine rename (selector actually changed) remove the old
	 method. The class is resolved across all dictionaries."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified']).
	(aChange kind == #methodRename and: [aChange newSelector ~= aChange selector])
		ifTrue: [target removeSelector: aChange selector asSymbol]
%

category: 'applying'
method: GsRenameMethodRefactoring
applyDeselected: deselectedIds
	"Apply every staged change EXCEPT those whose id is in deselectedIds, in the
	 stone, WITHOUT committing (the user commits explicitly). Answers an object
	 with the applied count and a list of failures (id, label, error)."
	| ids applied failures |
	"Compare ids as Symbols: a deselected id arrives as a string literal, which on
	 3.6.x is a Unicode string, and comparing it to the byte-string change id would
	 raise (the 3.6.2 Unicode-comparison trap). asSymbol canonicalises both."
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	applied := 0.
	failures := OrderedCollection new.
	self changeSet changes do: [:change |
		(ids includes: change id asSymbol) ifFalse: [
			[self applyChange: change. applied := applied + 1]
			on: Error do: [:e |
				failures add: (Array with: change id with: change className with: e messageText)]]].
	^'{"applied":', applied printString, ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
%

category: 'private'
method: GsRenameMethodRefactoring
recordSkipped: aMethod
	"Record the identity of a method that could not be rewritten, so the client can
	 list which ones were skipped. inClass name carries the side ('Foo class')."
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
%

category: 'private'
method: GsRenameMethodRefactoring
rewriteSend: aMessageNode source: src
	"Rename one send of oldSelector in place, minimal-diff: mutate the node (so the
	 reparsed source matches the AST) AND register RBStringReplacements for the
	 keyword-part token spans and the (possibly reordered) argument spans."
	| parts args kwSpans argSpans argTexts newArgs |
	parts := aMessageNode selectorParts.
	args := aMessageNode arguments.
	kwSpans := parts collect: [:t | Array with: t start with: t stop].
	argSpans := args collect: [:a | Array with: a start with: a stop].
	argTexts := args collect: [:a | src copyFrom: a start to: a stop].
	newArgs := permutation collect: [:oldIdx | args at: oldIdx].
	aMessageNode renameSelector: newSelector andArguments: newArgs.
	1 to: parts size do: [:i |
		aMessageNode addReplacement: (RBStringReplacement
			replaceFrom: (kwSpans at: i) first
			to: (kwSpans at: i) last
			with: (newParts at: i))].
	1 to: args size do: [:i |
		aMessageNode addReplacement: (RBStringReplacement
			replaceFrom: (argSpans at: i) first
			to: (argSpans at: i) last
			with: (argTexts at: (permutation at: i)))]
%

category: 'private'
method: GsRenameMethodRefactoring
rewriteSendsOf: aSelector in: aTree source: src
	"Rewrite every send of aSelector at and under aTree, returning how many sends
	 were rewritten. Zero means the reference was not a real send (e.g. a symbol
	 literal), so the caller stages nothing for it."
	| count |
	count := 0.
	aTree nodesDo: [:node |
		(node isMessage and: [node selector == aSelector])
			ifTrue: [self rewriteSend: node source: src. count := count + 1]].
	^count
%

category: 'private'
method: GsRenameMethodRefactoring
setEnvironment: anEnvironment class: aClass oldSelector: oldSel newParts: partsArray permutation: permArray scopeKind: sk scopeDictName: dn
	environment := anEnvironment.
	definingClass := aClass.
	oldSelector := oldSel asSymbol.
	newParts := partsArray.
	permutation := permArray.
	scopeKind := sk.
	scopeDictName := dn.
	newSelector := self buildNewSelector
%

category: 'private'
method: GsRenameMethodRefactoring
stageImplementorRename: aMethod base: base isMeta: isMeta into: aChangeSet
	"Stage the rename of one implementor: rewrite its signature (rename keyword
	 parts + reorder argument declarations per permutation) AND any internal sends
	 of oldSelector, then stage a #methodRename. No compile, no commit."
	| oldSrc tree oldArgs newArgNodes newSrc cat |
	oldSrc := aMethod sourceString.
	tree := RBParser parseMethod: oldSrc.
	oldArgs := tree arguments.
	newArgNodes := permutation collect: [:oldIdx | oldArgs at: oldIdx].
	tree renameSelector: newSelector andArguments: newArgNodes.
	self rewriteSendsOf: oldSelector in: tree source: oldSrc.
	newSrc := tree newSource.
	cat := (aMethod inClass categoryOfSelector: oldSelector environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRenameInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		oldSelector: oldSelector
		newSelector: newSelector
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
%

category: 'private'
method: GsRenameMethodRefactoring
stageSenderRewrite: aMethod base: base isMeta: isMeta into: aChangeSet
	"Stage a recompile of one sender: rewrite its send(s) of oldSelector. The
	 sender keeps its own selector, so this is a #methodRecompile. Stages nothing
	 if no real send was rewritten (e.g. a symbol-literal-only reference)."
	| senderSel oldSrc tree renamed newSrc cat |
	senderSel := aMethod selector.
	oldSrc := aMethod sourceString.
	tree := RBParser parseMethod: oldSrc.
	renamed := self rewriteSendsOf: oldSelector in: tree source: oldSrc.
	renamed = 0 ifTrue: [^self].
	newSrc := tree newSource.
	cat := (aMethod inClass categoryOfSelector: senderSel environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRecompileInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		selector: senderSel
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
%

category: 'instance creation'
classmethod: GsRenameMethodRefactoring
class: aClass renameSelector: oldSel toParts: partsArray permutation: permArray dictionaryScope: dictName
	"Rename scoped to a single named SymbolDictionary."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: #dictionary
		scopeDictName: dictName
%

category: 'instance creation'
classmethod: GsRenameMethodRefactoring
class: aClass renameSelector: oldSel toParts: partsArray permutation: permArray scope: scopeSymbol
	"scopeSymbol is #class, #hierarchy, or #wholeSystem. For #dictionary use
	 class:renameSelector:toParts:permutation:dictionaryScope:."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: scopeSymbol
		scopeDictName: nil
%

category: 'instance creation'
classmethod: GsRenameMethodRefactoring
environment: anEnvironment class: aClass oldSelector: oldSel newParts: partsArray permutation: permArray scopeKind: sk scopeDictName: dn
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: sk
		scopeDictName: dn
%

category: 'paginated preview'
classmethod: GsRenameMethodRefactoring
pageForToken: token from: startIndex maxBytes: maxBytes
	"A page from a previously-started preview (see startPreviewToken:maxBytes:),
	 by token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
%

category: 'applying'
classmethod: GsRenameMethodRefactoring
applyForToken: token deselected: deselectedIds
	"Apply a previously-started preview (by token), skipping deselectedIds. No
	 commit. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
%

category: 'paginated preview'
classmethod: GsRenameMethodRefactoring
clearToken: token
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
%

! Extension methods

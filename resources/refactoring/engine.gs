! Class declarations

doit
| cls |
cls := Object subclass: 'GsClassHistory'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Read-only view of a class''s DEFINITION HISTORY in this stone -- built directly on
GemStone''s native classHistory, so it needs no home-grown store and records nothing
of its own. Every time a class definition changes (a shape edit, or a rename via
GsRenameClassRefactoring), GemStone appends a new Class VERSION to the class
history; each version is an independent Class object that remembers the name it had
then, when it was defined (timeStamp), who defined it (userId), its object id (oop),
its definition source, and its own methods.

  GsClassHistory forClassNamed: ''Foo''

answers a JSON array, newest version first, one object per version:

  { index, name, oop, timeStamp, userId, isCurrent, definition, changedMethods }

where changedMethods lists, per side, the selectors added / removed / modified
relative to the PREVIOUS version -- so the client can show, unobtrusively, exactly
what each definition change did without any recorded log.

  GsClassHistory revertClassNamed: ''Foo'' toIndex: 2

recompiles the chosen historical version''s shape + methods under the class''s CURRENT
name, as a NEW version (a ''redo''). classHistory is append-only, so a revert is never
destructive and can itself be reverted. Nothing here commits -- forClassNamed: is
read-only, and revert compiles in the stone but leaves the commit to the user.
'.
true.
%

removeallmethods GsClassHistory
removeallclassmethods GsClassHistory

doit
| cls |
cls := Object subclass: 'GsRefactoringChange'
  instVarNames: #('id' 'kind' 'dictName' 'className' 'isMeta' 'selector' 'newSelector' 'newName' 'category' 'oldSource' 'newSource')
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
cls := Object subclass: 'GsRenameClassRefactoring'
  instVarNames: #('environment' 'definingClass' 'oldName' 'newName' 'oldNameSym' 'scopeKind' 'scopeDictName' 'changeSet' 'outOfScopeReferenceCount' 'skippedCount' 'skippedMethods' 'scopeClasses' 'subtreeClasses' 'oldToNew' 'shapeSource' 'copyMethods' 'recompileSubclasses' 'migrateInstances' 'removeOldFromHistory')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Rename a class across the whole image, within a chosen scope, without committing.
This is the third refactoring the engine ships (after rename-instance-variable and
rename-method).

Renaming a class is more than a global rebind, because GemStone models a class
definition change as a NEW class VERSION:

  - The rename creates a new version of the class under the new name, in the SAME
    class history (Class>>_subclass:...newVersionOf:...). Old versions keep their
    old names, so the class history records the rename (see GsClassHistory), and
    the Explorer''s Foo[n] version tag bumps. The current primitive returns the old
    class unchanged when the new class would be equivalent, so a real name change
    always makes a new version.

  - A new version starts with an EMPTY method dictionary, so the apply copies the
    old version''s methods (both sides) forward, rewriting any reference to the old
    name to the new name as it copies.

  - The new name is bound by the primitive; the OLD name is removed explicitly.

  - Subclasses are NOT re-parented by newVersionOf: -- a subclass keeps pointing at
    the old parent version. So the rename re-parents the whole descendant subtree,
    top-down: each descendant is recompiled newVersionOf: its current version under
    the freshly created parent chain, and its methods are copied forward. A direct
    child''s definition also has its superclass NAME rewritten.

  - References to the old name in OTHER classes'' method bodies are rewritten
    minimal-diff (mutate the RBVariableNode AND register an RBStringReplacement,
    then newSource -- the R2 recipe) and staged as #methodRecompile. A name inside
    a comment, a string literal, or a #Symbol literal is never an RBVariableNode, so
    it is left untouched. The renamed class''s and the descendants'' OWN methods are
    rewritten during their copy-forward, not as separate #methodRecompile changes.

Scope governs which referencing methods are rewritten (#class, #hierarchy,
#dictionary, #wholeSystem -- default #wholeSystem for a class rename); references
outside the scope are counted (outOfScopeReferenceCount) so a client can warn.
Re-parenting the descendant subtree and rebinding the name are NOT scoped -- an
orphaned subclass or a dangling name would be a correctness bug -- so they always
happen. Accordingly the apply always applies the #classRename and every
#classReparent, honouring a deselection only for the optional #methodRecompile
reference rewrites.

Everything is staged into a GsRefactoringChangeSet: building it compiles nothing
and commits nothing. By default the apply compiles in the stone but does not
commit (the user commits explicitly). Four options (JadeiteForPharo issue #142)
tune it: copyMethods (copy each superseded version''s methods forward),
recompileSubclasses (re-parent the descendant subtree), migrateInstances (migrate
every old-version instance to its new version), and removeOldFromHistory (prune the
superseded versions from the class history). Because instance migration must be
durable, the apply COMMITS when migrateInstances or removeOldFromHistory is on --
that is the one path that commits, and it is opt-in.
'.
true.
%

removeallmethods GsRenameClassRefactoring
removeallclassmethods GsRenameClassRefactoring

doit
| cls |
cls := Object subclass: 'GsRenameClassVariableRefactoring'
  instVarNames: #('environment' 'definingClass' 'oldName' 'newName' 'oldNameSym' 'newNameSym' 'changeSet' 'skippedCount' 'skippedMethods')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Rename a class variable across its defining class and all subclasses -- both the
instance side and the class side -- without committing. This is the fourth
refactoring the engine ships (after rename-instance-variable, rename-method, and
rename-class).

A class variable differs from an instance variable in three ways that shape this
refactoring:

  - It is referenced from BOTH instance-side and class-side methods, in the
    defining class AND every subclass (both sides), because a class variable is
    shared across the whole hierarchy. So the affected-method scan walks the
    defining class + allSubclasses, each on both sides.

  - Reference detection is bytecode-precise via the variable''s ASSOCIATION: a
    method references the class variable iff its literal frame holds the exact
    SymbolAssociation that `definingClass _classVars associationAt: name` answers
    (GsRefactoringEnvironment>>methodsAccessingClassVar:inHierarchyOf:). This is
    the class-variable analog of rename-instVar''s instVarsAccessed reflection --
    it distinguishes the class variable from a same-named GLOBAL (a different
    association) and from a shadowing temporary/argument (no association literal),
    so neither is renamed.

  - A class variable is a single shared BINDING with a VALUE. Renaming it by a
    naive class-definition recompile would DROP that value (the old name''s
    association is discarded and the new name starts nil). So the apply renames it
    reflectively -- addClassVarName: the new name, carry the old association''s
    VALUE across, recompile the referencing methods, then removeClassVarName: the
    old name -- which preserves the value AND, because a class-variable change does
    not alter instance format, creates NO new class version (the Explorer''s Foo[n]
    tag is unchanged).

Scope is the whole hierarchy (defining class + subclasses, both sides) and only
that: a same-named name anywhere else is a different binding, so there is nothing
outside the hierarchy to rename -- hence no #class/#dictionary/#wholeSystem scope
model. The rename is all-or-nothing: the #classDefinitionEdit is always applied and
the reference recompiles are not deselectable in the client, because a method left
naming the removed variable would silently read a disconnected value.

Everything is staged into a GsRefactoringChangeSet: building it compiles nothing
and commits nothing. The apply compiles in the stone but never commits (the user
commits explicitly).
'.
true.
%

removeallmethods GsRenameClassVariableRefactoring
removeallclassmethods GsRenameClassVariableRefactoring

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

doit
| cls |
cls := Object subclass: 'GsRenameTemporaryRefactoring'
  instVarNames: #('environment' 'definingClass' 'selector' 'isMeta' 'oldName' 'newName' 'oldNameSym' 'newNameSym' 'offset' 'changeSet' 'resolved' 'resolvedScope')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: GsRefactoring.
cls category: 'Refactoring-Core'.
cls comment: '
Rename a method TEMPORARY or ARGUMENT (R5) -- the lightest refactoring the engine
ships. A temporary or argument is method-local: every reference lives in one
method''s source, so this refactoring touches exactly ONE method, stages a single
#methodRecompile, and needs no class-definition edit and no cross-method scan.

The refactoring is addressed by class + selector + isMeta + old name + new name +
a 1-based source OFFSET into the method identifying the occurrence the user
clicked. The offset disambiguates a name declared in more than one scope of the
same method (e.g. two blocks each with a :each). Binding resolution is by AST
scope, symbol-identity throughout (never a raw String compare, so a Unicode
string on a 3.6.x stone never trips error 2718):

  - RBParser parses the method source; `tree bestNodeFor: (offset to: offset)`
    finds the variable node under the cursor;
  - walking that node''s `parent` chain to the nearest enclosing scope (method /
    block arguments, or a sequence''s temporaries) that DECLARES the name yields
    the target binding''s declaring scope -- or nil, meaning the name is not a
    local at that position (an instance variable, a global, self, a message
    selector), and the rename is DECLINED (that is R1/R4''s job, not R5''s);
  - every RBVariableNode of the same name whose own declaring scope is that same
    node is renamed; an inner block that redeclares the name shadows it, so its
    occurrences resolve to the inner scope and are left alone (both directions:
    renaming the outer binding never touches the inner, and vice versa).

The new name is refused (previewed, never applied) when it would COLLIDE: with
any other argument or temporary anywhere in the method (an argument must not
collide with a temporary or vice versa), with an own or INHERITED instance
variable, with an own or inherited class variable, or with a pseudo-variable.

Building the change set compiles nothing and commits nothing. The server-side
apply recompiles the one method in the stone but never commits (the user commits
explicitly). The rename is all-or-nothing: there is a single change, so a passed
deselection is inert (accepted only for signature parity with the other
refactorings'' applyForToken:deselected: entry point).
'.
true.
%

removeallmethods GsRenameTemporaryRefactoring
removeallclassmethods GsRenameTemporaryRefactoring

! Class implementations

category: 'accessing'
classmethod: GsClassHistory
forClassNamed: aName
	"A JSON array of the class's definition versions, newest first, or an error
	 envelope if the name is unbound. Read-only."
	| cls hist ws n |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	n := hist size.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	n to: 1 by: -1 do: [:i |
		i < n ifTrue: [ws nextPut: $,].
		self version: (hist at: i) index: i of: cls previous: (i > 1 ifTrue: [hist at: i - 1] ifFalse: [nil]) on: ws].
	ws nextPut: $].
	^ws contents
%

category: 'serializing'
classmethod: GsClassHistory
version: aVersion index: i of: currentClass previous: prevVersion on: ws
	ws nextPutAll: '{"index":'; nextPutAll: i printString.
	ws nextPutAll: ',"name":'; nextPutAll: (self jsonQuote: aVersion name asString).
	ws nextPutAll: ',"oop":'; nextPutAll: ([aVersion asOop] on: Error do: [:e | 0]) printString.
	ws nextPutAll: ',"timeStamp":'; nextPutAll: (self jsonQuote:
		(self formatTimeStamp: ([aVersion timeStamp] on: Error do: [:e | nil]))).
	ws nextPutAll: ',"userId":'; nextPutAll: (self jsonQuote:
		([aVersion userId asString] on: Error do: [:e | ''])).
	ws nextPutAll: ',"isCurrent":'; nextPutAll: (aVersion == currentClass ifTrue: ['true'] ifFalse: ['false']).
	ws nextPutAll: ',"definition":'; nextPutAll: (self jsonQuote:
		([aVersion definition] on: Error do: [:e | ''])).
	ws nextPutAll: ',"changedMethods":'.
	self changedMethodsBetween: prevVersion and: aVersion on: ws.
	ws nextPut: $}
%

category: 'serializing'
classmethod: GsClassHistory
changedMethodsBetween: prevVersion and: aVersion on: ws
	"Emit the JSON array of {side,selector,change} describing what changed between the
	 previous version and aVersion, per side. If prevVersion is nil (the baseline), all
	 of aVersion's selectors are 'added'. change is 'added' | 'removed' | 'modified'."
	| first |
	ws nextPut: $[.
	first := true.
	#(#(false 'instance') #(true 'class')) do: [:pair | | isMeta side prevCls curCls |
		isMeta := pair at: 1.
		side := pair at: 2.
		curCls := isMeta ifTrue: [aVersion class] ifFalse: [aVersion].
		prevCls := prevVersion isNil ifTrue: [nil] ifFalse: [isMeta ifTrue: [prevVersion class] ifFalse: [prevVersion]].
		(self diffSide: side prev: prevCls cur: curCls) do: [:entry |
			first ifFalse: [ws nextPut: $,].
			first := false.
			ws nextPutAll: '{"side":"'; nextPutAll: side.
			ws nextPutAll: '","selector":'; nextPutAll: (self jsonQuote: (entry at: 1) asString).
			ws nextPutAll: ',"change":"'; nextPutAll: (entry at: 2); nextPutAll: '"}']].
	ws nextPut: $]
%

category: 'serializing'
classmethod: GsClassHistory
diffSide: side prev: prevCls cur: curCls
	"An OrderedCollection of Array(selector, changeString) for one side, comparing the
	 method dictionaries of prevCls and curCls (either may be nil)."
	| result |
	result := OrderedCollection new.
	(curCls isNil ifTrue: [#()] ifFalse: [curCls selectors asSortedCollection]) do: [:sel |
		(prevCls isNil or: [(prevCls includesSelector: sel) not])
			ifTrue: [result add: (Array with: sel with: 'added')]
			ifFalse: [
				(self source: sel in: prevCls) = (self source: sel in: curCls)
					ifFalse: [result add: (Array with: sel with: 'modified')]]].
	prevCls isNil ifFalse: [
		prevCls selectors asSortedCollection do: [:sel |
			(curCls isNil or: [(curCls includesSelector: sel) not])
				ifTrue: [result add: (Array with: sel with: 'removed')]]].
	^result
%

category: 'serializing'
classmethod: GsClassHistory
source: sel in: aClass
	| m |
	aClass isNil ifTrue: [^''].
	m := aClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [''] ifFalse: [m sourceString]
%

category: 'redo'
classmethod: GsClassHistory
revertClassNamed: aName toIndex: anInt
	"Restore a class to the definition (name, shape, AND methods) of the version at
	 index anInt, as a NEW version -- a redo. This is the same operation as a rename to
	 that version's name: it re-parents every subclass onto the restored version and,
	 when the historical name differs from the current one, rewrites references back to
	 it across the image. Nothing is committed (the user commits). Answers a JSON result
	 {reverted, index, newIndex, name, failed} or an error envelope. `name` is the
	 restored class's (possibly changed) name so the client can re-key its view."
	| cls hist target ref restored applied |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"reverted":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	(anInt < 1 or: [anInt > hist size])
		ifTrue: [^'{"reverted":false,"error":"index out of range"}'].
	target := hist at: anInt.
	target == cls
		ifTrue: [^'{"reverted":false,"error":"that version is already current"}'].
	ref := (self resolve: #GsRenameClassRefactoring) restoreClass: cls toVersion: target.
	applied := ref applyDeselected: #().
	restored := System myUserProfile symbolList objectNamed: target name asSymbol.
	^'{"reverted":true,"index":', anInt printString,
	  ',"name":', (self jsonQuote: target name asString),
	  ',"newIndex":', (restored isNil ifTrue: ['0'] ifFalse: [(restored classHistory indexOf: restored) printString]),
	  ',"apply":', applied, '}'
%

category: 'redo'
classmethod: GsClassHistory
removeVersionOf: aName index: anInt
	"Remove the version at index anInt from the named class's class history
	 (ClassHistory>>removeVersion:), so it no longer appears in the history. The
	 currently-bound version cannot be removed. Does NOT commit -- the user commits.
	 Answers {removed, index, remaining} or an error envelope. Note: removing a version
	 that still has (un-migrated) instances leaves those instances referring to a
	 version no longer in the history; the client warns before calling."
	| cls hist target |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"removed":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	(anInt < 1 or: [anInt > hist size])
		ifTrue: [^'{"removed":false,"error":"index out of range"}'].
	target := hist at: anInt.
	target == cls
		ifTrue: [^'{"removed":false,"error":"cannot remove the current version"}'].
	hist removeVersion: target.
	^'{"removed":true,"index":', anInt printString, ',"remaining":', hist size printString, '}'
%

category: 'private'
classmethod: GsClassHistory
resolve: aSymbol
	"Resolve an engine class by name through the symbol list (it is loaded alongside
	 this class in the GsRefactoring dictionary)."
	^System myUserProfile symbolList objectNamed: aSymbol
%

category: 'serializing'
classmethod: GsClassHistory
formatTimeStamp: aDateTime
	"Emit the class-version DateTime as a locale-NEUTRAL ISO-8601 string
	 (yyyy-mm-ddTHH:MM:SS), so the client can render it in the user's own locale
	 (a US user sees mm/dd/yyyy, etc.). Falls back to printString (then '') on any
	 error, so a format surprise never breaks the read-only history view."
	aDateTime isNil ifTrue: [^''].
	^[ aDateTime year printString, '-', (self pad2: aDateTime month), '-',
	   (self pad2: aDateTime dayOfMonth), 'T',
	   (self pad2: aDateTime hour), ':', (self pad2: aDateTime minute), ':',
	   (self pad2: aDateTime second truncated) ]
		on: Error
		do: [:e | [aDateTime printString] on: Error do: [:e2 | '']]
%

category: 'serializing'
classmethod: GsClassHistory
pad2: anInteger
	"anInteger as a two-digit, zero-padded decimal string (e.g. 7 -> '07')."
	^(anInteger < 10 ifTrue: ['0'] ifFalse: ['']), anInteger printString
%

category: 'serializing'
classmethod: GsClassHistory
hex2: anInteger
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'serializing'
classmethod: GsClassHistory
jsonEscape: aString
	"JSON string escaping emitting PURE ASCII (control chars + code points above 126
	 become \\uXXXX), so a client's non-blocking GCI fetch is never handed a
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

category: 'serializing'
classmethod: GsClassHistory
jsonQuote: aString
	^'"', (self jsonEscape: aString), '"'
%

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
	aStream nextPutAll: ',"newName":'.
	self jsonValue: newName on: aStream.
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
newName
	"The new class name for a #classRename change; nil for every other kind."
	^newName
%

category: 'private'
method: GsRefactoringChange
setNewName: aString
	newName := aString
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

category: 'instance creation'
classmethod: GsRefactoringChange
classRenameId: anId dictName: dn className: cn newName: nn oldSource: os newSource: ns
	"The target class of a rename: `className` holds the OLD name, `newName` the new.
	 Apply (server-side) creates a new version under the new name, copies the old
	 version's methods forward, then rebinds the dictionary key (add new, remove old).
	 oldSource/newSource are the old/new class definitions, for the before/after diff."
	^(self new
		setId: anId kind: #classRename dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns)
		setNewName: nn
%

category: 'instance creation'
classmethod: GsRefactoringChange
classReparentId: anId dictName: dn className: cn oldSource: os newSource: ns
	"A descendant of a renamed class: it must be recompiled newVersionOf: its current
	 version so it re-points at the freshly created parent chain (and, for a direct
	 child, so its definition names the new superclass). `className` is the descendant's
	 own (unchanged) name. oldSource/newSource are its old/new definition."
	^self new
		setId: anId kind: #classReparent dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns
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

category: 'building'
method: GsRefactoringChangeSet
addClassRenameInDictionary: dn className: cn newName: nn oldSource: os newSource: ns
	"Stage the rename of the target class. Records the change only; NEVER compiles or
	 commits. Apply creates a new class version under the new name (newVersionOf: the
	 current version), copies methods forward, and rebinds the dictionary key.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classRenameId: self nextIdString dictName: dn className: cn
		newName: nn oldSource: os newSource: ns.
	changes add: change.
	^change
%

category: 'building'
method: GsRefactoringChangeSet
addClassReparentInDictionary: dn className: cn oldSource: os newSource: ns
	"Stage the re-parenting of one descendant of a renamed class. Records the change
	 only; NEVER compiles or commits. Apply recompiles the descendant's definition
	 newVersionOf: its current version and copies its methods forward.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classReparentId: self nextIdString dictName: dn className: cn
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

category: 'class variables'
method: GsRefactoringEnvironment
methodsAccessingClassVar: anAssociation inHierarchyOf: aClass
	"The rename-classVar affected set: every method -- instance AND class side, in
	 aClass and every subclass -- whose compiled code references the class variable
	 whose binding is anAssociation, as an Array of GsNMethod (each answers its own
	 inClass and selector). Detection is bytecode-precise: a method references the class
	 variable iff its literal frame holds the exact association object, so a same-named
	 GLOBAL (a different association) and a shadowing temporary/argument (no association
	 literal) are both excluded. Read-only; computes nothing on the persistent store."
	| result classesToScan |
	result := OrderedCollection new.
	classesToScan := OrderedCollection new.
	classesToScan add: aClass.
	classesToScan addAll: aClass allSubclasses.
	classesToScan do: [:cls |
		self addMethodsAccessing: anAssociation inBehavior: cls to: result.
		self addMethodsAccessing: anAssociation inBehavior: cls class to: result].
	^result asArray
%

category: 'class variables'
method: GsRefactoringEnvironment
addMethodsAccessing: anAssociation inBehavior: aBehavior to: aCollection
	"Add to aCollection each of aBehavior's OWN methods (environment 0) whose literal
	 frame holds anAssociation by identity -- i.e. that reference the class variable
	 bound to it. aBehavior is a class or a metaclass (for the class side)."
	aBehavior selectors do: [:sel | | m |
		m := aBehavior compiledMethodAt: sel environmentId: 0 otherwise: nil.
		(m notNil and: [m literals anySatisfy: [:e | e == anAssociation]])
			ifTrue: [aCollection add: m]]
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

category: 'selectors'
method: GsRefactoringEnvironment
referencesToClassNamed: aName
	"Every method whose compiled code references the class currently bound to aName
	 (across all dictionaries), as an Array of GsNMethod. These are the method bodies
	 whose source names the class as a global -- exactly the references a rename must
	 rewrite. Uses the same ClassOrganizer reflection the client's referencesToObject
	 query uses. Read-only; returns an empty Array if the name is unbound."
	| obj |
	obj := self classNamed: aName.
	obj isNil ifTrue: [^Array new].
	^(ClassOrganizer new referencesToObject: obj) asArray
%

category: 'enumerating'
method: GsRefactoringEnvironment
descendantsOf: aClass
	"aClass's subclasses, ordered top-down (a superclass always precedes its own
	 subclasses), de-duplicated by identity. A rename re-parents the whole descendant
	 subtree, and it must recompile a parent before its children so each child
	 re-points at the freshly created parent version. Read-only."
	| ordered seen frontier |
	ordered := OrderedCollection new.
	seen := IdentitySet new.
	frontier := OrderedCollection new.
	frontier addAll: (aClass subclasses ifNil: [#()]).
	[frontier isEmpty] whileFalse: [
		| cls |
		cls := frontier removeFirst.
		(seen includes: cls) ifFalse: [
			seen add: cls.
			ordered add: cls.
			frontier addAll: (cls subclasses ifNil: [#()])]].
	^ordered asArray
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

category: 'private'
method: GsRenameClassRefactoring
setShapeSource: aClass
	"The class VERSION to take the renamed class's shape + methods from. Nil (the
	 default) means use the current class -- i.e. an ordinary rename."
	shapeSource := aClass
%

category: 'private'
method: GsRenameClassRefactoring
shapeSourceOr: aClass
	"The shape/method source for the target class: the explicit shapeSource (a
	 restore) or the current class (an ordinary rename)."
	^shapeSource ifNil: [aClass]
%

category: 'private'
method: GsRenameClassRefactoring
setEnvironment: anEnvironment class: aClass oldName: on newName: nn scopeKind: sk scopeDictName: dn
	environment := anEnvironment.
	definingClass := aClass.
	oldName := on asString.
	newName := nn asString.
	oldNameSym := oldName asSymbol.
	scopeKind := sk.
	scopeDictName := dn.
	"Engine-safe option defaults; the client passes explicit values. Migrate and
	 remove-from-history default OFF here because they mutate persistent state and
	 commit -- so a caller (e.g. an SUnit test) that does not opt in never commits."
	copyMethods := true.
	recompileSubclasses := true.
	migrateInstances := false.
	removeOldFromHistory := false
%

category: 'accessing'
method: GsRenameClassRefactoring
copyMethods: cm recompileSubclasses: rs migrateInstances: mi removeOldFromHistory: rh
	"The four rename options (JadeiteForPharo issue #142):
	  - copyMethods: copy each superseded version's methods onto its new version
	    (off = the new versions start with an empty method dictionary);
	  - recompileSubclasses: re-parent the descendant subtree onto the new version
	    (off = subclasses keep pointing at the old version and are NOT touched);
	  - migrateInstances: migrate every instance of each superseded version to its
	    new version -- this REQUIRES a commit, so the apply commits when it is on;
	  - removeOldFromHistory: prune the superseded versions from the class history
	    after applying (off = history keeps every version)."
	copyMethods := cm.
	recompileSubclasses := rs.
	migrateInstances := mi.
	removeOldFromHistory := rh
%

category: 'accessing'
method: GsRenameClassRefactoring
definingClass
	^definingClass
%

category: 'accessing'
method: GsRenameClassRefactoring
environment
	^environment
%

category: 'accessing'
method: GsRenameClassRefactoring
oldName
	^oldName
%

category: 'accessing'
method: GsRenameClassRefactoring
newName
	^newName
%

category: 'accessing'
method: GsRenameClassRefactoring
changeSet
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
%

category: 'building'
method: GsRenameClassRefactoring
buildChangeSet
	"Stage the #classRename for the target, a #classReparent for every descendant
	 (top-down), and a #methodRecompile for every in-scope method OUTSIDE the renamed
	 subtree that references the old name. Counts the out-of-scope references and any
	 method that could not be rewritten (skipped). Compiles nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	outOfScopeReferenceCount := 0.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	self stageClassRenameInto: cs.
	self stageReparentsInto: cs.
	self stageReferenceRecompilesInto: cs.
	^cs
%

category: 'building'
method: GsRenameClassRefactoring
stageClassRenameInto: aChangeSet
	"Stage the rename of the target class: old vs new class definition (the name
	 changed) for the diff. The apply does the structural work (new version, method
	 copy-forward, rebind)."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameClassNameIn: oldDef from: oldName to: newName.
	aChangeSet
		addClassRenameInDictionary: (self dictNameForClass: definingClass)
		className: oldName
		newName: newName
		oldSource: oldDef
		newSource: newDef
%

category: 'building'
method: GsRenameClassRefactoring
stageReparentsInto: aChangeSet
	"Stage a #classReparent for every descendant of the target, top-down. A direct
	 child's definition has its superclass name rewritten old -> new; a deeper
	 descendant's definition is textually unchanged but is still staged, because its
	 version must be recompiled to re-point at the new parent-chain version.
	 Skipped entirely when the recompileSubclasses option is off -- the subclasses
	 then keep pointing at the old version and are not touched."
	recompileSubclasses ifFalse: [^self].
	(environment descendantsOf: definingClass) do: [:sub |
		| oldDef newDef |
		oldDef := sub definition.
		newDef := (sub superclass == definingClass)
			ifTrue: [self renameSuperclassNameIn: oldDef from: oldName to: newName]
			ifFalse: [oldDef].
		aChangeSet
			addClassReparentInDictionary: (self dictNameForClass: sub)
			className: sub name asString
			oldSource: oldDef
			newSource: newDef]
%

category: 'building'
method: GsRenameClassRefactoring
stageReferenceRecompilesInto: aChangeSet
	"Stage a #methodRecompile for every in-scope method that references the old class
	 name and lives OUTSIDE the renamed subtree (the target + its descendants). The
	 subtree's own methods are rewritten during their copy-forward, so recompiling them
	 here would be redundant (and would target a soon-to-be-removed name)."
	| subtree |
	"A same-name restore changes no name, so no external reference needs rewriting."
	oldNameSym == newName asSymbol ifTrue: [^self].
	subtree := self subtreeClassSet.
	(environment referencesToClassNamed: oldName) do: [:m |
		[| base |
		 base := self baseClassOf: m.
		 (subtree includes: base)
			ifFalse: [
				(self isClassInScope: base)
					ifTrue: [self stageReferenceRewrite: m base: base into: aChangeSet]
					ifFalse: [outOfScopeReferenceCount := outOfScopeReferenceCount + 1]]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]]
%

category: 'building'
method: GsRenameClassRefactoring
stageReferenceRewrite: aMethod base: base into: aChangeSet
	"Stage a recompile of one external referencing method with its old-name references
	 rewritten to the new name (minimal diff). Stages nothing if no real reference was
	 rewritten (e.g. the name only appeared in a comment or a symbol literal)."
	| isMeta sel oldSrc newSrc cat |
	isMeta := aMethod inClass isMeta.
	sel := aMethod selector.
	oldSrc := aMethod sourceString.
	newSrc := self rewriteReferencesInSource: oldSrc.
	newSrc isNil ifTrue: [^self].
	cat := (aMethod inClass categoryOfSelector: sel environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRecompileInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		selector: sel
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
%

category: 'private'
method: GsRenameClassRefactoring
subtreeClassSet
	"The target class + all its descendants, as an IdentitySet (used to exclude the
	 renamed subtree's own methods from the external reference scan). Cached."
	subtreeClasses isNil ifTrue: [
		subtreeClasses := IdentitySet new.
		subtreeClasses add: definingClass.
		subtreeClasses addAll: (environment descendantsOf: definingClass)].
	^subtreeClasses
%

category: 'private'
method: GsRenameClassRefactoring
baseClassOf: aMethod
	"The non-meta class of aMethod's defining class. GemStone's Metaclass answers its
	 instance class via #thisClass (NOT the Pharo-ism #instanceClass)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
%

category: 'testing'
method: GsRenameClassRefactoring
isClassInScope: aClass
	scopeKind == #wholeSystem ifTrue: [^true].
	scopeKind == #class ifTrue: [^aClass == definingClass].
	scopeKind == #hierarchy ifTrue: [^self hierarchyScopeClasses includes: aClass].
	scopeKind == #dictionary ifTrue: [
		| wanted |
		wanted := scopeDictName asSymbol.
		^(environment dictionariesDefiningClassNamed: aClass name)
			anySatisfy: [:d | d name asSymbol == wanted]].
	^false
%

category: 'private'
method: GsRenameClassRefactoring
hierarchyScopeClasses
	"definingClass's hierarchy (itself, subclasses, superclasses), computed once."
	scopeClasses isNil ifTrue: [
		scopeClasses := IdentitySet new.
		scopeClasses add: definingClass.
		scopeClasses addAll: definingClass allSubclasses.
		scopeClasses addAll: definingClass allSuperclasses].
	^scopeClasses
%

category: 'private'
method: GsRenameClassRefactoring
dictNameForClass: aClass
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
%

category: 'source rewriting'
method: GsRenameClassRefactoring
renameClassNameIn: defString from: oldStr to: newStr
	"Return defString with the class-name literal renamed. A class definition names
	 the new class as the FIRST string literal after the `subclass:`-family keyword,
	 e.g. `Object subclass: 'Old' instVarNames: ...`. Rewrites only that quoted name,
	 so an instVar/classVar or a pool sharing the spelling is untouched."
	| marker mstart qStart qEnd |
	marker := 'subclass: '''.
	mstart := defString indexOfSubCollection: marker.
	mstart = 0 ifTrue: [^defString].
	qStart := mstart + marker size.        "first char of the quoted name"
	qEnd := defString indexOf: $' startingAt: qStart.
	qEnd = 0 ifTrue: [^defString].
	((defString copyFrom: qStart to: qEnd - 1) = oldStr)
		ifFalse: [^defString].
	^(defString copyFrom: 1 to: qStart - 1), newStr, (defString copyFrom: qEnd to: defString size)
%

category: 'source rewriting'
method: GsRenameClassRefactoring
renameSuperclassNameIn: defString from: oldStr to: newStr
	"Return a direct child's definition with its SUPERCLASS name rewritten. The
	 superclass is the receiver at the very start of the definition, e.g.
	 `Old subclass: 'Child' ...`. Rewrites only that leading identifier token."
	| start tokenEnd |
	start := 1.
	[start <= defString size and: [(defString at: start) isSeparator]] whileTrue: [start := start + 1].
	tokenEnd := start + oldStr size - 1.
	tokenEnd >= defString size ifTrue: [^defString].
	((defString copyFrom: start to: tokenEnd) = oldStr) ifFalse: [^defString].
	(defString at: tokenEnd + 1) isSeparator ifFalse: [^defString].
	^(defString copyFrom: 1 to: start - 1), newStr, (defString copyFrom: tokenEnd + 1 to: defString size)
%

category: 'source rewriting'
method: GsRenameClassRefactoring
rewriteReferencesInSource: aString
	"Parse aString, rewrite the non-shadowed references to the old class name to the
	 new name (minimal diff), and return the regenerated source -- or nil if nothing
	 was rewritten (so the caller stages/compiles nothing spurious)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self rewriteRefsIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree newSource
%

category: 'source rewriting'
method: GsRenameClassRefactoring
rewriteRefsIn: aNode shadowed: shadowed
	"Recursively rewrite references to the old class name at and under aNode, returning
	 how many were rewritten. A reference is renamed minimal-diff: register an
	 RBStringReplacement for its source span AND mutate its token (so the reparsed
	 source matches the mutated AST and newSource takes the splice path). shadowed is
	 true when a same-named argument or temporary captured the name in an enclosing
	 scope -- extremely rare for a capitalised class name, but handled for safety, the
	 same way rename-instVar does."
	| count childShadowed |
	aNode isVariable ifTrue: [
		(shadowed not and: [aNode name asSymbol == oldNameSym]) ifTrue: [
			aNode addReplacement: (RBStringReplacement
				replaceFrom: aNode start to: aNode stop with: newName).
			aNode token value: newName.
			^1].
		^0].
	count := 0.
	childShadowed := shadowed or: [self node: aNode declaresName: oldNameSym].
	aNode children do: [:child |
		count := count + (self rewriteRefsIn: child shadowed: childShadowed)].
	^count
%

category: 'source rewriting'
method: GsRenameClassRefactoring
node: aNode declaresName: aSymbol
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol?"
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
%

category: 'preconditions'
method: GsRenameClassRefactoring
newNameCollision
	"nil if the new name is free to use, otherwise a short reason string: the new name
	 is already bound to some OTHER global anywhere on the symbol list. Building the
	 change set does not enforce this (the preview surfaces it); the apply would fail."
	| existing |
	existing := environment symbolList objectNamed: newName asSymbol.
	existing isNil ifTrue: [^nil].
	existing == definingClass ifTrue: [^nil].
	^'the name ', newName, ' is already in use'
%

category: 'accessing'
method: GsRenameClassRefactoring
outOfScopeReferenceCount
	self changeSet.
	^outOfScopeReferenceCount
%

category: 'serializing'
method: GsRenameClassRefactoring
outOfScopeJsonString
	"The out-of-scope / precondition / skipped warning payload for the preview."
	self changeSet.
	^'{"references":', outOfScopeReferenceCount printString,
	  ',"skipped":', skippedCount printString,
	  ',"descendants":', (environment descendantsOf: definingClass) size printString,
	  ',"collision":', (self newNameCollision
		ifNil: ['null']
		ifNotNil: [:reason | self jsonQuote: reason]), '}'
%

category: 'private'
method: GsRenameClassRefactoring
recordSkipped: aMethod
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
%

category: 'serializing'
method: GsRenameClassRefactoring
skippedMethodsJsonString
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

category: 'serializing'
method: GsRenameClassRefactoring
previewJsonString
	^self changeSet jsonString
%

category: 'paginated preview'
method: GsRenameClassRefactoring
pageJsonFrom: startIndex maxBytes: maxBytes
	"A byte-bounded page of staged changes (with source) from startIndex (1-based).
	 At least one change is always emitted."
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
method: GsRenameClassRefactoring
startPreviewToken: token maxBytes: maxBytes
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus the totals + warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"oldName":', (self jsonQuote: oldName),
	  ',"newName":', (self jsonQuote: newName),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
%

category: 'applying'
method: GsRenameClassRefactoring
applyDeselected: deselectedIds
	"Apply the staged changes in the stone. The #classRename and every #classReparent
	 are ALWAYS applied (structural -- skipping one would orphan a subclass or dangle
	 the name); a deselection is honoured only for the optional #methodRecompile
	 reference rewrites. Then, per the options: migrate every instance of each
	 superseded version to its new version, prune the superseded versions from the
	 class history, and -- because migration must be durable -- COMMIT if either of
	 those persistent options was requested -- but ONLY if every staged change applied
	 cleanly, so a partly-failed rename is left uncommitted for the user to inspect and
	 abort rather than persisted half-done. With neither option (the safe path) nothing
	 is committed, matching the other refactorings. Answers
	 {applied, failed:[..], committed, migratedFailures}."
	| ids applied failures migrated committed |
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	oldToNew := IdentityDictionary new.
	applied := 0.
	failures := OrderedCollection new.
	self changeSet changes do: [:change |
		(change kind == #methodRecompile and: [ids includes: change id asSymbol])
			ifFalse: [
				[self applyChange: change. applied := applied + 1]
				on: Error do: [:e |
					failures add: (Array with: change id with: change className with: e messageText)]]].
	migrated := 0.
	committed := false.
	((migrateInstances or: [removeOldFromHistory]) and: [failures isEmpty]) ifTrue: [
		"Commit the structural rename FIRST so the new class versions are persistent:
		 migrating already-committed instances to a version created in this same
		 uncommitted transaction is a no-op. Then migrate/prune and commit again. Only
		 reached when the structural apply had zero failures, so we never commit a
		 half-applied rename."
		[System commitTransaction. committed := true] on: Error do: [:e |
			failures add: (Array with: 'commit' with: newName with: e messageText)].
		committed ifTrue: [
			migrateInstances ifTrue: [migrated := self migrateAllInstances].
			removeOldFromHistory ifTrue: [self pruneSupersededVersions].
			[System commitTransaction] on: Error do: [:e |
				failures add: (Array with: 'commit' with: newName with: e messageText)]]].
	^'{"applied":', applied printString,
	  ',"committed":', committed printString,
	  ',"migratedFailures":', migrated printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
%

category: 'applying'
method: GsRenameClassRefactoring
migrateAllInstances
	"Migrate every instance of each superseded version (the keys of oldToNew: the
	 target and each re-parented descendant) to its new version. Answers the total
	 number of instances that FAILED to migrate (no read/write permission, index
	 incompatibility, etc. -- migrateInstancesTo: answers five sets; set 1 is empty,
	 sets 2..5 are failures). A migrateInstancesTo: that RAISES (rather than reporting
	 failure sets) is counted as at least one failure so an errored migration is never
	 reported as a clean success. Does not commit -- the caller commits."
	| failed |
	failed := 0.
	oldToNew keysAndValuesDo: [:old :new |
		[| report |
		 report := old migrateInstancesTo: new.
		 2 to: report size do: [:i | failed := failed + (report at: i) size]]
		on: Error do: [:e | failed := failed + 1]].
	^failed
%

category: 'applying'
method: GsRenameClassRefactoring
pruneSupersededVersions
	"Remove the superseded versions from each reversioned class's history, leaving
	 only the current (new) version. Guards on identity so the new version is never
	 removed. Does not commit -- the caller commits."
	oldToNew valuesDo: [:new | | hist |
		hist := new classHistory.
		hist asArray do: [:v | v == new ifFalse: [hist removeVersion: v]]]
%

category: 'applying'
method: GsRenameClassRefactoring
applyChange: aChange
	aChange kind == #classRename ifTrue: [^self applyClassRename: aChange].
	aChange kind == #classReparent ifTrue: [^self applyClassReparent: aChange].
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-class: ', aChange kind printString
%

category: 'applying'
method: GsRenameClassRefactoring
applyClassRename: aChange
	"Create the new version under the new name (newVersionOf: the current class),
	 shaped like the shape source (the current class for a rename, a historical
	 version for a restore) and carrying that source's methods (rewriting old-name
	 references). Record the old->new mapping for the descendant reparents, then, if
	 the name actually changed, remove the old name binding."
	| old src new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	src := self shapeSourceOr: old.
	new := self makeNewVersionOf: old shapedLike: src named: aChange newName superclass: old superclass.
	copyMethods ifTrue: [self copyMethodsFrom: src to: new].
	oldToNew at: old put: new.
	aChange className asString = aChange newName asString
		ifFalse: [self removeBinding: aChange className ifValueIs: old]
%

category: 'applying'
method: GsRenameClassRefactoring
applyClassReparent: aChange
	"Recompile one descendant newVersionOf: its current version, re-parented under the
	 freshly created parent-chain version, and copy its methods forward (rewriting any
	 old-name reference). Its name is unchanged, so the primitive rebinds it in place."
	| old parentNew new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	parentNew := oldToNew at: old superclass ifAbsent: [old superclass].
	new := self makeNewVersionOf: old shapedLike: old named: old name asString superclass: parentNew.
	copyMethods ifTrue: [self copyMethodsFrom: old to: new].
	oldToNew at: old put: new
%

category: 'applying'
method: GsRenameClassRefactoring
applyMethodRecompile: aChange
	"Recompile one external referencing method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
%

category: 'applying'
method: GsRenameClassRefactoring
makeNewVersionOf: old shapedLike: shape named: aName superclass: sup
	"Create a new version in `old`'s class history, named aName, under superclass sup,
	 with the shape (own instVars, classVars, class-instVars, pools, comment) of
	 `shape`. `shape` is `old` itself for an ordinary rename or reparent, and a
	 historical version for a restore.

	 Uses the FORMAT-taking creation primitive and passes `shape format` explicitly,
	 rather than the plain newVersionOf: form which takes format from the superclass.
	 That is what preserves the class's OWN format bits -- byte vs pointer vs NSC vs
	 indexable AND options encoded in the format such as instancesInvariant -- which the
	 superclass-derived form silently drops (e.g. an invariant class would become
	 mutable). Threading `inClassHistory: old classHistory` keeps it a version of the
	 same class, so class-variable and class-instance-variable VALUES (shared across a
	 class history) and the class category carry forward automatically."
	^sup
		_subclass: aName
		instVarNames: (shape instVarNames collect: [:e | e asString])
		format: shape format
		classVars: (shape classVarNames collect: [:e | e asString])
		classInstVars: (shape class instVarNames collect: [:e | e asString])
		poolDictionaries: shape sharedPools
		inDictionary: (self dictObjectFor: old)
		inClassHistory: old classHistory
		description: ([shape commentForFileout] on: Error do: [:e | ''])
		options: #()
%

category: 'applying'
method: GsRenameClassRefactoring
copyMethodsFrom: old to: new
	"Copy every method of `old` (both sides) onto `new`, rewriting old-name references
	 to the new name. A new class version starts with an empty method dictionary, so
	 this is what carries the behaviour forward."
	old selectors do: [:sel | self copyMethod: sel from: old to: new].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class]
%

category: 'applying'
method: GsRenameClassRefactoring
copyMethod: sel from: srcCls to: dstCls
	| m src newSrc cat |
	m := srcCls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^self].
	src := m sourceString.
	newSrc := self rewriteReferencesInSource: src.
	cat := (srcCls categoryOfSelector: sel environmentId: 0) ifNil: ['as yet unclassified'].
	dstCls
		compileMethod: (newSrc ifNil: [src])
		dictionaries: System myUserProfile symbolList
		category: cat asString
%

category: 'applying'
method: GsRenameClassRefactoring
dictObjectFor: aClass
	"The actual SymbolDictionary object that defines aClass's name, for inDictionary:.
	 Falls back to the user's default (UserGlobals) if none is found (should not happen
	 for a bound class)."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
%

category: 'applying'
method: GsRenameClassRefactoring
removeBinding: aName ifValueIs: aClass
	"Remove aName from every dictionary that currently binds it to aClass. Guards on
	 identity so an unrelated global that happens to share the spelling is left alone."
	| sym |
	sym := aName asSymbol.
	environment dictionariesDo: [:dict |
		((dict at: sym ifAbsent: [nil]) == aClass)
			ifTrue: [dict removeKey: sym ifAbsent: []]]
%

category: 'serializing'
method: GsRenameClassRefactoring
hex2: anInteger
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'serializing'
method: GsRenameClassRefactoring
jsonEscape: aString
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126
	 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a
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

category: 'serializing'
method: GsRenameClassRefactoring
jsonQuote: aString
	^'"', (self jsonEscape: aString), '"'
%

category: 'instance creation'
classmethod: GsRenameClassRefactoring
restoreClass: aClass toVersion: aVersion
	"Restore aClass to a historical class-history version aVersion: the same
	 operation as a rename to aVersion's name, but the target class is rebuilt from
	 aVersion's shape AND methods (not the current class's). When aVersion's name
	 differs from the current name this reparents subclasses and rewrites references
	 exactly as a rename does; when the name is unchanged it is a shape/method redo
	 that still creates a new version and re-parents subclasses onto it. Whole-system
	 scope, since a restore that changes the name must fix every reference."
	^(self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: aVersion name asString
		scopeKind: #wholeSystem
		scopeDictName: nil)
		setShapeSource: aVersion
%

category: 'instance creation'
classmethod: GsRenameClassRefactoring
class: aClass renameTo: newNameString dictionaryScope: dictName
	"Rename scoped to a single named SymbolDictionary (for the reference rewrite)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: newNameString
		scopeKind: #dictionary
		scopeDictName: dictName
%

category: 'instance creation'
classmethod: GsRenameClassRefactoring
class: aClass renameTo: newNameString scope: scopeSymbol
	"scopeSymbol is #class, #hierarchy, or #wholeSystem. For #dictionary use
	 class:renameTo:dictionaryScope:."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: newNameString
		scopeKind: scopeSymbol
		scopeDictName: nil
%

category: 'instance creation'
classmethod: GsRenameClassRefactoring
environment: anEnvironment class: aClass oldName: on newName: nn scopeKind: sk scopeDictName: dn
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: on
		newName: nn
		scopeKind: sk
		scopeDictName: dn
%

category: 'paginated preview'
classmethod: GsRenameClassRefactoring
pageForToken: token from: startIndex maxBytes: maxBytes
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
%

category: 'applying'
classmethod: GsRenameClassRefactoring
applyForToken: token deselected: deselectedIds
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
%

category: 'paginated preview'
classmethod: GsRenameClassRefactoring
clearToken: token
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
%

category: 'private'
method: GsRenameClassVariableRefactoring
setEnvironment: anEnvironment class: aClass oldName: oldNameString newName: newNameString
	environment := anEnvironment.
	definingClass := aClass.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldName asSymbol.
	newNameSym := newName asSymbol
%

category: 'accessing'
method: GsRenameClassVariableRefactoring
environment
	^environment
%

category: 'accessing'
method: GsRenameClassVariableRefactoring
definingClass
	^definingClass
%

category: 'accessing'
method: GsRenameClassVariableRefactoring
oldName
	^oldName
%

category: 'accessing'
method: GsRenameClassVariableRefactoring
newName
	^newName
%

category: 'accessing'
method: GsRenameClassVariableRefactoring
changeSet
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
%

category: 'private'
method: GsRenameClassVariableRefactoring
classVarAssociation
	"The SymbolAssociation the old class-variable name is bound to on the defining
	 class, or nil if the class does not declare it. This is the exact object a
	 referencing method holds in its literal frame, so it is what the affected-method
	 scan looks for."
	^definingClass _classVars associationAt: oldNameSym ifAbsent: [nil]
%

category: 'building'
method: GsRenameClassVariableRefactoring
buildChangeSet
	"Stage the #classDefinitionEdit (the classVars: clause with the variable renamed)
	 FIRST so the apply adds the new variable before recompiling the methods that
	 reference it, then a #methodRecompile for every method (both sides, whole subtree)
	 that references the class variable. Compiles nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	self stageClassDefinitionEditInto: cs.
	self stageMethodRecompilesInto: cs.
	^cs
%

category: 'building'
method: GsRenameClassVariableRefactoring
stageClassDefinitionEditInto: aChangeSet
	"Stage the edit to the defining class's own definition: the classVars: list with
	 the variable renamed. No compile, no commit."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameClassVarInDefinition: oldDef.
	newDef = oldDef ifTrue: [^self].
	aChangeSet
		addClassDefinitionEditInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		oldSource: oldDef
		newSource: newDef
%

category: 'building'
method: GsRenameClassVariableRefactoring
stageMethodRecompilesInto: aChangeSet
	"Stage a #methodRecompile for every method (instance and class side, defining
	 class and subclasses) that references the class variable and whose non-shadowed
	 references change. Each method is isolated so one that cannot be rewritten is
	 recorded as skipped rather than aborting the whole preview."
	| assoc |
	assoc := self classVarAssociation.
	assoc isNil ifTrue: [^self].
	(environment methodsAccessingClassVar: assoc inHierarchyOf: definingClass) do: [:m |
		[self stageMethodRewrite: m into: aChangeSet]
			on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]]
%

category: 'building'
method: GsRenameClassVariableRefactoring
stageMethodRewrite: aMethod into: aChangeSet
	"Stage a recompile of one referencing method with its class-variable references
	 renamed minimal-diff. Stages nothing if no real reference was rewritten (e.g. the
	 name only appeared in a comment or a symbol literal)."
	| base isMeta sel oldSrc newSrc cat |
	base := self baseClassOf: aMethod.
	isMeta := aMethod inClass isMeta.
	sel := aMethod selector.
	oldSrc := aMethod sourceString.
	newSrc := self rewriteReferencesInSource: oldSrc.
	newSrc isNil ifTrue: [^self].
	cat := (aMethod inClass categoryOfSelector: sel environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRecompileInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		selector: sel
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
%

category: 'private'
method: GsRenameClassVariableRefactoring
baseClassOf: aMethod
	"The non-meta class of aMethod's defining class. GemStone's Metaclass answers its
	 instance class via #thisClass (NOT the Pharo-ism #instanceClass)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
%

category: 'private'
method: GsRenameClassVariableRefactoring
dictNameForClass: aClass
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
%

category: 'private'
method: GsRenameClassVariableRefactoring
recordSkipped: aMethod
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
%

category: 'source rewriting'
method: GsRenameClassVariableRefactoring
renameClassVarInDefinition: defString
	"Return defString with the old class-variable name replaced by the new one inside
	 the classVars: #( ... ) clause only. Tokenises the clause on whitespace and
	 rebuilds it, so an instance variable, the class name, or classInstVars sharing the
	 old spelling is untouched. Returns defString unchanged if no clause is found.

	 Assumes the clause renders BARE symbols (`classVars: #( Counter Other)`, design
	 fact #5): each token is matched via `asSymbol == oldNameSym`, so a quoted rendering
	 (`#('Counter')`) would not match and the rename would silently no-op here. If a
	 stone/version ever renders quoted names, testStagesClassDefinitionEditWithRenamedClassVar
	 fails -- that test is the guard on this assumption."
	| start openParen closeParen listStr names separators ws |
	start := defString indexOfSubCollection: 'classVars:'.
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

category: 'source rewriting'
method: GsRenameClassVariableRefactoring
rewriteReferencesInSource: aString
	"Parse aString, rewrite the non-shadowed references to the old class-variable name
	 to the new name (minimal diff), and return the regenerated source -- or nil if
	 nothing was rewritten (so the caller stages/compiles nothing spurious)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self rewriteRefsIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree newSource
%

category: 'source rewriting'
method: GsRenameClassVariableRefactoring
rewriteRefsIn: aNode shadowed: shadowed
	"Recursively rewrite references to the old class-variable name at and under aNode,
	 returning how many were rewritten. A reference is renamed minimal-diff: register
	 an RBStringReplacement for its source span AND mutate its token (so the reparsed
	 source matches the mutated AST and newSource takes the splice path). shadowed is
	 true when a same-named argument or temporary captured the name in an enclosing
	 scope, in which case no node here refers to the class variable -- the same
	 scope-aware guard rename-instVar uses."
	| count childShadowed |
	aNode isVariable ifTrue: [
		(shadowed not and: [aNode name asSymbol == oldNameSym]) ifTrue: [
			aNode addReplacement: (RBStringReplacement
				replaceFrom: aNode start to: aNode stop with: newName).
			aNode token value: newName.
			^1].
		^0].
	count := 0.
	childShadowed := shadowed or: [self node: aNode declaresName: oldNameSym].
	aNode children do: [:child |
		count := count + (self rewriteRefsIn: child shadowed: childShadowed)].
	^count
%

category: 'source rewriting'
method: GsRenameClassVariableRefactoring
node: aNode declaresName: aSymbol
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol? Such a
	 binding shadows the class variable for that scope."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
%

category: 'preconditions'
method: GsRenameClassVariableRefactoring
newNameCollision
	"nil if the new name is free to use, otherwise a short reason string: the new name
	 already names a class variable visible in the hierarchy, an instance variable of
	 the defining class, or a global anywhere on the symbol list. Building the change
	 set does not enforce this (the preview surfaces it); the apply would fail."
	newNameSym == oldNameSym ifTrue: [^nil].
	(self hierarchyClassVarNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already a class variable in the hierarchy'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an instance variable'].
	(environment symbolList objectNamed: newNameSym) notNil
		ifTrue: [^'the name ', newName, ' is already in use as a global'].
	^nil
%

category: 'private'
method: GsRenameClassVariableRefactoring
hierarchyClassVarNames
	"Every class-variable name declared anywhere in the defining class's hierarchy
	 (itself, its superclasses, its subclasses), as a Set of Symbols. A class variable
	 must be unique across the classes that can see it."
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes addAll: definingClass allSubclasses.
	classes do: [:cls |
		cls classVarNames do: [:n | names add: n asSymbol]].
	^names
%

category: 'serializing'
method: GsRenameClassVariableRefactoring
previewJsonString
	^self changeSet jsonString
%

category: 'serializing'
method: GsRenameClassVariableRefactoring
outOfScopeJsonString
	"The scope / precondition / skipped warning payload for the preview. A class-variable
	 rename is confined to the hierarchy, so there are never any out-of-scope references;
	 the payload keeps the same shape the client's paginated panel reads (references,
	 skipped, collision) and adds a scope note."
	self changeSet.
	^'{"references":0,"skipped":', skippedCount printString,
	  ',"scope":"hierarchy"',
	  ',"collision":', (self newNameCollision
		ifNil: ['null']
		ifNotNil: [:reason | self jsonQuote: reason]), '}'
%

category: 'serializing'
method: GsRenameClassVariableRefactoring
skippedMethodsJsonString
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

category: 'serializing'
method: GsRenameClassVariableRefactoring
jsonEscape: aString
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126
	 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a
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

category: 'serializing'
method: GsRenameClassVariableRefactoring
jsonQuote: aString
	^'"', (self jsonEscape: aString), '"'
%

category: 'serializing'
method: GsRenameClassVariableRefactoring
hex2: anInteger
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'paginated preview'
method: GsRenameClassVariableRefactoring
pageJsonFrom: startIndex maxBytes: maxBytes
	"A byte-bounded page of staged changes (with source) from startIndex (1-based).
	 At least one change is always emitted."
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
method: GsRenameClassVariableRefactoring
startPreviewToken: token maxBytes: maxBytes
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus the totals + warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"oldName":', (self jsonQuote: oldName),
	  ',"newName":', (self jsonQuote: newName),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
%

category: 'applying'
method: GsRenameClassVariableRefactoring
applyDeselected: deselectedIds
	"Apply EVERY staged change in the stone WITHOUT committing (the user commits
	 explicitly). A class-variable rename is ALL-OR-NOTHING: the value-preserving
	 reflective rename removes the old binding, so a reference method left un-rewritten
	 would silently read a disconnected value (a dangling reference). The client
	 therefore does not offer to deselect the reference recompiles, and this method does
	 NOT honour a deselection even if one is passed -- applying every change is the only
	 coherent, non-dangling behaviour. deselectedIds is accepted solely for signature
	 compatibility with the other refactorings' applyForToken:deselected: entry point;
	 it is intentionally ignored. Answers {applied, failed:[..]}."
	| applied failures |
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change className with: e messageText)]].
	^'{"applied":', applied printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
%

category: 'applying'
method: GsRenameClassVariableRefactoring
applyChange: aChange
	aChange kind == #classDefinitionEdit ifTrue: [^self applyClassDefinitionEdit: aChange].
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-class-variable: ', aChange kind printString
%

category: 'applying'
method: GsRenameClassVariableRefactoring
applyClassDefinitionEdit: aChange
	"Rename the class variable reflectively, preserving its shared VALUE: add the new
	 name, carry the old association's value onto it, then remove the old name. A naive
	 recompile of the new class definition would drop the value; addClassVarName: /
	 removeClassVarName: preserve it and -- because a class-variable change does not
	 alter instance format -- create no new class version. The old name is removed
	 first-change here (before the method recompiles run) safely: a not-yet-recompiled
	 method keeps a working, detached copy of the old association until it is recompiled
	 to the new name."
	| cls oldAssoc oldValue |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	oldAssoc := cls _classVars associationAt: oldNameSym ifAbsent: [nil].
	oldValue := oldAssoc isNil ifTrue: [nil] ifFalse: [oldAssoc value].
	cls addClassVarName: newName.
	(cls _classVars associationAt: newNameSym) value: oldValue.
	cls removeClassVarName: oldName
%

category: 'applying'
method: GsRenameClassVariableRefactoring
applyMethodRecompile: aChange
	"Recompile one referencing method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
%

category: 'instance creation'
classmethod: GsRenameClassVariableRefactoring
class: aClass renameClassVar: oldNameString to: newNameString
	"Rename the class variable named oldNameString (declared on aClass) to
	 newNameString, across aClass and all its subclasses (both sides)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: oldNameString
		newName: newNameString
%

category: 'instance creation'
classmethod: GsRenameClassVariableRefactoring
environment: anEnvironment class: aClass oldName: oldNameString newName: newNameString
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: oldNameString
		newName: newNameString
%

category: 'paginated preview'
classmethod: GsRenameClassVariableRefactoring
pageForToken: token from: startIndex maxBytes: maxBytes
	"A page from a previously-started preview (see startPreviewToken:maxBytes:),
	 by token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
%

category: 'paginated preview'
classmethod: GsRenameClassVariableRefactoring
applyForToken: token deselected: deselectedIds
	"Apply a previously-started preview (by token), skipping deselectedIds. No
	 commit. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
%

category: 'paginated preview'
classmethod: GsRenameClassVariableRefactoring
clearToken: token
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
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

category: 'private'
method: GsRenameTemporaryRefactoring
setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool oldName: oldNameString newName: newNameString offset: anOffset
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldName asSymbol.
	newNameSym := newName asSymbol.
	offset := anOffset.
	resolved := false
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
environment
	^environment
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
definingClass
	^definingClass
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
selector
	^selector
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
isMeta
	^isMeta
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
oldName
	^oldName
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
newName
	^newName
%

category: 'accessing'
method: GsRenameTemporaryRefactoring
changeSet
	"The staged, non-committing change set, computed once and cached. Empty when the
	 rename is declined (the offset does not resolve to a local) or nothing changed."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
%

category: 'private'
method: GsRenameTemporaryRefactoring
targetClass
	"The behaviour that holds the method: the metaclass for a class-side method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
%

category: 'private'
method: GsRenameTemporaryRefactoring
sourceString
	"The stored source of the method being refactored, or nil if it does not exist."
	| m |
	m := self targetClass compiledMethodAt: selector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
%

category: 'private'
method: GsRenameTemporaryRefactoring
parseTree
	"A fresh parse of the method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
%

category: 'private'
method: GsRenameTemporaryRefactoring
scopeNode: aNode declaresSym: aSymbol
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol? A
	 method or block declares its arguments; a sequence declares its temporaries."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^aNode arguments anySatisfy: [:a | a name asSymbol == aSymbol]].
	aNode isSequence
		ifTrue: [^aNode temporaries anySatisfy: [:t | t name asSymbol == aSymbol]].
	^false
%

category: 'private'
method: GsRenameTemporaryRefactoring
declaringScopeFor: aNode
	"The nearest enclosing scope node (method / block / sequence) that declares the
	 old name as an argument or temporary, walking aNode's parent chain from the
	 inside out -- or nil if the name is not a local as seen from aNode. This is the
	 binding aNode resolves to; two occurrences with the same declaring scope are the
	 same variable."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		(self scopeNode: n declaresSym: oldNameSym) ifTrue: [^n].
		n := n parent].
	^nil
%

category: 'private'
method: GsRenameTemporaryRefactoring
resolvedScope
	"The declaring scope of the occurrence at offset, or nil if that occurrence is
	 not a temporary/argument (an instance variable, a global, self, a message).
	 Computed once from a fresh parse; used by renamable and declineReason."
	resolved ifFalse: [
		resolved := true.
		resolvedScope := nil.
		[ | tree occ |
		tree := self parseTree.
		tree ifNotNil: [
			occ := tree bestNodeFor: (offset to: offset).
			occ ifNotNil: [resolvedScope := self declaringScopeFor: occ]]]
			on: Error do: [:e | resolvedScope := nil]].
	^resolvedScope
%

category: 'testing'
method: GsRenameTemporaryRefactoring
renamable
	"True if the occurrence at offset is a temporary or argument this refactoring can
	 rename."
	^self resolvedScope notNil
%

category: 'preconditions'
method: GsRenameTemporaryRefactoring
declineReason
	"nil if the occurrence is a renamable local, otherwise a reason string that
	 CLASSIFIES what the name actually is, so the client can tell the user why the
	 rename was declined and point them at the right refactoring."
	| sym |
	self renamable ifTrue: [^nil].
	sym := oldNameSym.
	(self isPseudoVariable: sym)
		ifTrue: [^'''', oldName, ''' is a reserved variable and cannot be renamed.'].
	((definingClass instVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is an instance variable of ', definingClass name,
			', not a temporary or argument. Use Rename Instance Variable to rename it everywhere it is used.'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is an instance variable inherited by ', definingClass name,
			'. Use Rename Instance Variable on the class that defines it.'].
	((definingClass class instVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is a class-instance variable of ', definingClass name, ', not a temporary or argument.'].
	(self visibleClassVarNames includes: sym)
		ifTrue: [^'''', oldName, ''' is a class variable visible in ', definingClass name,
			'. Use Rename Class Variable to rename it.'].
	(environment symbolList objectNamed: sym) notNil
		ifTrue: [^'''', oldName, ''' is a global, not a temporary or argument.'].
	^'''', oldName, ''' is not a temporary or argument at that position (it may be a message selector or an undeclared name).'
%

category: 'building'
method: GsRenameTemporaryRefactoring
buildChangeSet
	"Parse the method, resolve the target binding at offset, rename every occurrence
	 bound to it (leaving inner-shadowed occurrences alone), and stage a SINGLE
	 #methodRecompile with the rewritten source. Stages nothing (an empty change set)
	 when the rename is declined or no occurrence actually changed. Compiles nothing,
	 commits nothing."
	| cs tree occ scope targets |
	cs := GsRefactoringChangeSet new.
	tree := self parseTree.
	tree isNil ifTrue: [^cs].
	occ := tree bestNodeFor: (offset to: offset).
	occ isNil ifTrue: [^cs].
	scope := self declaringScopeFor: occ.
	scope isNil ifTrue: [^cs].
	targets := OrderedCollection new.
	tree nodesDo: [:node |
		(node isVariable
			and: [node name asSymbol == oldNameSym
			and: [(self declaringScopeFor: node) == scope]])
			ifTrue: [targets add: node]].
	targets isEmpty ifTrue: [^cs].
	targets do: [:node |
		node addReplacement: (RBStringReplacement
			replaceFrom: node start to: node stop with: newName).
		node token value: newName].
	cs
		addMethodRecompileInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		isMeta: isMeta
		selector: selector
		category: self methodCategory
		oldSource: self sourceString
		newSource: tree newSource.
	^cs
%

category: 'private'
method: GsRenameTemporaryRefactoring
methodCategory
	^((self targetClass categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
%

category: 'private'
method: GsRenameTemporaryRefactoring
dictNameForClass: aClass
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
%

category: 'preconditions'
method: GsRenameTemporaryRefactoring
newNameCollision
	"nil if the new name is free, otherwise a short reason string. The new name
	 collides when it already names another argument or temporary anywhere in the
	 method (an argument must not collide with a temporary, or vice versa), an own or
	 inherited instance variable, an own or inherited class variable, or a
	 pseudo-variable. Comparisons are by symbol identity."
	newNameSym == oldNameSym ifTrue: [^nil].
	(self isPseudoVariable: newNameSym)
		ifTrue: [^'the name ', newName, ' is a reserved pseudo-variable'].
	(self localNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an argument or temporary in this method'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an instance variable'].
	(self visibleClassVarNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already a class variable'].
	^nil
%

category: 'preconditions'
method: GsRenameTemporaryRefactoring
isPseudoVariable: aSymbol
	^#(#self #super #thisContext #nil #true #false) includes: aSymbol
%

category: 'preconditions'
method: GsRenameTemporaryRefactoring
localNames
	"Every argument and temporary name declared anywhere in the method (all scopes),
	 as a Set of Symbols. Read from a FRESH parse so it is never affected by the
	 change-set build's tree mutation."
	| names tree |
	names := IdentitySet new.
	tree := self parseTree.
	tree ifNil: [^names].
	tree nodesDo: [:node |
		(node isMethod or: [node isBlock])
			ifTrue: [node arguments do: [:a | names add: a name asSymbol]].
		node isSequence
			ifTrue: [node temporaries do: [:t | names add: t name asSymbol]]].
	^names
%

category: 'preconditions'
method: GsRenameTemporaryRefactoring
visibleClassVarNames
	"Every class-variable name visible in a method of the defining class: the class's
	 own class variables plus every superclass's, as a Set of Symbols."
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes do: [:cls | cls classVarNames do: [:n | names add: n asSymbol]].
	^names
%

category: 'serializing'
method: GsRenameTemporaryRefactoring
previewJsonString
	^self changeSet jsonString
%

category: 'serializing'
method: GsRenameTemporaryRefactoring
outOfScopeJsonString
	"The scope / precondition payload for the preview, in the same shape the client's
	 paginated panel reads. A temporary/argument rename is confined to one method, so
	 there are never out-of-scope references or skipped methods; the collision and
	 decline reasons (if any) are surfaced here so the panel can refuse and explain."
	^'{"references":0,"skipped":0,"scope":"method"',
	  ',"collision":', (self newNameCollision
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  ',"decline":', (self declineReason
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  '}'
%

category: 'paginated preview'
method: GsRenameTemporaryRefactoring
startPreviewToken: token maxBytes: maxBytes
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus the totals and precondition warnings. Nothing is
	 committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"oldName":', (self jsonQuote: oldName),
	  ',"newName":', (self jsonQuote: newName),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
%

category: 'paginated preview'
method: GsRenameTemporaryRefactoring
pageJsonFrom: startIndex maxBytes: maxBytes
	"A byte-bounded page of staged changes (with source) from startIndex (1-based).
	 At least one change is always emitted when any remain."
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

category: 'applying'
method: GsRenameTemporaryRefactoring
applyDeselected: deselectedIds
	"Apply the staged change in the stone WITHOUT committing (the user commits
	 explicitly). A temporary/argument rename is a SINGLE change, so deselectedIds is
	 inert -- accepted only for signature parity with the other refactorings' apply
	 entry point. Answers {applied, failed:[..]}."
	| applied failures |
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change className with: e messageText)]].
	^'{"applied":', applied printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
%

category: 'applying'
method: GsRenameTemporaryRefactoring
applyChange: aChange
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-temporary: ', aChange kind printString
%

category: 'applying'
method: GsRenameTemporaryRefactoring
applyMethodRecompile: aChange
	"Recompile the one method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
%

category: 'serializing'
method: GsRenameTemporaryRefactoring
jsonQuote: aString
	^'"', (self jsonEscape: aString), '"'
%

category: 'serializing'
method: GsRenameTemporaryRefactoring
jsonEscape: aString
	"JSON string escaping emitting PURE ASCII (control chars and code points above
	 126 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a
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

category: 'serializing'
method: GsRenameTemporaryRefactoring
hex2: anInteger
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
%

category: 'instance creation'
classmethod: GsRenameTemporaryRefactoring
class: aClass selector: aSelector meta: aBool renameTemp: oldNameString to: newNameString atOffset: anOffset
	"Rename the temporary/argument named oldNameString -- the occurrence at anOffset
	 (a 1-based character index into aClass>>aSelector's source) -- to newNameString."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		oldName: oldNameString
		newName: newNameString
		offset: anOffset
%

category: 'instance creation'
classmethod: GsRenameTemporaryRefactoring
environment: anEnvironment class: aClass selector: aSelector meta: aBool oldName: oldNameString newName: newNameString offset: anOffset
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		oldName: oldNameString
		newName: newNameString
		offset: anOffset
%

category: 'paginated preview'
classmethod: GsRenameTemporaryRefactoring
pageForToken: token from: startIndex maxBytes: maxBytes
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
%

category: 'paginated preview'
classmethod: GsRenameTemporaryRefactoring
applyForToken: token deselected: deselectedIds
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
%

category: 'preconditions'
classmethod: GsRenameTemporaryRefactoring
declineReasonForClass: aClass selector: aSelector meta: aBool name: oldNameString atOffset: anOffset
	"The reason a rename of the name at anOffset would be DECLINED -- classifying
	 what the name actually is (an instance variable, an inherited instance
	 variable, a class variable, a global, a pseudo-variable, or not a variable at
	 that position) -- or an empty String if it IS a renamable temporary/argument.
	 Lets the client refuse up front, with a specific reason, before prompting for a
	 new name. The new name is irrelevant here, so it is passed as the old name."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		renameTemp: oldNameString
		to: oldNameString
		atOffset: anOffset) declineReason ifNil: ['']
%

category: 'paginated preview'
classmethod: GsRenameTemporaryRefactoring
clearToken: token
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
%

! Extension methods

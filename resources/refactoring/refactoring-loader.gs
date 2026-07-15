! Class declarations

doit
| cls |
cls := Object subclass: 'GsRefactoringLoader'
  instVarNames: #('dir' 'report')
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
cls category: 'Refactoring-Loader'.
cls comment: '
GsRefactoringLoader is the single server-side source of truth for installing the
Jasper refactoring engine into a stone. Both load paths use it: a human runs the
thin `load-refactoring.gs` bootstrap under topaz, and (from Stage 4.5) the Jasper
client files this class in and sends the same message. Keeping the load LOGIC in
one place -- order, dedicated dictionary, version-branched file-in, and the
post-load completeness check -- means the two paths never drift.

What it does, in order:
  1. ensureDictionary  -- find or create the dedicated `GsRefactoring` symbol
     dictionary and put it at the END of the installing user''s symbol list, so it
     never shadows a base/kernel or later Rowan class. The engine resolves its
     classes through the whole symbol list, so the dict is purely for isolation.
  2. file in the payloads in dependency order:
        ast-core.gs  -- vendored AST substrate (RB* parser/rewriter/nodes)
        compat.gs    -- kernel-method backports, each installed ONLY if the
                        target release lacks it (per-method feature detection,
                        baked into the payload -- never shadows a real method)
        engine.gs    -- our Gs* environment / change-set / rename refactoring
        manifest.gs  -- expected classes + method counts, for the check below
  3. verify           -- a real completeness gate, not a one-class probe:
        - every manifest class present, with at least its expected method count
          (catches a file-in that silently dropped classes or methods),
        - every backported kernel method the AST depends on now resolves,
        - the scanner/formatter class initializers ran (parse + format works),
        - a parse -> rewrite -> regenerate and a tiny rename preview succeed.
  4. commit on success; abort (nothing committed) on any failure, and print a
     readable report either way.

This class is a load-time tool, so it files itself into UserGlobals (not the
GsRefactoring dict, which stays pure engine). Requires a SystemUser session: the
compat backports are kernel-class extensions.
'.
true.
%

removeallmethods GsRefactoringLoader
removeallclassmethods GsRefactoringLoader

! Class implementations

category: 'loading'
method: GsRefactoringLoader
loadFromServerDir: aString
	"Stage, verify, and COMMIT on success -- abort (nothing committed) on any
	 failure. This is the entry point the human bootstrap and the client use."

	self stageFromServerDir: aString.
	self allOk
		ifTrue: [ System commitTransaction ]
		ifFalse: [ System abortTransaction ].
	^self
%

category: 'loading'
method: GsRefactoringLoader
stageFromServerDir: aString
	"File in the payloads in order and run the completeness check, but do NOT
	 commit or abort -- leave the transaction dirty for the caller to decide.
	 Used by SUnit and by a dry-run that wants to inspect the report and then
	 abort without touching the stone."

	dir := aString.
	report := OrderedCollection new.
	[ self ensureDictionary.
	  self fileIn: 'ast-core.gs'.
	  self fileIn: 'compat.gs'.
	  self fileIn: 'engine.gs'.
	  self fileIn: 'manifest.gs' ]
		on: Error
		do: [:e |
			self note: 'File-in' ok: false detail: e messageText.
			^self ].
	self verify.
	^self
%

category: 'loading'
method: GsRefactoringLoader
ensureDictionary
	"Find or create the dedicated GsRefactoring dictionary. Position it at the END
	 of the symbol list so it never shadows base/kernel or Rowan classes, and bind
	 its own name inside it so the bareword `GsRefactoring` (used by the payload's
	 class declarations) resolves. Idempotent."

	| sym prof list dict |
	sym := self class dictionaryName.
	prof := System myUserProfile.
	list := prof symbolList.
	dict := list detect: [:d | d name == sym] ifNone: [nil].
	dict isNil ifTrue: [
		dict := SymbolDictionary new name: sym; yourself.
		dict at: sym put: dict.
		prof insertDictionary: dict at: list size + 1 ].
	^dict
%

category: 'loading'
method: GsRefactoringLoader
dictionary
	^System myUserProfile symbolList
		detect: [:d | d name == self class dictionaryName]
		ifNone: [self ensureDictionary]
%

category: 'loading'
method: GsRefactoringLoader
fileIn: aName
	"File in one payload file. The 3.7+ #serverUtf8File signature is absent
	 pre-3.7, so branch on the release; the payloads are ASCII, so the plain
	 server-path form reads them correctly on the older releases."

	| path |
	path := dir, '/', aName.
	self useUtf8FileIn
		ifTrue: [ GsFileIn fromPath: path on: #serverUtf8File to: nil ]
		ifFalse: [ GsFileIn fromServerPath: path ]
%

category: 'loading'
method: GsRefactoringLoader
useUtf8FileIn
	"True on 3.7.0+, where GsFileIn understands the #serverUtf8File file type.
	 Falls back to the pre-3.7 plain server-path form on any error reading the
	 version -- that form exists on every supported release."

	^[ | parts |
	   parts := self versionParts.
	   (parts at: 1) > 3 or: [ (parts at: 1) = 3 and: [ (parts at: 2) >= 7 ] ] ]
		on: Error do: [:e | false ]
%

category: 'loading'
method: GsRefactoringLoader
versionParts
	"Answer the stone's release as an Array of Integers, e.g. #(3 6 2). Reading
	 the version by String key is safe here because this method is compiled by
	 file-in (byte-String mode), not by the GCI (which would compile the literal
	 as Unicode and fail the dictionary-key comparison on pre-3.7.5 stones)."

	| raw |
	raw := (System gemVersionAt: 'gsRelease') subStrings: ' '.
	^(raw first subStrings: '.') collect: [:p | p asInteger]
%

category: 'verifying'
method: GsRefactoringLoader
verify
	self checkManifest.
	self checkCompat.
	self checkInitializers.
	self checkSmoke.
	^self
%

category: 'verifying'
method: GsRefactoringLoader
checkManifest
	"Assert every expected class loaded with at least its expected method count.
	 Fewer methods than expected means the file-in silently dropped some."

	| dict manifest missing short total |
	dict := self dictionary.
	manifest := dict at: #GsRefactoringManifest ifAbsent: [nil].
	manifest isNil ifTrue: [
		^self note: 'Manifest present' ok: false detail: 'GsRefactoringManifest not found' ].
	missing := OrderedCollection new.
	short := OrderedCollection new.
	total := 0.
	manifest do: [:row |
		| name expected cls actual |
		name := row at: 1.
		expected := row at: 2.
		total := total + 1.
		cls := System myUserProfile symbolList objectNamed: name asSymbol.
		cls isNil
			ifTrue: [ missing add: name ]
			ifFalse: [
				actual := cls selectors size + cls class selectors size.
				actual < expected ifTrue: [
					short add: name, ' (', actual printString, '/', expected printString, ')' ] ] ].
	self note: 'Classes present'
		ok: missing isEmpty
		detail: (missing isEmpty
			ifTrue: [ total printString, ' classes' ]
			ifFalse: [ 'missing:', (self join: missing) ]).
	self note: 'Method counts'
		ok: short isEmpty
		detail: (short isEmpty
			ifTrue: [ 'all classes have their expected methods' ]
			ifFalse: [ 'short:', (self join: short) ])
%

category: 'verifying'
method: GsRefactoringLoader
checkCompat
	"Every AST kernel dependency the target release needed is now resolvable.
	 (Per-method feature detection in compat.gs guarantees none were needlessly
	 installed, so this only has to confirm presence.)"

	| checks missing |
	checks := OrderedCollection new.
	checks add: (Array with: CharacterCollection with: #readStreamPortable).
	checks add: (Array with: SequenceableCollection with: #'lastIndexOf:startingAt:ifAbsent:').
	checks add: (Array with: Integer class with: #'_fromStream:radix:sign:').
	checks add: (Array with: Number class with: #'_finishFromStream:sign:integerPart:').
	checks add: (Array with: Number class with: #'_finishFromStream:sign:integerPart:fractionalPart:expChar:expPart:').
	missing := checks reject: [:c | (c at: 1) canUnderstand: (c at: 2)].
	self note: 'Compat methods resolve'
		ok: missing isEmpty
		detail: (missing isEmpty
			ifTrue: [ 'all AST kernel dependencies present' ]
			ifFalse: [ (missing collect: [:c | (c at: 2)]) printString ])
%

category: 'verifying'
method: GsRefactoringLoader
resolve: aSymbol
	"Resolve a class the loader INSTALLS by name through the symbol list, rather
	 than as a compile-time bareword. The loader is filed in before the AST and
	 engine exist, so a bareword reference to (e.g.) RBParser would fail to
	 compile on a clean stone -- resolving at runtime avoids that."

	^System myUserProfile symbolList objectNamed: aSymbol
%

category: 'verifying'
method: GsRefactoringLoader
checkInitializers
	"The scanner character tables and formatter defaults are set by class-side
	 initializers that topaz file-in does not auto-run; the payload runs them
	 explicitly. Confirm functionally: parsing and formatting a method needs both."

	| ok detail |
	ok := true.
	detail := 'parse + format works'.
	[ | tree |
	  tree := (self resolve: #RBParser) parseMethod: 'm ^foo + foo'.
	  tree formattedCode isString ifFalse: [
		ok := false. detail := 'formattedCode did not answer a String' ] ]
		on: Error do: [:e | ok := false. detail := e messageText].
	self note: 'Initializers ran (scanner/formatter)' ok: ok detail: detail
%

category: 'verifying'
method: GsRefactoringLoader
checkSmoke
	"End-to-end: parse -> rewrite -> regenerate, plus a real rename preview on a
	 throwaway fixture that is removed before commit (never persisted)."

	| ok detail |
	ok := true.
	detail := 'parse / rewrite / rename preview OK'.
	[ self runSmoke ] on: Error do: [:e | ok := false. detail := e messageText].
	self note: 'Functional smoke (parse/rewrite/rename)' ok: ok detail: detail
%

category: 'verifying'
method: GsRefactoringLoader
runSmoke
	| tree fixture preview |
	tree := (self resolve: #RBParser) parseExpression: 'foo + foo'.
	tree formattedCode.
	fixture := Object
		subclass: 'GsRefactoringSmokeFixture'
		instVarNames: #('alpha')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: self dictionary.
	fixture
		compileMethod: 'alpha ^alpha'
		dictionaries: System myUserProfile symbolList
		category: 'smoke'.
	preview := ((self resolve: #GsRenameInstanceVariableRefactoring)
		class: fixture renameInstVar: 'alpha' to: 'beta') previewJsonString.
	self dictionary removeKey: #GsRefactoringSmokeFixture.
	preview isString ifFalse: [ ^self error: 'preview did not answer a String' ]
%

category: 'reporting'
method: GsRefactoringLoader
note: aLabel ok: aBool detail: aString
	report add: (Array with: aLabel with: aBool with: aString)
%

category: 'reporting'
method: GsRefactoringLoader
allOk
	^report allSatisfy: [:row | row at: 2]
%

category: 'reporting'
method: GsRefactoringLoader
report
	"The raw rows: each is #(label okBoolean detailString). Consumed by the
	 Stage-4.5 client loader as well as #reportString."

	^report
%

category: 'reporting'
method: GsRefactoringLoader
join: aCollection
	^aCollection inject: '' into: [:acc :each | acc, ' ', each]
%

category: 'reporting'
method: GsRefactoringLoader
reportString
	| ws lf |
	lf := Character lf.
	ws := WriteStream on: String new.
	ws nextPutAll: '[GsRefactoring] --- install report ---'; nextPut: lf.
	report do: [:row |
		ws nextPutAll: '[GsRefactoring]   '.
		ws nextPutAll: ((row at: 2) ifTrue: ['[ ok ] '] ifFalse: ['[FAIL] ']).
		ws nextPutAll: (row at: 1); nextPutAll: ' -- '; nextPutAll: (row at: 3); nextPut: lf].
	ws nextPutAll: '[GsRefactoring] '.
	ws nextPutAll: (self allOk
		ifTrue: ['SUCCESS -- all completeness checks passed.']
		ifFalse: ['INCOMPLETE -- one or more checks failed (see above).']).
	ws nextPut: lf.
	^ws contents
%

category: 'reporting'
method: GsRefactoringLoader
printReport
	"Write the report to the gem's stdout. Optional convenience for headless /
	 cron callers; the topaz bootstrap uses `reportString displayNl` and the
	 client reads #report / #reportString directly, so #loadFromServerDir: does
	 not call this."

	[ GsFile stdout nextPutAll: self reportString ]
		on: Error do: [:e | nil]
%

category: 'loading'
classmethod: GsRefactoringLoader
loadFromServerDir: aString
	"Install the engine from the payload directory aString (a server-side path
	 the gem can read -- a local stone). Answers the loader, whose #reportString
	 and #allOk describe the outcome."

	^self new loadFromServerDir: aString
%

category: 'constants'
classmethod: GsRefactoringLoader
dictionaryName
	"The dedicated, isolated symbol dictionary the engine classes live in."

	^#GsRefactoring
%

! Extension methods

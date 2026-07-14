"
One individually-addressable change in a GsRefactoringChangeSet: a method to
recompile, or a class definition to edit. A change carries the old and new
source so a client can render a before/after diff, and an id so a client can
select which changes to apply. Building a change compiles and commits nothing.
"
Class {
	#name : 'GsRefactoringChange',
	#superclass : 'Object',
	#instVars : [
		'id',
		'kind',
		'dictName',
		'className',
		'isMeta',
		'selector',
		'category',
		'oldSource',
		'newSource'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRefactoringChange class >> classDefinitionEditId: anId dictName: dn className: cn oldSource: os newSource: ns [
	^self new
		setId: anId kind: #classDefinitionEdit dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns
]

{ #category : 'instance creation' }
GsRefactoringChange class >> methodRecompileId: anId dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns [
	^self new
		setId: anId kind: #methodRecompile dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
]

{ #category : 'accessing' }
GsRefactoringChange >> className [
	^className
]

{ #category : 'accessing' }
GsRefactoringChange >> dictName [
	^dictName
]

{ #category : 'serializing' }
GsRefactoringChange >> hex2: anInteger [
	"Two lowercase hex digits for a 0..255 code point."
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]

{ #category : 'accessing' }
GsRefactoringChange >> id [
	^id
]

{ #category : 'accessing' }
GsRefactoringChange >> category [
	^category
]

{ #category : 'accessing' }
GsRefactoringChange >> isMeta [
	^isMeta
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonEscape: aString on: aStream [
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
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonOn: aStream [
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
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonValue: aValue on: aStream [
	"Emit aValue as a JSON string (or null). Symbols/Strings both render as
	 their characters; nil renders as the JSON null literal."
	aValue isNil ifTrue: [^aStream nextPutAll: 'null'].
	aStream nextPut: $".
	self jsonEscape: aValue asString on: aStream.
	aStream nextPut: $"
]

{ #category : 'accessing' }
GsRefactoringChange >> kind [
	^kind
]

{ #category : 'accessing' }
GsRefactoringChange >> newSource [
	^newSource
]

{ #category : 'accessing' }
GsRefactoringChange >> oldSource [
	^oldSource
]

{ #category : 'accessing' }
GsRefactoringChange >> selector [
	^selector
]

{ #category : 'private' }
GsRefactoringChange >> setId: anId kind: aKind dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns [
	id := anId.
	kind := aKind.
	dictName := dn.
	className := cn.
	isMeta := aBool.
	selector := sel.
	category := cat.
	oldSource := os.
	newSource := ns
]

"
GemStone/S 3.6.2 compatibility shim for the vendored RowanV3 AST-Core.
Copied verbatim from the GemStone 3.7.5 kernel. See CharacterCollection.extension.st
for the loading contract (3.6.2-only, feature-detected).
"
Extension { #name : 'SequenceableCollection' }

{ #category : '*ast-core-compat-362' }
SequenceableCollection >> lastIndexOf: anElement startingAt: lastIndex ifAbsent: exceptionBlock [
	"Answer the index of the last occurence of anElement within the
	receiver. If the receiver does not contain anElement, answer the
	result of evaluating the argument, exceptionBlock."

	lastIndex to: 1 by: -1 do: [ :index |
		(self at: index) = anElement
			ifTrue: [ ^ index ] ].
	^ exceptionBlock ~~ nil
		ifTrue: [ exceptionBlock value ]
		ifFalse: [ 0 ]
]

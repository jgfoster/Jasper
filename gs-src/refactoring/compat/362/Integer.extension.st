"
GemStone/S 3.6.2 compatibility shim for the vendored RowanV3 AST-Core.
Copied verbatim from the GemStone 3.7.5 kernel. See CharacterCollection.extension.st
for the loading contract (3.6.2-only, feature-detected).
"
Extension { #name : 'Integer' }

{ #category : '*ast-core-compat-362' }
Integer class >> _fromStream: aStream radix: aRadix sign: signArg [
  "parse
      [ '-' ] Numerics
   portions of
     RadixedLiteral = Digits ( '#' | 'r' ) Numerics
     RadixedLiteralNegBody =  Digits ( '#' | 'r' ) '-' Numerics

   a Sign in the body is illegal if a sign came before Digits "
  | result sign ch digit |
	result := 0.
  sign := signArg .
	(ch := aStream peek == $- ) ifTrue:[
    sign ifNotNil: [^self _errIncorrectFormat: aStream].
		aStream next.
		sign := $-
  ] ifFalse:[
    (ch == $+ ) ifTrue:[
      sign ifNotNil: [^self _errIncorrectFormat: aStream].
			aStream next.
			sign := $+
    ]
  ].
  [ (ch := aStream peek) ~~ nil and:[ (digit := ch digitValueInRadix: aRadix) ~~ nil ] ] whileTrue:[
     ch := aStream next.
		result := (result * aRadix) + digit .
  ].
  sign == $- ifTrue:[ ^ 0 - result ].
  ^ result
]

"
GemStone/S 3.6.2 compatibility shim for the vendored RowanV3 AST-Core.
Copied verbatim from the GemStone 3.7.5 kernel. See CharacterCollection.extension.st
for the loading contract (3.6.2-only, feature-detected).

These two class methods complete the number-literal parse begun by the vendored
`Number class >> rwFromStream:` (AST-Kernel-Core). BinaryFloat class resolves
`_finishFromStream:sign:integerPart:` here by inheritance from Number class.
"
Extension { #name : 'Number' }

{ #category : '*ast-core-compat-362' }
Number class >> _finishFromStream: aStream sign: signChar integerPart: integerPart [
  "parse this subset of the BNF
   Number = [ '-' ] NumericLiteral                      (excluding RadixLiteral* )
   BinaryExponent = ( 'e' | 'E' | 'd' | 'D' | 'q' ) ['-' | '+'] Digits
   DecimalExponent = ( 'f' | 'F' ) ['-' | '+'] Digits
   Digit = '0' | '1' | '2' | ... | '9'
   Digits = Digit {Digit}
   Exponent = BinaryExponent | DecimalExponent | ScaledDecimalExponent | FixedPointExponent
   FractionalPart = '.' Digits [Exponent]
   FixedPointExponent = 'p' [ ['-' | '+'] Digits ]
   Numeric = Digit | 'A' | 'B' | ... | 'Z'
   NumericLiteral = Digits ( [FractionalPart] | [Exponent] )
   Numerics = Numeric { Numeric }
   ScaledDecimalExponent = 's' [ ['-' | '+'] Digits ]
"
  | fractionalPart ch  expon exponChar |
  fractionalPart := String new.
  [ (ch := aStream peek) ~~ nil and: [ ch isDigit ] ] whileTrue: [
    aStream next.
    fractionalPart add: ch.
  ].
  expon := String new .
  exponChar := $e .
  (#( $e $E $f $F $s $q $p $d $D ) includesIdentical: ch) ifTrue:[
     "parse Digits for Exponent"
     exponChar := ch .
     aStream next.
     (aStream peek == $- )
       ifTrue:[ aStream next . expon add:  $-  ]
       ifFalse:[ (aStream peek == $+ ) ifTrue: [ aStream next ] ].
     [ (ch := aStream peek) ~~ nil and: [ ch isDigit ] ] whileTrue: [
        aStream next.
        expon add: ch .
     ].
  ].
  ^ Number _finishFromStream: aStream sign: signChar integerPart: integerPart
        fractionalPart: fractionalPart expChar: exponChar expPart: expon
]

{ #category : '*ast-core-compat-362' }
Number class >> _finishFromStream: aStream sign: sign integerPart: integerPart fractionalPart: fractStr expChar: expChar expPart: expString [
  "create appropriate Number from the pieces "

  | aString |
  aString :=  String new .
  sign == $- ifTrue:[ aString add: sign ].
  aString addAll: integerPart asString ;
     add: (Locale decimalPoint at: 1) ;
     addAll: fractStr .
  (expChar == $s) ifTrue:[
    aString add: expChar ; addAll: expString .
    ^ ScaledDecimal fromString: aString
  ].
  (expChar == $p) ifTrue:[
    aString add: expChar ; addAll: expString .
    ^ FixedPoint fromString: aString
  ].
  expString size ~~ 0 ifTrue:[
     aString add: expChar ; addAll: expString .
  ].
  (expChar isEquivalent: $f) ifTrue: [^DecimalFloat fromString: aString].
  ^ Float fromString: aString
]

"A ""complete"" Smalltalk syntax for code (not methods)"
| byteArray literalArray runtimeArray y |
(nil isNil and: [true & false not]) ifFalse: [self halt].
y := thisContext stack size + super size.
byteArray := #[2 2r100 8r20 16rFF].
literalArray := #($a #a #'a' #+ #foo: 'I''m' 1.0 1.23e2 3.14s2 -42).
(runtimeArray := {1 + byteArray size. literalArray})
    do: [:each | 
        | var |
        var := Transcript
            show: each class name;
            show: each printString].
literalArray select: #isNumber thenCollect: [:each |
    each perform: #* with: x].
^x < 6
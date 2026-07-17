set compile_env: 0
! ------------------- Class definition for GsMcpMockSocket
expectvalue /Class
doit
Object subclass: 'GsMcpMockSocket'
  instVarNames: #( input pos chunkSize
                    outStream closed)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()

%
expectvalue /Class
doit
GsMcpMockSocket category: 'GsMcp'
%
! ------------------- Remove existing behavior from GsMcpMockSocket
removeallmethods GsMcpMockSocket
removeallclassmethods GsMcpMockSocket
! ------------------- Class methods for GsMcpMockSocket
category: 'instance creation'
classmethod: GsMcpMockSocket
on: aRequestString
  "A mock socket pre-loaded with a raw HTTP request, delivering it in one chunk."
  ^self on: aRequestString chunkSize: 1000000
%
category: 'instance creation'
classmethod: GsMcpMockSocket
on: aRequestString chunkSize: anInteger
  "chunkSize caps each readString: result, to exercise multi-read / partial-read paths."
  ^self new setInput: aRequestString chunkSize: anInteger
%
! ------------------- Instance methods for GsMcpMockSocket
category: 'socket protocol'
method: GsMcpMockSocket
close
  closed := true
%
category: 'accessing'
method: GsMcpMockSocket
isClosed
  ^closed
%
category: 'accessing'
method: GsMcpMockSocket
output
  "The raw bytes the server wrote back (the HTTP response)."
  ^outStream contents
%
category: 'socket protocol'
method: GsMcpMockSocket
readString: maxBytes
  "Return up to (maxBytes min: chunkSize) bytes from the remaining input, or '' at EOF."
  | avail take s |
  avail := input size - pos + 1.
  avail <= 0 ifTrue: [^''].
  take := (maxBytes min: chunkSize) min: avail.
  s := input copyFrom: pos to: pos + take - 1.
  pos := pos + take.
  ^s
%
category: 'socket protocol'
method: GsMcpMockSocket
readWillNotBlockWithin: ms
  "Data is always 'ready' in the mock (or we are at EOF, where readString: returns empty)."
  ^true
%
category: 'initialization'
method: GsMcpMockSocket
setInput: aRequestString chunkSize: anInteger
  input := aRequestString.
  pos := 1.
  chunkSize := anInteger.
  outStream := WriteStream on: String new.
  closed := false.
  ^self
%
category: 'socket protocol'
method: GsMcpMockSocket
write: aString
  outStream nextPutAll: aString.
  ^aString size
%

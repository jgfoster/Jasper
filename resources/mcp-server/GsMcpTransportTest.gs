set compile_env: 0
! ------------------- Class definition for GsMcpTransportTest
expectvalue /Class
doit
GsTestCase subclass: 'GsMcpTransportTest'
  instVarNames: #( server)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: Published
  options: #()

%
! ------------------- Remove existing behavior from GsMcpTransportTest
removeallmethods GsMcpTransportTest
removeallclassmethods GsMcpTransportTest
! ------------------- Class methods for GsMcpTransportTest
! ------------------- Instance methods for GsMcpTransportTest
category: 'helpers'
method: GsMcpTransportTest
bodyOf: response
  "The body bytes of an HTTP response (everything after the blank line)."
  | sep idx |
  sep := self crlf , self crlf.
  idx := response indexOfSubCollection: sep.
  ^idx = 0 ifTrue: [''] ifFalse: [response copyFrom: idx + 4 to: response size]
%
category: 'helpers'
method: GsMcpTransportTest
crlf
  ^String with: Character cr with: Character lf
%
category: 'helpers'
method: GsMcpTransportTest
postRequest: body
  "A raw HTTP POST /mcp request carrying body as application/json."
  | crlf |
  crlf := self crlf.
  ^'POST /mcp HTTP/1.1' , crlf , 'Host: localhost' , crlf ,
   'Content-Type: application/json' , crlf ,
   'Content-Length: ' , body size printString , crlf , crlf , body
%
category: 'helpers'
method: GsMcpTransportTest
runRequest: rawRequest
  "Drive handleConnection: with rawRequest; answer the mock (whose #output holds the
   captured response). Named runRequest: (NOT run:) to avoid shadowing TestCase>>run:."
  ^self runRequest: rawRequest chunkSize: 1000000
%
category: 'helpers'
method: GsMcpTransportTest
runRequest: rawRequest chunkSize: n
  "The server is a stack local so the framework's between-test instance-variable
   nilling cannot disturb it."
  | mock |
  mock := GsMcpMockSocket on: rawRequest chunkSize: n.
  GsMcpServer new handleConnection: (GsMcpHttpConnection on: mock).
  ^mock
%
category: 'running'
method: GsMcpTransportTest
setUp
  "No per-test state: each helper builds its own server as a stack local."
  ^self
%
category: 'helpers'
method: GsMcpTransportTest
simpleRequest: httpMethod
  "A raw HTTP request with the given verb, no body."
  | crlf |
  crlf := self crlf.
  ^httpMethod , ' /mcp HTTP/1.1' , crlf , 'Host: localhost' , crlf , crlf
%
category: 'tests'
method: GsMcpTransportTest
testChunkedDeliveryParses
  "Even when the request arrives a few bytes at a time, readRequest must reassemble it."
  | out |
  out := (self runRequest: (self postRequest: '{"jsonrpc":"2.0","id":3,"method":"initialize","params":{}}') chunkSize: 7) output.
  self assert: (out includesString: '"protocolVersion"')
%
category: 'tests'
method: GsMcpTransportTest
testContentLengthMatchesBody
  | out body lines clenLine clenValue |
  out := (self runRequest: (self postRequest: '{"jsonrpc":"2.0","id":4,"method":"tools/list"}')) output.
  body := self bodyOf: out.
  lines := out subStrings: self crlf.
  clenLine := lines detect: [:l | (l asLowercase indexOfSubCollection: 'content-length:') = 1] ifNone: [nil].
  self deny: clenLine isNil.
  clenValue := (clenLine copyFrom: (clenLine indexOf: $:) + 1 to: clenLine size) trimSeparators asNumber.
  self assert: clenValue equals: body size
%
category: 'tests'
method: GsMcpTransportTest
testDeleteReturns200
  self assert: ((self runRequest: (self simpleRequest: 'DELETE')) output includesString: 'HTTP/1.1 200 OK')
%
category: 'tests'
method: GsMcpTransportTest
testEofClosesConnectionWithoutResponse
  | mock |
  mock := GsMcpMockSocket on: ''.
  GsMcpServer new handleConnection: (GsMcpHttpConnection on: mock).
  self assert: mock isClosed.
  self assert: mock output isEmpty
%
category: 'tests'
method: GsMcpTransportTest
testGetOpensSseStream
  | out |
  out := (self runRequest: (self simpleRequest: 'GET')) output.
  self assert: (out includesString: 'text/event-stream').
  self assert: (out includesString: ': connected')
%
category: 'tests'
method: GsMcpTransportTest
testMalformedBodyReturnsParseError
  | out |
  out := (self runRequest: (self postRequest: 'this is not json')) output.
  self assert: (out includesString: '-32700')
%
category: 'tests'
method: GsMcpTransportTest
testPostInitialize
  | out |
  out := (self runRequest: (self postRequest: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')) output.
  self assert: (out includesString: 'HTTP/1.1 200 OK').
  self assert: (out includesString: 'application/json').
  self assert: (out includesString: '"protocolVersion"').
  self assert: (out includesString: '"serverInfo"')
%
category: 'tests'
method: GsMcpTransportTest
testPostToolCall
  | out |
  out := (self runRequest: (self postRequest: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_code","arguments":{"code":"6 * 7"}}}')) output.
  self assert: (out includesString: '"text":"42"').
  self assert: (out includesString: '"isError":false')
%
category: 'tests'
method: GsMcpTransportTest
testUnknownVerbReturns405
  self assert: ((self runRequest: (self simpleRequest: 'PUT')) output includesString: '405 Method Not Allowed')
%

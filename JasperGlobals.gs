! ------- Create dictionary if it is not present
run
| aSymbol names userProfile |
aSymbol := #'JasperGlobals'.
userProfile := System myUserProfile.
names := userProfile symbolList names.
(names includes: aSymbol) ifFalse: [
	| symbolDictionary |
	symbolDictionary := SymbolDictionary new name: aSymbol; yourself.
	userProfile insertDictionary: symbolDictionary at: names size + 1.
].
%
set compile_env: 0
! ------------------- Class definition for Jasper
expectvalue /Class
doit
WebApp subclass: 'Jasper'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: JasperGlobals
  options: #()

%
expectvalue /Class
doit
Jasper category: 'Kernel'
%

! ------------------- Remove existing behavior from Jasper
expectvalue /Metaclass3
doit
Jasper removeAllMethods.
Jasper class removeAllMethods.
%
! ------------------- Class methods for Jasper
set compile_env: 0
category: 'other'
classmethod: Jasper
htdocs

	^System gemEnvironmentVariable: 'HTDOCS'
%
category: 'other'
classmethod: Jasper
httpServerClass

	^HttpsServer
%
category: 'other'
classmethod: Jasper
workerCount
	"generate primary responses from the main server gem"

	^0
%
! ------------------- Instance methods for Jasper
set compile_env: 0
category: 'other'
method: Jasper
allowedSelectors

	^#('gems' 'signIn' 'stone')
%
category: 'other'
method: Jasper
buildResponse
	"We are willing to be called from any application.
	We always respond with JSON content."

	response
		accessControlAllowOrigin: '*';
		accessControlAllowHeaders: 'X-PINGOTHER, Content-Type';
		contentType: 'text/json';
		yourself.
	request method = 'OPTIONS' ifTrue: [^self].
	super buildResponse.
%
category: 'other'
method: Jasper
gems

	| dict keys list timeGmt |
	keys := #(
		"1-10"	'user' 'pid' 'host' 'prim' 'viewAge' 'state' 'trans' 'oldestCR' 'serial' 'id'
		"11-20"	'ip' 'priority' 'hostId' 'quiet' 'age' 'backlog' 'type' 'objects' 'pages' 'vote'
		"21-24"	'gci' 'kerberos' 'agent' 'port'
	).
	list := {}.
	timeGmt := System timeGmt.
	System currentSessions do: [:each |
		(System descriptionOfSession: each) ifNotNil: [:anArray |
			anArray size: keys size.
			anArray at: 1 put: (anArray at: 1) userId.
			#(5 14 15) do: [:i |
				(anArray at: i) ifNotNil: [:value | anArray at: i put: (self stringFromSeconds: timeGmt - value)].
			].
			(anArray at: 22) ifNotNil: [:value | anArray at: 22 put: value name].
			dict := Dictionary new.
			1 to: anArray size do: [:i |
				dict at: (keys at: i) put: (anArray at: i).
			].
			dict at: 'descr' put: ((System gemCacheStatisticsForSessionId: each) at: 1).
			list add: dict.
		].
	].
	response
		content: list asJson;
		yourself.
%
category: 'other'
method: Jasper
sessions

	^SessionTemps at: 'sessions' ifAbsentPut: [IntegerKeyValueDictionary new]
%
category: 'other'
method: Jasper
signIn

	| data session |
	[
		| id |
		data := JsonParser parse: request bodyContents.
		session := GsExternalSession newDefault
			username: (data at: 'userID');
			password: (data at: 'password');
			login.
		id := Random new smallInteger.
		data := Dictionary with: 'session' -> id.
		session logout.
	] on: Error do: [:ex |
		data := Dictionary with: 'error' -> ex description.
	].
	response
		content: data asJson;
		yourself.
%
category: 'other'
method: Jasper
stone

	| config dict version |
	config := {}.
	version := {}.
	dict := System stoneConfigurationReport.
	dict keys asSortedCollection do: [:each |
		config add: { each. dict at: each }.
	].
	dict := System stoneVersionReport.
	dict keys asSortedCollection do: [:each |
		version add: { each. dict at: each }.
	].
	dict := Dictionary new
		at: 'config'		put: config;
		at: 'history'		put: DbfHistory;
		at: 'version'	put: version;
		yourself.
	response content: dict asJson.
%
category: 'other'
method: Jasper
stringFromSeconds: anInteger

	| x |
	(x := anInteger) ifNil: [^''].
	x < 120 ifTrue: [^x printString , ' secs'].
	(x := x // 60) < 120 ifTrue: [^x printString , ' mins'].
	(x := x // 60) < 48 ifTrue: [^x printString , ' hrs'].
	x := x // 24.
	^x printString , ' days'.
%

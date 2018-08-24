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
Jasper comment:
'No class-specific documentation for Jasper, hierarchy is:
Object
  WebApp( begin end exception html request response)
    Jasper
'
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
category: 'overrides'
classmethod: Jasper
htdocs

	^System gemEnvironmentVariable: 'HTDOCS'
%
category: 'overrides'
classmethod: Jasper
httpServerClass

	^HttpsServer
%
category: 'overrides'
classmethod: Jasper
workerCount
	"generate primary responses from the main server gem"

	^0
%
set compile_env: 0
category: 'services'
classmethod: Jasper
gem

	| config dict version |
	config := {}.
	version := {}.
	dict := System gemConfigurationReport.
	dict keys asSortedCollection do: [:each |
		config add: { each. dict at: each }.
	].
	dict := System gemVersionReport.
	dict keys asSortedCollection do: [:each |
		version add: { each. dict at: each }.
	].
	dict := Dictionary new
		at: 'config'		put: config;
		at: 'user'		put: System myUserProfile userId;
		at: 'session'	put: System session;
		at: 'version'	put: version;
		yourself.
	^dict asJson.
%
! ------------------- Instance methods for Jasper
set compile_env: 0
category: 'private'
method: Jasper
allowedSelectors

	^#('home' 'gem' 'gems' 'signIn' 'signOut' 'stats' 'stone' 'workspace')
%
category: 'private'
method: Jasper
buildResponse
	"We are willing to be called from any application.
	We always respond with JSON content."

	response
		accessControlAllowOrigin: '*';
		accessControlAllowHeaders: 'X-PINGOTHER, Content-Type';
		contentType: 'application/json; charset=utf-8';
		yourself.
	request method = 'OPTIONS' ifTrue: [^self].
	super buildResponse.
%
category: 'private'
method: Jasper
sessions

	^SessionTemps current
		at: #'sessions'
		ifAbsentPut: [Dictionary new]
%
category: 'private'
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
set compile_env: 0
category: 'public'
method: Jasper
gem

	| data |
	[
		| remoteData session |
		data := JsonParser parse: request bodyContents.
		data isPetitFailure ifTrue: [self error: data message].
		session := self sessions at: (data at: 'session').
		remoteData := session send: #'gem' to: self class asOop.
		data := (JsonParser parse: remoteData)
			at: 'success' put: true;
			yourself.
	] on: Error do: [:ex |
		data := Dictionary new
			at: 'success' put: false;
			at: 'error' put: ex description;
			yourself.
	].
	response
		content: data asJson;
		yourself.
%
category: 'public'
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
category: 'public'
method: Jasper
home

	| data |
	data := Dictionary new
		at: 'stoneName' put: (System stoneName subStrings: $!) last;
		at: 'stoneVersion' put: (System stoneVersionAt: #'gsVersion');
		at: 'userID' put: System myUserProfile userId;
		at: 'sessionCount' put: System currentSessions size;
		at: 'repositorySizeMB' put: (SystemRepository fileSize / 1024 / 1024) ceiling;
		at: 'freeSpaceMB' put: (SystemRepository freeSpace / 1024 / 1024) floor;
		at: 'commitRecordBacklog' put: (System stoneCacheStatisticWithName: 'CommitRecordCount');
		yourself.
	response content: data asJson.
%
category: 'public'
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
		id := Random new smallInteger abs printStringRadix: 36.
		self sessions at: id put: session.
		data := Dictionary new
			at: 'success' put: true;
			at: 'session' put: id;
			yourself.
	] on: Error do: [:ex |
		data := Dictionary new
			at: 'success' put: false;
			at: 'error' put: ex description;
			yourself.
	].
	response
		content: data asJson;
		yourself.
%
category: 'public'
method: Jasper
signOut

	| data |
	[
		| session |
		data := JsonParser parse: request bodyContents.
		data isPetitFailure ifTrue: [self error: data message].
		session := self sessions removeKey: (data at: 'session').
		session forceLogout.
		data := Dictionary new
			at: 'success' put: true;
			yourself.
	] on: Error do: [:ex |
		data := Dictionary new
			at: 'success' put: false;
			at: 'error' put: ex description;
			yourself.
	].
	response
		content: data asJson;
		yourself.
%
category: 'public'
method: Jasper
stats

	| data dict duration layout options random time |
	data 		:= Dictionary new
		at: 'name'	put: 'Commit Record Backlog';
		at: 'type'	put: 'candlestick';
		at: 'x'		put: Array new;
		at: 'close'	put: Array new;
		at: 'high'	put: Array new;
		at: 'low'		put: Array new;
		at: 'open'	put: Array new;
		yourself.
	time := DateAndTime now - (Duration seconds: 100 * 6).
	duration := Duration seconds: 6.
	random := Random new.
	100 timesRepeat: [
		| values |
		values := (random integers: 4 between: 1 and: 100) asSortedCollection.
		(data at: 'low') 	add: (values at: 1).
		(data at: 'open') 	add: (values at: 2).
		(data at: 'close') 	add: (values at: 3).
		(data at: 'high') 	add: (values at: 4).
		(data at: 'x')		add: time printStringWithRoundedSeconds.
		time := time + duration.
	].
	layout 	:= Dictionary new
		at: 'title'			put: 'Commit Record Backlog';
		yourself.
	options 	:= Dictionary new.
	dict 		:= Dictionary new
		at: 'data'		put: (Array with: data);
		at: 'layout'		put: layout;
		at: 'options'	put: options;
		yourself.
	response content: dict asJson.
%
category: 'public'
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
category: 'public'
method: Jasper
workspace

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

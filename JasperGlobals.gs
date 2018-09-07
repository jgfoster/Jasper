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
! ------------------- Class definition for Jasper
expectvalue /Class
doit
WebApp subclass: 'Jasper'
  instVarNames: #( data result jasper
                    session)
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
browser: aString

	| class classCategories classes dict dictionary dictionaries methodCategories methods selectedOop selections |
	selections := JsonParser parse: aString.
	dictionaries := Array new.
	selectedOop := selections at: 'dictionary' ifAbsent: [nil].
	System myUserProfile symbolList do: [:each |
		each asOop == selectedOop ifTrue: [dictionary := each].
		dictionaries add: (Dictionary new
			at: 'name' put: each name;
			at: 'oop' put: each asOop;
			at: 'color' put: (each == selectedOop ifTrue: ['red'] ifFalse: []); yourself).
	].
	classCategories := Array new.
	classes := Array new.
	selectedOop := selections at: 'class' ifAbsent: [nil].
	dictionary ifNotNil: [
		dictionary keys asSortedCollection do: [:eachKey |
			| global |
			global := dictionary at: eachKey.
			global isBehavior ifTrue: [
				global asOop == selectedOop ifTrue: [class := global].
				classes size < 10 ifTrue: [
					classes add: (Dictionary new
						at: 'name' put: eachKey;
						at: 'oop' put: global asOop;
						at: 'color' put: (global == class ifTrue: ['red'] ifFalse: []);
						yourself).
				].
			].
		].
	].
	methodCategories := Array new.
	methods := Array new.
	dict := Dictionary new
		at: 'dictionaries'			put: dictionaries;
		at: 'classCategories'		put: classCategories;
		at: 'classes'				put: classes;
		at: 'methodCategories'	put: methodCategories;
		at: 'methods'				put: methods;
		yourself.
	^dict asJson.
%
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
category: 'services'
classmethod: Jasper
home

	^Dictionary new
		at: 'stone' put: (System stoneName subStrings: $!) last;
		at: 'version' put: (System stoneVersionAt: #'gsVersion');
		at: 'user' put: System myUserProfile userId;
		at: 'session' put: System session;
		at: 'sessions' put: System currentSessions size;
		at: 'repositorySizeMB' put: (SystemRepository fileSize / 1024 / 1024) ceiling;
		at: 'freeSpaceMB' put: (SystemRepository freeSpace / 1024 / 1024) floor;
		at: 'commitRecordBacklog' put: (System stoneCacheStatisticWithName: 'CommitRecordCount');
		asJson
%
! ------------------- Instance methods for Jasper
set compile_env: 0
category: 'private'
method: Jasper
allowedSelectors

	^#('browser' 'evaluate' 'footer' 'home' 'gem' 'gems' 'signIn' 'signOut' 'softBreak' 'stats' 'stone')
%
category: 'private'
method: Jasper
buildResponse
	"We are willing to be called from any application.
	We always respond with JSON content."

	HttpServer log: #'debug' string: 'Jasper>>buildResponse - 1'.
	response
		accessControlAllowOrigin: '*';
		accessControlAllowHeaders: 'X-PINGOTHER, Content-Type';
		contentType: 'application/json; charset=utf-8';
		yourself.
	HttpServer log: #'debug' string: 'Jasper>>buildResponse - 2'.
	request method = 'OPTIONS' ifTrue: [^self].
	HttpServer log: #'debug' string: 'Jasper>>buildResponse - 3'.
	super buildResponse.
	HttpServer log: #'debug' string: 'Jasper>>buildResponse - 4'.
%
category: 'private'
method: Jasper
buildResponseFor: aString

	| endTime startTime |
	HttpServer log: #'debug' string: 'Jasper>>buildResponseFor: ' , aString printString.
	startTime := Time millisecondClockValue.
	result := Dictionary new
		at: 'success' put: true;
		yourself.
	[
		data := request bodyContents
			ifNil: [Dictionary new]
			ifNotNil: [:value | JsonParser parse: value].
		data isPetitFailure ifTrue: [self error: data message].
		HttpServer log: #'debug' string: 'Jasper>>buildResponseFor: - 2 - ' , data class name.
		session := self sessions at: (data removeKey: 'session' ifAbsent: [nil]) ifAbsent: [nil].
		super buildResponseFor: aString.
	] on: Admonition, Error do: [:ex |
		HttpServer log: #'debug' string: 'Jasper>>buildResponseFor: - 3 - ' , ex description.
		result
			at: 'success' put: false;
			at: 'error' put: ex description;
			yourself.
	].
	endTime := Time millisecondClockValue.
	result at: 'time' put: endTime - startTime.
	response
		content: result asJson;
		yourself.
%
category: 'private'
method: Jasper
serverSend: aSymbol

	| remoteData |
	session abort.
	[
		remoteData := session send: aSymbol to: self class asOop.
	] on: Admonition , Error do: [:ex |
		result
			at: 'success' put: false;
			at: 'error' put: ex description;
			yourself.
		remoteData := '{}'.
	].
	session commit.
	(JsonParser parse: remoteData) keysAndValuesDo: [:eachKey :eachValue | result at: eachKey put: eachValue].
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
browser

	| remoteData string |
	string := data asJson.
	string := session abort; executeString: 'Jasper browser: ' , string printString.
	session commit.
	remoteData := JsonParser parse: string.
	remoteData  keysAndValuesDo: [:eachKey :eachValue | result at: eachKey put: eachValue].
%
category: 'public'
method: Jasper
evaluate

	| myResult string |
	string := data at: 'string'.
	myResult := session abort; executeString: string.
	session commit.
	myResult := (myResult isKindOf: Array)
		ifTrue: ['(Object _objectForOop: ' , myResult first printString , ') "' , (session send: #'printString' to: myResult first) , '"']
		ifFalse: [myResult printString].
	result
		at: 'result'
		put: myResult
%
category: 'public'
method: Jasper
gem

	self serverSend: #'gem'.
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
	result
		at: 'gems'
		put: list.
%
category: 'public'
method: Jasper
home

	session ifNil: [
		result
			at: 'stoneName' put: (System stoneName subStrings: $!) last;
			at: 'stoneVersion' put: (System stoneVersionAt: #'gsVersion');
			at: 'userID' put: System myUserProfile userId;
			at: 'session' put: System session;
			at: 'sessionCount' put: System currentSessions size;
			at: 'repositorySizeMB' put: (SystemRepository fileSize / 1024 / 1024) ceiling;
			at: 'freeSpaceMB' put: (SystemRepository freeSpace / 1024 / 1024) floor;
			at: 'commitRecordBacklog' put: (System stoneCacheStatisticWithName: 'CommitRecordCount');
			yourself.
	] ifNotNil: [
		self serverSend: #'home'.
	]
%
category: 'public'
method: Jasper
signIn

	| id remoteData |
	session := GsExternalSession newDefault
		username: (data at: 'userID');
		password: (data at: 'password');
		login.
	id := Random new smallInteger abs printStringRadix: 36.
	self sessions at: id put: session.
	jasper := session _gciLibrary GciResolveSymbol_: 'Jasper' _: 20 "OOP_NILL".
	remoteData := session send: #'home' to: jasper.
	(JsonParser parse: remoteData) keysAndValuesDo: [:eachKey :eachValue | result at: eachKey put: eachValue].
	result at: 'session' put: id.
%
category: 'public'
method: Jasper
signOut

	session forceLogout.
	session := nil.
	jasper := nil.
%
category: 'public'
method: Jasper
softBreak

	session softBreak.
%
category: 'public'
method: Jasper
stats

	| myData duration layout options random time |
	myData := Dictionary new
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
		(myData at: 'low') 	add: (values at: 1).
		(myData at: 'open') 	add: (values at: 2).
		(myData at: 'close') 	add: (values at: 3).
		(myData at: 'high') 	add: (values at: 4).
		(myData at: 'x')		add: time printStringWithRoundedSeconds.
		time := time + duration.
	].
	layout := Dictionary new
		at: 'title'			put: 'Commit Record Backlog (Simulated Data)';
		yourself.
	options := Dictionary new.
	result
		at: 'data'		put: (Array with: myData);
		at: 'layout'		put: layout;
		at: 'options'	put: options;
		yourself.
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
	result
		at: 'config'		put: config;
		at: 'history'		put: DbfHistory;
		at: 'version'	put: version;
		yourself.
%

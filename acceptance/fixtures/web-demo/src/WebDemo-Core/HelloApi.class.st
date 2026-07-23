Class {
	#name : 'HelloApi',
	#superclass : 'WebApp',
	#category : 'WebDemo-Core'
}

{ #category : 'serving' }
HelloApi class >> runHttp [
	"Listen for requests. This never returns, so it needs a gem of its own —
	 select it in an editor and use GemStone: Run in a New Gem."

	HttpListener new
		listenBacklog: 200;
		port: 8888;
		server: self;
		run
]

{ #category : 'routes' }
HelloApi >> hello_gs [
	"Served at http://localhost:8888/hello.gs — WebGS turns the first path
	 segment into a selector, so `hello.gs` arrives here.

	 The date goes in the <title> as well as the body: the title is what the
	 editor's browser tab shows, so both the page and the tab prove this was
	 rendered by a live gem today, not served from a cache."

	| today |
	today := Date today printString.
	response contentType: 'text/html'.
	response content:
		'<html><head><title>Hello from GemStone on ' , today ,
		'</title></head><body><h1>Today is ' , today , '</h1></body></html>'
]

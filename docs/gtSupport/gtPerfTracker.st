"GT RSR Perf Tracker
====================
Counts RSR round trips in a Pharo GT image connected to GemStone.
Hooks RsrConnection >> _sendCommand:, filtering for RsrSendMessage, which
is the single chokepoint for all message sends from Pharo to GemStone.

Mirrors the GT Perf Tracker feature in Jasper (eric/gtPerfTracking branch).

To load:
  OpalCompiler new evaluate:
    '/path/to/Jasper/docs/gtSupport/gtPerfTracker.st' asFileReference contents

Usage:
  Inspect: GtGciPerfTracker default
  Click Enable action in the inspector
  GT Inspect a GemStone object and interact with tabs
  Click Refresh on the tracker inspector to see updated count
  Click Reset to clear counts between measurements
"

| perfTracker rsrConnection |

Object subclass: #GtGciPerfTracker
	instanceVariableNames: 'enabled count methodCounts originalSendCommand announcer'
	classVariableNames: 'Default'
	poolDictionaries: ''
	category: 'GemStoneFFI-GtPerfTracker'.

perfTracker := Smalltalk at: #GtGciPerfTracker.
rsrConnection := Smalltalk at: #RsrConnection.

"Add a permanent private helper to RsrConnection.
enable installs _sendCommand: -> pvtSendCommandCounting:.
disable restores the original _sendCommand:."
rsrConnection
	compile: 'pvtSendCommandCounting: aCommand
	(aCommand isKindOf: RsrSendMessage) ifTrue: [
		GtGciPerfTracker default increment: aCommand selectorReference asString ].
	channel send: aCommand'
	classified: 'private'.

perfTracker class
	compile: 'default
	Default ifNil: [ Default := self new pvtInitialize ].
	^ Default'
	classified: 'accessing'.

perfTracker class
	compile: 'reset
	"Clear the singleton -- useful for re-loading this file."
	Default ifNotNil: [ :d | d disable ].
	Default := nil'
	classified: 'instance creation'.

perfTracker
	compile: 'pvtInitialize
	enabled := false.
	count := 0.
	methodCounts := Dictionary new.
	originalSendCommand := nil.
	announcer := Announcer new.
	^ self'
	classified: 'private'.

perfTracker
	compile: 'announcer
	^ announcer'
	classified: 'accessing'.

perfTracker
	compile: 'isEnabled
	^ enabled'
	classified: 'accessing'.

perfTracker
	compile: 'count
	^ count'
	classified: 'accessing'.

perfTracker
	compile: 'methodCounts
	^ methodCounts'
	classified: 'accessing'.

perfTracker
	compile: 'increment: selectorName
	count := count + 1.
	methodCounts
		at: selectorName
		put: (methodCounts at: selectorName ifAbsent: [ 0 ]) + 1'
	classified: 'operations'.

perfTracker
	compile: 'reset
	count := 0.
	methodCounts := Dictionary new.
	self pvtAnnounce'
	classified: 'operations'.

perfTracker
	compile: 'pvtAnnounce
	announcer ifNotNil: [ announcer announce: Announcement new ]'
	classified: 'private'.

perfTracker
	compile: 'enable
	| protocol |
	originalSendCommand isNil ifTrue: [
		originalSendCommand := (RsrConnection >> #_sendCommand:) sourceCode ].
	protocol := (RsrConnection >> #_sendCommand:) protocol.
	RsrConnection
		compile: ''_sendCommand: aCommand
	^ self pvtSendCommandCounting: aCommand''
		classified: protocol.
	enabled := true.
	self pvtAnnounce'
	classified: 'operations'.

perfTracker
	compile: 'disable
	| protocol |
	enabled := false.
	self reset.
	originalSendCommand ifNotNil: [ :src |
		protocol := (RsrConnection >> #_sendCommand:) protocol.
		RsrConnection compile: src classified: protocol.
		originalSendCommand := nil ].
	self pvtAnnounce'
	classified: 'operations'.

perfTracker
	compile: 'sortedMethodCounts
	^ methodCounts associations asSortedCollection: [ :a :b | a value > b value ]'
	classified: 'accessing'.

perfTracker
	compile: 'gtViewInstructionsFor: aView
	<gtView>
	^ aView text
		title: ''Instructions'';
		priority: 0;
		text: [
''GT RSR Perf Tracker
====================
Counts GemStone round trips from a Pharo GT image via RSR.

Steps:
  1. Click Enable to start tracking.
  2. GT Inspect a GemStone object and interact with its tabs.
  3. Click Refresh to see the updated count.
  4. The Breakdown tab shows counts per GemStone selector.
  5. Click Reset to clear counts between measurements.
  6. Click Disable to stop tracking and restore RsrConnection.

Note: counts do not update live -- click Refresh after each test.'' ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtViewCountFor: aView
	<gtView>
	^ aView text
		title: ''Count'';
		priority: 1;
		updateWhen: Announcement in: [ self announcer ];
		text: [
			enabled
				ifTrue: [ count printString , '' RSR calls'' ]
				ifFalse: [ ''Tracking disabled - use Enable action'' ] ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtViewBreakdownFor: aView
	<gtView>
	^ aView columnedList
		title: ''Breakdown'';
		priority: 2;
		updateWhen: Announcement in: [ self announcer ];
		items: [ self sortedMethodCounts ];
		column: ''Selector'' text: [ :each | each key ];
		column: ''Count'' text: [ :each | each value printString ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtActionEnableFor: anAction
	<gtAction>
	^ anAction button
		label: ''Enable'';
		action: [ self enable ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtActionDisableFor: anAction
	<gtAction>
	^ anAction button
		label: ''Disable'';
		action: [ self disable ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtActionResetFor: anAction
	<gtAction>
	^ anAction button
		label: ''Reset'';
		action: [ self reset ]'
	classified: 'gt-extensions'.

perfTracker
	compile: 'gtActionRefreshFor: anAction
	<gtAction>
	^ anAction button
		label: ''Refresh'';
		action: [ self pvtAnnounce ]'
	classified: 'gt-extensions'.

"Reload guard -- clears previous singleton (and restores _sendCommand:) when re-evaluating."
perfTracker reset.

"Open a new inspector window showing the Instructions tab -- visible regardless of
how this snippet is evaluated (Do it, Print it, etc)."
GtInspector openOn: GtGciPerfTracker default

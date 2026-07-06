! ============================================================================
! Glamorous Toolkit inspector views (<gtView>) for IMCSystem
! ============================================================================
!
! Installs one or more <gtView> Phlow view methods on instances of IMCSystem.
! Each method adds a tab to the GT Inspect view of an IMCSystem instance.
!
! REQUIREMENTS
!   - GemStone GT remote support must be loaded in the stone
!     (GtPhlowText / GtPhlowColor must be resolvable). See
!     docs/enhancedInspectorSupport/load_enhanced_inspector_support.sh.
!   - Class IMCSystem (and any domain classes its views reference) must be present.
!   - Log in as the GemStone user that OWNS the application (e.g. DataCurator),
!     NOT SystemUser. If IMCSystem is not in the login user's symbol list, every
!     `method: IMCSystem` block and the smoke test fail with "undefined symbol
!     IMCSystem". A .topazini that sets `username SystemUser` can be overridden
!     with `set username DataCurator` / `set password ...` before `login`.
!
! USAGE (topaz)
!   cd <stone data dir containing .topazini>
!   $GEMSTONE/bin/topaz -l -I .topazini
!   topaz> login
!   topaz> input /path/to/this-file.gs
!   topaz> logout
!   topaz> exit
!
!   This file commits itself (see `commit` at the end), so a bare `input` is
!   enough to persist the methods. After loading, abort any connected Jasper
!   client session and GT Inspect an IMCSystem instance (e.g.
!   InstalledAcmeSystem) to see the new tab(s).
! ============================================================================

! --- Customer Invoices: gross totals per currency, then invoices grouped by
!     month (oldest first), sorted ascending by date within each month, with a
!     per-month invoice count, currency symbols, color-coded payment status,
!     and amount-due. ---------------------------------------------------------
category: 'gt views'
method: IMCSystem
gtCustomerInvoicesFor: aView
	<gtView>
	^ aView textEditor
		title: 'Customer Invoices';
		priority: 40;
		text: [
			[
				| invoices nl s ranges emit fmt statusColor symbolFor euro gray blue red green orange sorted groups totals order text |
				nl := String with: (Character value: 10).
				euro := (Character value: 8364) asString.
				gray := GtPhlowColor named: #gray.
				blue := GtPhlowColor named: #blue.
				red := GtPhlowColor named: #red.
				green := GtPhlowColor named: #green.
				orange := GtPhlowColor named: #orange.
				s := WriteStream on: String new.
				ranges := OrderedCollection new.
				emit := [:str :colorOrNil |
					str isEmpty ifFalse: [
						| startPos |
						startPos := s position + 1.
						s nextPutAll: str.
						colorOrNil ifNotNil: [:c |
							ranges add: (Array with: startPos with: s position with: c)]]].
				fmt := [:n |
					| str digits res |
					str := n abs printString.
					digits := str size.
					res := WriteStream on: String new.
					1 to: digits do: [:idx |
						| remaining |
						remaining := digits - idx.
						res nextPut: (str at: idx).
						(remaining > 0 and: [remaining \\ 3 = 0]) ifTrue: [res nextPut: $,]].
					(n < 0 ifTrue: ['-'] ifFalse: ['']) , res contents].
				symbolFor := [:name |
					name = 'Dollar' ifTrue: ['$'] ifFalse: [
					name = 'Euro' ifTrue: [euro] ifFalse: [
					name = 'Singapore dollar' ifTrue: ['S$'] ifFalse: [name , ' ']]]].
				statusColor := [:status |
					status = 'Paid' ifTrue: [green] ifFalse: [
					status = 'Not Paid' ifTrue: [red] ifFalse: [
					status = 'Partially Paid' ifTrue: [orange] ifFalse: [
					status = 'Over Paid' ifTrue: [blue] ifFalse: [gray]]]]].
				invoices := invoiceSystem contents.
				totals := Dictionary new.
				order := OrderedCollection new.
				invoices do: [:inv |
					| cn |
					cn := inv currency name.
					(totals includesKey: cn) ifFalse: [order add: cn. totals at: cn put: 0].
					totals at: cn put: (totals at: cn) + inv grossAmount].
				emit value: (invoices size printString , ' customer invoices') value: blue.
				s nextPutAll: nl.
				emit value: 'Gross totals:' value: gray.
				s nextPutAll: nl.
				order do: [:cn |
					emit value: '   ' value: nil.
					emit value: ((symbolFor value: cn) , (fmt value: (totals at: cn))) value: nil.
					s nextPutAll: nl].
				s nextPutAll: nl.
				sorted := invoices asSortedCollection: [:a :b | a date < b date].
				groups := OrderedCollection new.
				sorted do: [:inv |
					| key |
					key := (inv date year number * 100) + inv date month number.
					(groups isEmpty or: [groups last key ~= key])
						ifTrue: [groups add: (key -> (OrderedCollection with: inv))]
						ifFalse: [groups last value add: inv]].
				groups do: [:grp |
					| monthInvs first count |
					monthInvs := grp value.
					first := monthInvs first.
					count := monthInvs size.
					s nextPutAll: nl.
					emit value: ('-- ' , first date month name , ' ' , first date year number printString
						, ' (' , count printString , ' invoice' , (count = 1 ifTrue: [''] ifFalse: ['s']) , ') ----------------') value: blue.
					s nextPutAll: nl.
					monthInvs do: [:inv |
						| status due |
						status := inv paymentStatusDescription.
						emit value: '  ' value: nil.
						emit value: inv number value: blue.
						emit value: '   ' value: nil.
						emit value: inv licenseeName value: nil.
						s nextPutAll: nl.
						emit value: '      ' value: nil.
						emit value: inv date printString value: gray.
						emit value: '  ' value: nil.
						emit value: ((symbolFor value: inv currency name) , (fmt value: inv grossAmount)) value: nil.
						emit value: '   ' value: nil.
						emit value: status value: (statusColor value: status).
						due := inv amountDue.
						due > 0 ifTrue: [
							emit value: '   due ' value: gray.
							emit value: ((symbolFor value: inv currency name) , (fmt value: due)) value: red].
						s nextPutAll: nl]].
				text := GtPhlowText forString: s contents.
				ranges do: [:r | (text from: (r at: 1) to: (r at: 2)) foreground: (r at: 3)].
				text
			] on: Error do: [:e |
				'ERROR: ' , e class name , ': ' , e messageText]
		]
%

! --- Contracts: a columned table, one row per contract, ordered by status
!     (Active, then On Sell Off, then others), then within each status by total
!     billed descending (mixed currencies, tie-broken by licensee name).
!     Columns: Status (color-coded), Contract id, Licensee, Licensor, Min
!     Guaranteed, Billed (both with currency symbol), Invoice count, End date.
!     Status colors: Active=green, On Sell Off=orange, Canceled=red, else=gray.
!
!     NOTE: `state class name` returns a Symbol; `aSymbol = 'aString'` is false
!     in GemStone, so the state class name is compared with `asString`.
!     ------------------------------------------------------------------------
category: 'gt views'
method: IMCSystem
gtContractsFor: aView
	<gtView>
	| euro symbolFor fmt pretty statePriority statusColor green orange red gray |
	euro := (Character value: 8364) asString.
	green := GtPhlowColor named: #green.
	orange := GtPhlowColor named: #orange.
	red := GtPhlowColor named: #red.
	gray := GtPhlowColor named: #gray.
	fmt := [:n |
		| str digits res |
		str := n abs printString.
		digits := str size.
		res := WriteStream on: String new.
		1 to: digits do: [:idx |
			| rem |
			rem := digits - idx.
			res nextPut: (str at: idx).
			(rem > 0 and: [rem \\ 3 = 0]) ifTrue: [res nextPut: $,]].
		(n < 0 ifTrue: ['-'] ifFalse: ['']) , res contents].
	symbolFor := [:name |
		name = 'Dollar' ifTrue: ['$'] ifFalse: [
		name = 'Euro' ifTrue: [euro] ifFalse: [
		name = 'Singapore dollar' ifTrue: ['S$'] ifFalse: [name , ' ']]]].
	pretty := [:c |
		| cn suffix res |
		cn := c state class name asString.
		suffix := 'ContractState'.
		(cn size > suffix size and: [(cn copyFrom: cn size - suffix size + 1 to: cn size) = suffix])
			ifTrue: [cn := cn copyFrom: 1 to: cn size - suffix size].
		res := WriteStream on: String new.
		1 to: cn size do: [:i |
			| ch |
			ch := cn at: i.
			(i > 1 and: [ch isUppercase]) ifTrue: [res nextPut: $ ].
			res nextPut: ch].
		res contents].
	statePriority := [:c |
		| cn |
		cn := c state class name asString.
		cn = 'ActiveContractState' ifTrue: [0] ifFalse: [
		cn = 'OnSellOffContractState' ifTrue: [1] ifFalse: [2]]].
	statusColor := [:c |
		| cn |
		cn := c state class name asString.
		cn = 'ActiveContractState' ifTrue: [green] ifFalse: [
		cn = 'OnSellOffContractState' ifTrue: [orange] ifFalse: [
		cn = 'CanceledContractState' ifTrue: [red] ifFalse: [gray]]]].
	^ aView columnedList
		title: 'Contracts';
		priority: 35;
		items: [
			contractSystem contents asSortedCollection: [:a :b |
				| pa pb |
				pa := statePriority value: a.
				pb := statePriority value: b.
				pa = pb
					ifTrue: [
						a totalBilledInContractCurrency = b totalBilledInContractCurrency
							ifTrue: [a licenseeName asLowercase < b licenseeName asLowercase]
							ifFalse: [a totalBilledInContractCurrency > b totalBilledInContractCurrency]]
					ifFalse: [pa < pb]] ];
		column: 'Status' text: [:c |
			| label t |
			label := pretty value: c.
			t := GtPhlowText forString: label.
			(t from: 1 to: label size) foreground: (statusColor value: c).
			t];
		column: 'Contract' text: [:c | c id];
		column: 'Licensee' text: [:c | c licenseeName];
		column: 'Licensor' text: [:c | c licensor name];
		column: 'Min Guaranteed' text: [:c | (symbolFor value: c currency name) , (fmt value: c minimumGuaranteedTotal)];
		column: 'Billed' text: [:c | (symbolFor value: c currency name) , (fmt value: c totalBilledInContractCurrency)];
		column: 'Invoices' text: [:c | c invoices size printString];
		column: 'Ends' text: [:c | c endDate printString];
		yourself
%

! --- Summary: a read-only styled-text dashboard (the "first impression" tab,
!     priority 25 so it leads). Title and section headers use bold + font size;
!     status bullets and outstanding receivables are color-coded. Mirrors the
!     Overview categories but as a polished at-a-glance view (not clickable).
!     Per-currency totals are summed within a currency; no cross-currency money
!     is conflated. Uses bold / fontSize: / italic / foreground -- all of which
!     Jasper renders (phlowFontWeight/FontSize/FontEmphasis/Foreground).
!     ------------------------------------------------------------------------
category: 'gt views'
method: IMCSystem
gtSummaryFor: aView
	<gtView>
	^ aView textEditor
		title: 'Summary';
		priority: 25;
		text: [
			[
				| nl s ranges emit fmt symbolFor euro bullet padR plural gray blue green red orange
				  titleStyle headerStyle boldStyle contracts invoices stateCounts statusCounts gross outstanding curOrder licCon licInv licOrder allLic text |
				nl := String with: (Character value: 10).
				euro := (Character value: 8364) asString.
				bullet := (Character value: 9679) asString.
				gray := GtPhlowColor named: #gray.
				blue := GtPhlowColor named: #blue.
				green := GtPhlowColor named: #green.
				red := GtPhlowColor named: #red.
				orange := GtPhlowColor named: #orange.
				s := WriteStream on: String new.
				ranges := OrderedCollection new.
				emit := [:str :styleBlk |
					str isEmpty ifFalse: [
						| p |
						p := s position + 1.
						s nextPutAll: str.
						styleBlk ifNotNil: [:blk | ranges add: (Array with: p with: s position with: blk)]]].
				titleStyle := [:seg | seg bold; fontSize: 17; foreground: blue].
				headerStyle := [:seg | seg bold; foreground: blue].
				boldStyle := [:seg | seg bold].
				fmt := [:n |
					| str d r |
					str := n abs printString.
					d := str size.
					r := WriteStream on: String new.
					1 to: d do: [:i |
						| rem |
						rem := d - i.
						r nextPut: (str at: i).
						(rem > 0 and: [rem \\ 3 = 0]) ifTrue: [r nextPut: $,]].
					(n < 0 ifTrue: ['-'] ifFalse: ['']) , r contents].
				symbolFor := [:name |
					name = 'Dollar' ifTrue: ['$'] ifFalse: [
					name = 'Euro' ifTrue: [euro] ifFalse: [
					name = 'Singapore dollar' ifTrue: ['S$'] ifFalse: [name , ' ']]]].
				padR := [:str :w |
					| r |
					r := WriteStream on: String new.
					r nextPutAll: str.
					[r contents size < w] whileTrue: [r nextPut: $ ].
					r contents].
				plural := [:n :word | n printString , ' ' , word , (n = 1 ifTrue: [''] ifFalse: ['s'])].
				contracts := contractSystem contents.
				invoices := invoiceSystem contents.
				stateCounts := Dictionary new.
				contracts do: [:c |
					| cn |
					cn := c state class name asString = 'ActiveContractState' ifTrue: ['Active'] ifFalse: [
						c state class name asString = 'OnSellOffContractState' ifTrue: ['On Sell Off'] ifFalse: ['Other']].
					stateCounts at: cn put: (stateCounts at: cn ifAbsent: [0]) + 1].
				statusCounts := Dictionary new.
				gross := Dictionary new.
				outstanding := Dictionary new.
				curOrder := OrderedCollection new.
				invoices do: [:i |
					| st cn |
					st := i paymentStatusDescription.
					cn := i currency name.
					statusCounts at: st put: (statusCounts at: st ifAbsent: [0]) + 1.
					(gross includesKey: cn) ifFalse: [curOrder add: cn. gross at: cn put: 0. outstanding at: cn put: 0].
					gross at: cn put: (gross at: cn) + i grossAmount.
					outstanding at: cn put: (outstanding at: cn) + i amountDue].
				licCon := Dictionary new.
				licInv := Dictionary new.
				contracts do: [:c | licCon at: c licenseeName put: (licCon at: c licenseeName ifAbsent: [0]) + 1].
				invoices do: [:i | licInv at: i licenseeName put: (licInv at: i licenseeName ifAbsent: [0]) + 1].
				allLic := (licCon keys , licInv keys) asSet.
				licOrder := allLic asSortedCollection: [:a :b |
					(licCon at: a ifAbsent: [0]) = (licCon at: b ifAbsent: [0])
						ifTrue: [(licInv at: a ifAbsent: [0]) > (licInv at: b ifAbsent: [0])]
						ifFalse: [(licCon at: a ifAbsent: [0]) > (licCon at: b ifAbsent: [0])]].
				emit value: 'SYSTEM SUMMARY' value: titleStyle.
				s nextPutAll: nl; nextPutAll: nl.
				emit value: ('CONTRACTS (' , contracts size printString , ')') value: headerStyle.
				s nextPutAll: nl.
				#('Active' 'On Sell Off' 'Other') do: [:st |
					(stateCounts includesKey: st) ifTrue: [
						| col |
						col := st = 'Active' ifTrue: [green] ifFalse: [st = 'On Sell Off' ifTrue: [orange] ifFalse: [gray]].
						emit value: '  ' value: nil.
						emit value: bullet value: [:seg | seg foreground: col].
						emit value: ('  ' , (padR value: st value: 16)) value: nil.
						emit value: (stateCounts at: st) printString value: boldStyle.
						s nextPutAll: nl]].
				s nextPutAll: nl.
				emit value: ('INVOICES (' , invoices size printString , ')') value: headerStyle.
				s nextPutAll: nl.
				#('Paid' 'Over Paid' 'Partially Paid' 'Not Paid') do: [:st |
					(statusCounts includesKey: st) ifTrue: [
						| col |
						col := st = 'Paid' ifTrue: [green] ifFalse: [st = 'Over Paid' ifTrue: [blue] ifFalse: [st = 'Partially Paid' ifTrue: [orange] ifFalse: [red]]].
						emit value: '  ' value: nil.
						emit value: bullet value: [:seg | seg foreground: col].
						emit value: ('  ' , (padR value: st value: 16)) value: nil.
						emit value: (statusCounts at: st) printString value: boldStyle.
						s nextPutAll: nl]].
				s nextPutAll: nl.
				emit value: 'GROSS BILLED' value: headerStyle.
				s nextPutAll: nl.
				curOrder do: [:cn |
					emit value: ('  ' , ((symbolFor value: cn) , (fmt value: (gross at: cn)))) value: nil.
					s nextPutAll: nl].
				s nextPutAll: nl.
				emit value: 'OUTSTANDING RECEIVABLES' value: headerStyle.
				s nextPutAll: nl.
				curOrder do: [:cn |
					emit value: '  ' value: nil.
					emit value: ((symbolFor value: cn) , (fmt value: (outstanding at: cn))) value: [:seg | seg bold; foreground: red].
					s nextPutAll: nl].
				s nextPutAll: nl.
				emit value: ((plural value: dealMemoSystem contents size value: 'deal memo') , '      '
					, (plural value: licenseeSystem contents size value: 'licensee') , ' / '
					, (plural value: licensorSystem contents size value: 'licensor')) value: [:seg | seg foreground: gray].
				s nextPutAll: nl; nextPutAll: nl.
				emit value: 'LICENSEE ACTIVITY' value: headerStyle.
				s nextPutAll: nl.
				licOrder do: [:ln |
					emit value: ('  ' , (padR value: ln value: 20)) value: nil.
					emit value: (padR value: (plural value: (licCon at: ln ifAbsent: [0]) value: 'contract') value: 14) value: [:seg | seg foreground: gray].
					emit value: (plural value: (licInv at: ln ifAbsent: [0]) value: 'invoice') value: [:seg | seg foreground: gray].
					s nextPutAll: nl].
				text := GtPhlowText forString: s contents.
				ranges do: [:r | (r at: 3) value: (text from: (r at: 1) to: (r at: 2))].
				text
			] on: Error do: [:e |
				'ERROR: ' , e class name , ': ' , e messageText]
		]
%

! --- Overview: a clickable summary table. One row per category -- contracts
!     by state (Active, On Sell Off) then invoices by payment status -- whose
!     row item IS the filtered collection, so double-clicking (or right-click
!     -> Inspect) opens an inspector on exactly that subset (e.g. the 8 Paid
!     invoices). Section column groups the rows; Category cell is color-coded.
!
!     NOTE: Jasper inspects a row's *sent* item -- the result of the view's
!     row-level send block (identity here, since no `send:` is given, so the
!     item itself) -- NOT a per-column `spawn:` target. So each item must BE the
!     collection you want to drill into; labels are derived from its contents.
!     ------------------------------------------------------------------------
category: 'gt views'
method: IMCSystem
gtSystemOverviewFor: aView
	<gtView>
	| rows green orange red blue gray pretty sectionFor labelFor colorFor |
	green := GtPhlowColor named: #green.
	orange := GtPhlowColor named: #orange.
	red := GtPhlowColor named: #red.
	blue := GtPhlowColor named: #blue.
	gray := GtPhlowColor named: #gray.
	pretty := [:c |
		| cn suffix res |
		cn := c state class name asString.
		suffix := 'ContractState'.
		(cn size > suffix size and: [(cn copyFrom: cn size - suffix size + 1 to: cn size) = suffix])
			ifTrue: [cn := cn copyFrom: 1 to: cn size - suffix size].
		res := WriteStream on: String new.
		1 to: cn size do: [:i |
			| ch |
			ch := cn at: i.
			(i > 1 and: [ch isUppercase]) ifTrue: [res nextPut: $ ].
			res nextPut: ch].
		res contents].
	sectionFor := [:coll |
		(coll anyOne isKindOf: Invoice) ifTrue: ['Invoices'] ifFalse: [
		(coll anyOne isKindOf: Contract) ifTrue: ['Contracts'] ifFalse: ['Other']]].
	labelFor := [:coll |
		(coll anyOne isKindOf: Invoice)
			ifTrue: [coll anyOne paymentStatusDescription]
			ifFalse: [pretty value: coll anyOne]].
	colorFor := [:coll |
		(coll anyOne isKindOf: Invoice)
			ifTrue: [
				| st |
				st := coll anyOne paymentStatusDescription.
				st = 'Paid' ifTrue: [green] ifFalse: [
				st = 'Over Paid' ifTrue: [blue] ifFalse: [
				st = 'Partially Paid' ifTrue: [orange] ifFalse: [red]]]]
			ifFalse: [
				| nm |
				nm := pretty value: coll anyOne.
				nm = 'Active' ifTrue: [green] ifFalse: [
				nm = 'On Sell Off' ifTrue: [orange] ifFalse: [gray]]]].
	rows := OrderedCollection new.
	#('ActiveContractState' 'OnSellOffContractState') do: [:sc |
		| sub |
		sub := contractSystem contents select: [:c | c state class name asString = sc].
		sub isEmpty ifFalse: [rows add: sub]].
	#('Paid' 'Over Paid' 'Partially Paid' 'Not Paid') do: [:stat |
		| sub |
		sub := invoiceSystem contents select: [:i | i paymentStatusDescription = stat].
		sub isEmpty ifFalse: [rows add: sub]].
	^ aView columnedList
		title: 'Overview';
		priority: 30;
		items: [ rows ];
		column: 'Section' text: [:coll | sectionFor value: coll] width: 110;
		column: 'Category' text: [:coll |
			| label t |
			label := labelFor value: coll.
			t := GtPhlowText forString: label.
			(t from: 1 to: label size) foreground: (colorFor value: coll).
			t] width: 160;
		column: 'Count' text: [:coll | coll size printString];
		yourself
%

! Persist the new method(s).
commit

! Smoke test: confirm the methods compiled onto the instance side.
run
| missing |
missing := #( #gtSummaryFor: #gtCustomerInvoicesFor: #gtContractsFor: #gtSystemOverviewFor: )
	reject: [:sel | IMCSystem includesSelector: sel].
missing isEmpty
	ifTrue: [ 'OK: all gtView methods installed on IMCSystem' ]
	ifFalse: [ 'FAIL: missing ' , missing printString ]
%

define("ace/mode/matching_brace_outdent",["require","exports","module","ace/range"], function(require, exports, module) {
"use strict";

var Range = require("../range").Range;

var MatchingBraceOutdent = function() {};

(function() {

    this.checkOutdent = function(line, input) {
        if (! /^\s+$/.test(line))
            return false;

        return /^\s*\}/.test(input);
    };

    this.autoOutdent = function(doc, row) {
        var line = doc.getLine(row);
        var match = line.match(/^(\s*\})/);

        if (!match) return 0;

        var column = match[1].length;
        var openBracePos = doc.findMatchingBracket({row: row, column: column});

        if (!openBracePos || openBracePos.row == row) return 0;

        var indent = this.$getIndent(doc.getLine(openBracePos.row));
        doc.replace(new Range(row, 0, row, column-1), indent);
    };

    this.$getIndent = function(line) {
        return line.match(/^\s*/)[0];
    };

}).call(MatchingBraceOutdent.prototype);

exports.MatchingBraceOutdent = MatchingBraceOutdent;
});

define("ace/mode/smalltalk_code_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var binarySelector = /(\+|\=|\\|\*|\~|\<|\>|\=|\||\/|\&|\@|\%|\,|\?|\!)+/;
var global = /([A-Z][a-zA-Z0-9_]+)|([A-Z])/;
var identifier = /([a-zA-Z_][a-zA-Z0-9_]+)|([a-zA-Z])/;
var keyword = /(([a-zA-Z_]\:)|([a-zA-Z_][a-zA-Z0-9_]+\:))+/;
var numericLiteral = /(\-\s*)?\d+(\.\d+)?([dDeEfFpPqQsS]\-?\d)?/;
var radixedLiteral = /\d+(\#|r)\-?[0-9A-Za-z]+/;

var SmalltalkCodeHighlightRules = function() {
    this.$rules = {
            start: [{
                regex: /\"/,
                onMatch: function (value, currentState, stack, line) { return "comment" },
                next: "comment"		// needs to be separate so it can span multiple lines
            }, {
                token : "constant.numeric", // radixed literal
                regex : radixedLiteral
            }, {
                token : "constant.numeric", // numeric literal
                regex : numericLiteral
            }, {
            	token: "constant.character",
            	regex: /\$./
            }, {
            	token: "constant.language",
            	regex: /true|false|nil/
            }, {
            	token: "string.quoted",
                regex: /\'((\'\')|([^\']))*\'/,
            }, {
            	token: "string.other.symbol",		// symbol string literal
                regex: /\#\'((\'\')|([^\']))*\'/,
            }, {
            	token: "keyword.operator.temporaries",
            	regex: /\|\s*/,
            	next: "temporaries"
            }, {
            	token: "keyword.operator.array",
            	regex: /\#(?:\()/,
            }, {
            	token: "keyword.operator.parenthesis",
            	regex: /(?:(\(|\)))/,
            }, {
            	token: "keyword.operator.byteArray",
            	regex: /\#(?:\[)/,
            	next: "byteArray"
            }, {
            	token: "keyword.operator.block",
            	regex: /(?:(\[|\]))/,
            }, {
            	token: "keyword.operator.brace",
            	regex: /(?:(\{|\}))/,
            }, {
            	token: "keyword.operator.dot",
            	regex: /\./,
            }, {
            	token: "keyword.operator.cascade",
            	regex: /\;/,
            }, {
            	token: "keyword.operator.assignment",
            	regex: /\:\=/,
            }, {
            	token: "keyword.operator.return",
            	regex: /\^/,
            }, {
            	token: "keyword.operator.binarySelector",
            	regex: binarySelector,
            }, {
            	token: "keyword.operator.blockArg",
            	regex: /\:/,
            	next: "blockArg"
            }, {
            	token: "string.other.symbol",
            	regex: /\#/,
            	next: "symbol"
            }, {
            	token: "variable.language",
            	regex: /self|super|thisContext/
            }, {
            	token: "support.function.keyword",
            	regex: keyword
            }, {
            	token: "support.variable.global",
            	regex: global
            }, {
            	token: "name",
            	regex: identifier
            }],

            blockArg: [{
            	token: "keyword.operator.blockArg",
            	regex: /\|/,
            	next: "start"
            }, {
            	token: "keyword.operator.blockArg",
            	regex: /\:/,
			}, {
            	token: "variable.other.blockArg",
            	regex: identifier,
            }, {
				token: "invalid",
				regex: /^\s/,
				next: "start"
			}],
            byteArray: [{
            	token: "keyword.operator.byteArray",
            	regex: /(?:\])/,
            	next: "start"
            }, {
                token : "constant.numeric.byte", // radixed literal
                regex : radixedLiteral
            }, {
                token : "constant.numeric.byte", // numeric literal
                regex : numericLiteral
            }],
            comment: [{
            	token: "comment",
            	regex: /\"\"/
            }, {
            	token: "comment",
            	regex: /\"/,
            	next: "start"
            }, {
            	defaultToken: "comment"
            }],
            pragma: [{

            }],
            symbol: [{
            	token: "string.other.symbol",
            	regex: keyword,
            	next: "start"
            }, {
            	token: "string.other.symbol",
            	regex: identifier,
            	next: "start"
            }, {
            	token: "string.other.symbol",
            	regex: binarySelector,
            	next: "start"
			}, {
				token: "invalid",
				regex: /./,
				next: "start"
			}],
            temporaries: [{
            	token: "keyword.operator.temporaries",
            	regex: /\|/,
            	next: "start"
            }, {
            	token: "variable.other.temporary",
            	regex: identifier
            }, {
				token: "invalid",
				regex: /^\s/,
				next: "start"
			}]
        }

    this.normalizeRules();
};

SmalltalkCodeHighlightRules.metaData =


oop.inherits(SmalltalkCodeHighlightRules, TextHighlightRules);

exports.SmalltalkCodeHighlightRules = SmalltalkCodeHighlightRules;
});

define("ace/mode/folding/smalltalk_code",["require","exports","module","ace/lib/oop","ace/range","ace/mode/folding/fold_mode"], function(require, exports, module) {
"use strict";

var oop = require("../../lib/oop");
var Range = require("../../range").Range;
var BaseFoldMode = require("./fold_mode").FoldMode;

var FoldMode = exports.FoldMode = function() {};
oop.inherits(FoldMode, BaseFoldMode);

(function() {
    this.foldingStartMarker = /(\{|\[)[^\}\]]*$|^\s*(\/\*)/;
	this.foldingStopMarker = /^[^\[\{]*(\}|\])|^[\s\*]*(\*\/)/;

    this.getFoldWidgetRange = function(session, foldStyle, row) {
        var line = session.getLine(row);
    };

}).call(FoldMode.prototype);

});

define("ace/mode/smalltalk_code",["require","exports","module","ace/lib/oop","ace/mode/text","ace/tokenizer","ace/mode/matching_brace_outdent","ace/mode/smalltalk_code_highlight_rules","ace/mode/folding/smalltalk_code"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var Tokenizer = require("../tokenizer").Tokenizer;
var MatchingBraceOutdent = require("./matching_brace_outdent").MatchingBraceOutdent;
var SmalltalkCodeHighlightRules = require("./smalltalk_code_highlight_rules").SmalltalkCodeHighlightRules;
var SmalltalkCodeFoldMode = require("./folding/smalltalk_code").FoldMode;

var Mode = function() {
    this.HighlightRules = SmalltalkCodeHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    this.foldingRules = new SmalltalkCodeFoldMode();
};
oop.inherits(Mode, TextMode);

(function() {
    this.$id = "ace/mode/smalltalk_code"
    this.blockComment = {start: '"', end: '""'};
    this.getNextLineIndent = function(state, line, tab) {
        var indent = this.$getIndent(line);
        return indent;
    };

    this.checkOutdent = function(state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };

    this.autoOutdent = function(state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };

}).call(Mode.prototype);

exports.Mode = Mode;
});                (function() {
                    window.require(["ace/mode/smalltalk_code"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();

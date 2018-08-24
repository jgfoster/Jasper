//  http://cwestblog.com/2018/08/04/ace-editor-vue-component/

/* START: <ace-editor> Vue component */
import Vue from 'vue'
import 'ace-builds/src-noconflict/ace'
import 'ace-builds/src-noconflict/theme-chrome'
import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/webpack-resolver'

(function () {
  const PROPS = {
    selectionStyle: {},
    highlightActiveLine: { f: toBool },
    highlightSelectedWord: { f: toBool },
    readOnly: { f: toBool },
    cursorStyle: {},
    mergeUndoDeltas: { f: toBool },
    behavioursEnabled: { f: toBool },
    wrapBehavioursEnabled: { f: toBool },
    autoScrollEditorIntoView: { f: toBool, v: false },
    copyWithEmptySelection: { f: toBool },
    useSoftTabs: { f: toBool, v: false },
    navigateWithinSoftTabs: { f: toBool, v: false },
    hScrollBarAlwaysVisible: { f: toBool },
    vScrollBarAlwaysVisible: { f: toBool },
    highlightGutterLine: { f: toBool },
    animatedScroll: { f: toBool },
    showInvisibles: { f: toBool },
    showPrintMargin: { f: toBool },
    printMarginColumn: { f: toNum, v: 80 },
    // shortcut for showPrintMargin and printMarginColumn
    printMargin: { f: x => toBool(x, true) && toNum(x) }, // false|number
    fadeFoldWidgets: { f: toBool },
    showFoldWidgets: { f: toBool, v: true },
    showLineNumbers: { f: toBool, v: true },
    showGutter: { f: toBool, v: true },
    displayIndentGuides: { f: toBool, v: true },
    fontSize: {},
    fontFamily: {},
    minLines: { f: toNum },
    maxLines: { f: toNum },
    scrollPastEnd: { f: toBoolOrNum },
    fixedWidthGutter: { f: toBool, v: false },
    theme: { v: 'chrome' },
    scrollSpeed: { f: toNum },
    dragDelay: { f: toNum },
    dragEnabled: { f: toBool, v: true },
    focusTimeout: { f: toNum },
    tooltipFollowsMouse: { f: toBool },
    firstLineNumber: { f: toNum, v: 1 },
    overwrite: { f: toBool },
    newLineMode: {},
    useWorker: { f: toBool },
    tabSize: { f: toNum, v: 2 },
    wrap: { f: toBoolOrNum },
    foldStyle: { v: 'markbegin' },
    mode: { v: 'javascript' },
    value: {},
  };

  const EDITOR_EVENTS = ['blur', 'change', 'changeSelectionStyle', 'changeSession', 'copy', 'focus', 'paste'];

  const INPUT_EVENTS = ['keydown', 'keypress', 'keyup'];

  function toBool(value, opt_ignoreNum) {
    let result = value;
    if (result != null) {
      (value + '').replace(
        /^(?:|0|false|no|off|(1|true|yes|on))$/,
        (m, isTrue) => result = (/01/.test(m) && opt_ignoreNum) ? result : !!isTrue
      );
    }
    return result;
  }

  function toNum(value) {
    return (value == null || Number.isNaN(+value)) ? value : +value;
  }

  function toBoolOrNum(value) {
    let result = toBool(value, true);
    return 'boolean' === typeof result ? result : toNum(value);
  }

  function emit(component, name, event) {
    component.$emit(name.toLowerCase(), event);
    if (name !== name.toLowerCase()) {
      component.$emit(name.replace(/[A-Z]+/g, m => `-${m}`.toLowerCase()), event);
    }
  }

  Vue.component('aceEditor', {
    template: '<div ref="root"></div>',
    props: Object.keys(PROPS),
    data() {
      return {
        editor: null,
        isShowingError: false,
        isShowingWarning: false,
        allowInputEvent: true,
        // NOTE:  "lastValue" is needed to prevent cursor from always going to
        // the end after typing
        lastValue: ''
      };
    },
    methods: {
      setOption(key, value) {
        console.log('ace-vue.js - setOption - ', key, value)
        let { f: func } = PROPS[key];

        value = /^(theme|mode)$/.test(key)
          ? `ace/${key}/${value}`
          : func
            ? func(value)
            : value;

        this.editor.setOption(key, value);
      }
    },
    watch: (function () {
      let watch = {
        value(value) {
          if (this.lastValue !== value) {
            this.allowInputEvent = false;
            this.editor.setValue(value);
            this.allowInputEvent = true;
          }
        }
      };

      return Object.entries(PROPS).reduce(
        (watch, [propName, prop]) => {
          if (propName !== 'value') {
            watch[propName] = function (newValue) {
              this.setOption(propName, newValue);
            };
          }
          return watch;
        },
        watch
      );
    })(),
    mounted() {
      this.editor = window.ace.edit(this.$refs.root, { value: this.value });

      Object.entries(PROPS).forEach(
        ([propName, prop]) => {
          let value = this.$props[propName];
          if (value !== undefined || prop.hasOwnProperty('v')) {
            this.setOption(propName, value === undefined ? prop.v : value);
          }
        }
      );

      this.editor.on('change', e => {
        this.lastValue = this.editor.getValue();
        if (this.allowInputEvent) {
          emit(this, 'input', this.lastValue);
        }
      });

      INPUT_EVENTS.forEach(
        eName => this.editor.textInput.getElement().addEventListener(
          eName, e => emit(this, eName, e)
        )
      );

      EDITOR_EVENTS.forEach(eName => this.editor.on(eName, e => emit(this, eName, e)));

      let session = this.editor.getSession();
      session.on('changeAnnotation', () => {
        let annotations = session.getAnnotations();
        let errors = annotations.filter(a => a.type === 'error');
        let warnings = annotations.filter(a => a.type === 'warning');

        emit(this, 'changeAnnotation', { type: 'changeAnnotation', annotations, errors, warnings });

        if (errors.length) {
          emit(this, 'error', { type: 'error', annotations: errors });
        }
        else if (this.isShowingError) {
          emit(this, 'errorsRemoved', { type: 'errorsRemoved' });
        }
        this.isShowingError = !!errors.length;

        if (warnings.length) {
          emit(this, 'warning', { type: 'warning', annotations: warnings });
        }
        else if (this.isShowingWarning) {
          emit(this, 'warningsRemoved', { type: 'warningsRemoved' });
        }
        this.isShowingWarning = !!warnings.length;
      });
      console.log('aceEditor.mounted() - end')
    }
  });
})();
/* END: <ace-editor> Vue component */

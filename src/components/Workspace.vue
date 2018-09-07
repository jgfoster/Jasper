<template>
  <v-container fluid pa-1 j-workspace>
    <v-layout row wrap>
      <div j-buttons>
        <v-btn small v-on:click='evaluate' :disabled='this.$store.state.isCallInProgress'>Evaluate</v-btn>
        <v-btn small v-on:click='display' :disabled='this.$store.state.isCallInProgress'>Display</v-btn>
        <v-btn small v-on:click='inspect' disabled>Inspect</v-btn>
        <v-btn small v-on:click='debug' disabled>Debug</v-btn>
      </div>
      <div style='width: 100%' j-ace-editor>
        <ace-editor v-model='code' min-lines='20' max-lines='50'></ace-editor>
      </div>
    </v-layout>
  </v-container>
</template>

<script>
  export default {
    name: 'workspace',
    data () {
      return {
        code: '(Delay forSeconds: 5) wait.'
      }
    },
    mounted () { this.editor.focus() },
    methods: {
      debug () { console.log('debug') },
      display () { this.evaluateAndDisplay(true) },
      evaluate () { this.evaluateAndDisplay(false) },
      evaluateAndDisplay (aBoolean) {
        var string = this.editor.getSelectedText()
        if (!string) {
          var selection = this.editor.selection
          selection.selectLine()
          var range = selection.getRange()
          if (range.start.row !== range.end.row) {  // includes newline?
            this.editor.selection.moveCursorLeft()
          }
          string = this.editor.getSelectedText()
        }
        var point = this.editor.selection.getRange().end
        this.$store.dispatch('server', {
          path: 'evaluate',
          args: { string },
          result: data => {
            this.editor.focus()
            this.editor.selection.moveCursorTo(point.row, point.column)
            this.editor.selection.clearSelection()
            if (aBoolean) {
              var end = this.editor.session.insert(point, ' ' + data.result)
              this.editor.selection.setRange({ start: point, end: end })
            }
          }
        })
      },
      inspect () { console.log('inspect') }
    }
  }
</script>

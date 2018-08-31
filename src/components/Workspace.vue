<template>
  <v-container fluid>
    <v-layout row wrap>
      <div>
        <v-btn small v-on:click='evaluate' :disabled='isCallInProgress'>Evaluate</v-btn>
        <v-btn small v-on:click='display' :disabled='isCallInProgress'>Display</v-btn>
        <v-btn small v-on:click='inspect' disabled>Inspect</v-btn>
        <v-btn small v-on:click='softBreak' :disabled='!isCallInProgress'>Soft Break</v-btn>
      </div>
      <div style='width: 100%'>
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
        code: '2 + 3',
        isCallInProgress: false
      }
    },
    mounted () { this.editor.focus() },
    methods: {
      softBreak () {
        this.$axios.post(
          process.env.URL + 'softBreak',
          {
            session: this.$store.state.session
          })
        .then(result => {
          this.editor.focus()
        }, error => {
          console.error(error)
        })
      },
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
        this.isCallInProgress = true
        this.editor.setReadOnly(true)
        var point = this.editor.selection.getRange().end
        this.$axios.post(
          process.env.URL + 'evaluate',
          {
            session: this.$store.state.session,
            string: string
          })
        .then(result => {
          this.editor.focus()
          this.editor.selection.moveCursorTo(point.row, point.column)
          this.editor.selection.clearSelection()
          var end
          if (result.data.success) {
            if (aBoolean) {
              end = this.editor.session.insert(point, ' ' + result.data.result)
              this.editor.selection.setRange({ start: point, end: end })
            }
          } else {
            end = this.editor.session.insert(point, ' ' + result.data.error)
            this.editor.selection.setRange({ start: point, end: end })
          }
          this.isCallInProgress = false
          this.editor.setReadOnly(false)
        }, error => {
          console.error(error)
          this.isCallInProgress = false
          this.editor.setReadOnly(false)
        })
      },
      inspect () { console.log('inspect') }
    }
  }
</script>

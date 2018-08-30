<template>
  <v-container fluid>
    <v-layout row wrap>
      <div>
        <v-btn small v-on:click='evaluate'>Evaluate</v-btn>
        <v-btn small v-on:click='display'>Display</v-btn>
        <v-btn small v-on:click='inspect' disabled>Inspect</v-btn>
        <v-btn small v-on:click='softBreak'>Soft Break</v-btn>
      </div>
      <div style='width: 100%'>
        <ace-editor v-model='code' min-lines='20' max-lines='50'></ace-editor>
      </div>
    </v-layout>
  </v-container>
</template>

<script>
  import axios from 'axios'

  export default {
    name: 'workspace',
    data () {
      return {
        code: '2 + 3'
      }
    },
    mounted () {},
    methods: {
      softBreak () {
        axios.post(
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
      display () { console.log('display') },
      evaluate () {
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
        axios.post(
          process.env.URL + 'evaluate',
          {
            session: this.$store.state.session,
            string: string
          })
        .then(result => {
          this.editor.focus()
          var point
          var end
          if (result.data.success) {
            point = this.editor.selection.getRange().end
            this.editor.selection.moveCursorTo(point.row, point.column)
            this.editor.selection.clearSelection()
            end = this.editor.session.insert(point, ' ' + result.data.result)
            this.editor.selection.setRange({ start: point, end: end })
          } else {
            point = this.editor.selection.getRange().end
            this.editor.selection.moveCursorTo(point.row, point.column)
            this.editor.selection.clearSelection()
            end = this.editor.session.insert(point, ' ' + result.data.error)
            this.editor.selection.setRange({ start: point, end: end })
          }
        }, error => {
          console.error(error)
        })
      },
      inspect () { console.log('inspect') }
    }
  }
</script>

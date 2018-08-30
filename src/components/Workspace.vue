<template>
  <v-container fluid>
    <v-layout row wrap>
      <div>
        <v-btn small v-on:click='evaluate'>Evaluate</v-btn>
        <v-btn small v-on:click='display'>Display</v-btn>
        <v-btn small v-on:click='inspect' disabled>Inspect</v-btn>
      </div>
      <div style='width: 100%'>
        <ace-editor v-model='code' min-lines='3' max-lines='30'></ace-editor>
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
        code: '| x |\nx := 5.\n^x * 3'
      }
    },
    mounted () {},
    methods: {
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
          if (result.data.success) {
            console.log(result)
          } else {
            console.log(result)
          }
        }, error => {
          console.error(error)
        })
        console.log('evaluate', string)
      },
      inspect () { console.log('inspect') }
    }
  }
</script>

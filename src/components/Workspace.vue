<template>
  <v-container fluid>
    <v-layout row wrap>
      Workspace
    </v-layout>
  </v-container>
</template>

<script>
  import * as Ace from 'ace-builds/src-noconflict/ace'
//  var Ace = require('ace-builds/src-noconflict/ace')
//  var TextMode = Ace.require('ace/mode/text').Mode
  console.log(Ace)
  export default {
    components: {
      Ace
    },
    data: function () {
      return {
        code: 'Transcript cr; show: \'Hello world!\''
      }
    },
    mounted () {},
    methods: { }
  }
</script>

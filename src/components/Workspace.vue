<template>
  <v-container fluid>
    <v-layout row wrap>
      <ace-editor v-model="code" min-lines="3" max-lines="30"></ace-editor>
      <pre><code>{{ code }}</code></pre>
      <textarea style="width: 100%;" rows="5" v-model="code"></textarea>
    </v-layout>
  </v-container>
</template>

<script>
//  import axios from 'axios'
  import './ace/ace.js'
//  import './ace/mode-smalltalk_code.js'
//  import './ace/ace-vue.js'
  export default {
    components: {
//      Ace
    },
    data: function () {
      return {
        code: 'Now is the time for all good men to come to the aid of their party.'
      }
    },
    mounted () {},
    methods: { }
  }
</script>

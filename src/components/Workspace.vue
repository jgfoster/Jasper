<template>
  <v-container fluid>
    <v-layout row wrap>
      <div style='width: 100%'>
        <ace-editor v-model="code" min-lines="3" max-lines="30"></ace-editor>
      </div>
    </v-layout>
  </v-container>
</template>

<script>
  export default {
    data () {
      return {
        code: '| x |\nx := 5.\n^x * 3'
      }
    },
    mounted () { },
    methods: { }
  }
</script>

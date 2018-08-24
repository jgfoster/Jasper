<template>
  <v-container fluid>
    <v-layout row wrap>
       <vue-plotly :data="data" :layout="layout" :options="options"/>
    </v-layout>
  </v-container>
</template>

<script>
  import axios from 'axios'
  import VuePlotly from '@statnett/vue-plotly'

  export default {
    components: {
      VuePlotly
    },
    data: function () {
      return {
        data: [],
        layout: {},
        options: {}
      }
    },
    mounted () {
      axios.get(process.env.URL + 'stats').then(result => {
        this.data = result.data.data
        this.layout = result.data.layout
        this.options = result.data.options
      }, error => {
        console.error(error)
      })
    },
    methods: { }
  }
</script>

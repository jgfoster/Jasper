<template>
  <v-container fluid>
    <v-layout row wrap>
      <vue-plotly :data="data" :layout="layout" :options="options"/>
    </v-layout>
  </v-container>
</template>

<script>
//  import axios from 'axios'
  import VuePlotly from '@statnett/vue-plotly'

  export default {
    components: {
      VuePlotly
    },
    data: function () {
      return {
        data: [{ x: [1, 3], y: [2, 4] }],
        layout: {},
        options: {}
      }
    },
//    mounted () {},
    methods: { }
  }
</script>

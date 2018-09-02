import Vue from 'vue'

var footer = {
  name: 'JasperFooter',
  data: function () {
    return {
      stone: null,
      user: null
    }
  },
  methods: { },
  mounted () { },
  template: `<div>
  <v-container fluid my-1 py-0>
    <v-layout>
      <v-flex xs-3 pt-2>
        {{ this.$store.state.stone }}
      </v-flex>
      <v-flex xs-3 pt-2>
        {{ this.$store.state.user }}
      </v-flex>
      <v-flex xs-3 pt-2>
        {{ this.$store.state.lastCall }}
      </v-flex>
    </v-layout>
  </v-container>
</div>`
}

Vue.component('jasper-footer', footer)

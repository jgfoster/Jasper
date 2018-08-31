import Vue from 'vue'

var footer = {
  name: 'JasperFooter',
  data: function () {
    return {
    }
  },
  methods: {
    softBreak () {
      this.$store.dispatch('server', {
        path: 'softBreak',
        args: { },
        result: result => { },
        error: error => { }
      })
    }
  },
  mounted () { },
  template: `<div>
  <v-container fluid my-1 py-0>
    <v-layout>
      <v-flex xs-3>
        {{ this.$store.state.stone }}
      </v-flex>
      <v-flex xs-3>
        {{ this.$store.state.user }}
      </v-flex>
      <v-flex xs-3>
        {{ this.$store.state.user }}
      </v-flex>
      <v-flex xs-3>
        <v-btn
          small
          v-on:click='softBreak'
          :disabled='!this.$store.state.isCallInProgress'>Soft Break</v-btn>
      </v-flex>
    </v-layout>
  </v-container>
</div>`
}

Vue.component('jasper-footer', footer)

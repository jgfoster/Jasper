import Vue from 'vue'

var footer = {
  name: 'JasperFooter',
  data: function () {
    return {
      stone: null,
      user: null
    }
  },
  methods: {
    softBreak () {
      this.$store.dispatch('server', {
        path: 'softBreak',
        args: { },
        result: result => { },
        error: error => { console.log(error) }
      })
    }
  },
  mounted () {
    this.$store.dispatch('server', {
      path: 'footer',
      args: {},
      result: data => {
        this.stone = data.stone
        this.user = data.user
      },
      error: error => { console.log(error) }
    })
  },
  template: `<div>
  <v-container fluid my-1 py-0>
    <v-layout>
      <v-flex xs-3 pt-2>
        {{ this.stone }}
      </v-flex>
      <v-flex xs-3 pt-2>
        {{ this.user }}
      </v-flex>
      <v-flex xs-3 pt-2>
        {{ this.$store.state.lastCall }}
      </v-flex>
      <v-flex xs-3>
        {{ this.$store.state.thisCall }}
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

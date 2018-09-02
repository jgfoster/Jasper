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
  mounted () {
    this.$store.dispatch('server', {
      path: 'footer',
      result: data => {
        this.stone = data.stone
        this.user = data.user
      }
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
    </v-layout>
  </v-container>
</div>`
}

Vue.component('jasper-footer', footer)

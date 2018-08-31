import Vue from 'vue'

var footer = {
  name: 'JasperFooter',
  data: function () {
    return {
      session: '1234'
    }
  },
  methods: {},
  mounted () { },
  template: `<div>
  <v-container fluid my-1 py-0>
    <v-layout>
      <v-flex xs-6>
        {{ session }}
      </v-flex>
      <v-flex xs-6>
        XYZ
      </v-flex>
    </v-layout>
  </v-container>
</div>`
}

Vue.component('jasper-footer', footer)

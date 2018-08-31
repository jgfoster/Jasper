/*
 * Based on https://github.com/oleg-agapov/basic-spa-vue-firebase
 */

import Vue from 'vue'
import App from './App'
import router from './router'
import Vuetify from 'vuetify'
import 'vuetify/dist/vuetify.min.css'
import { store } from './store'
import { library } from '@fortawesome/fontawesome-svg-core'
import * as faIcons from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import './ace-builds/src-noconflict/ace'
import './ace-vue.js'
import axios from 'axios'

Object.defineProperty(Vue.prototype, '$axios', { value: axios })

library.add(
  faIcons.faChartLine,
  faIcons.faEdit,
  faIcons.faGem,
  faIcons.faSignInAlt,
  faIcons.faSignOutAlt,
  faIcons.faUserPlus,
  faIcons.faUsers
)

Vue.component('font-awesome-icon', FontAwesomeIcon)

Vue.use(Vuetify)

Vue.config.productionTip = false

/* eslint-disable no-new */
new Vue({
  el: '#app',
  router,
  store,
  render: h => h(App),
  created () {}
})

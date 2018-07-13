import Vue from 'vue';
import App from './App.vue';

import styles from './assets/style.scss';

import {
    icon,
} from 'vue-fontawesome';

Vue.component('vf-icon', icon);

new Vue({
  el: '#app',
  render: h => h(App)
});

import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)

export const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: {
    appTitle: 'Jasper',
    user: null,
    error: null,
    loading: false,
    isAuthenticated: false
  },
  mutations: {
    userSignIn (state, payload) {
      state.isAuthenticated = true
    },
    userSignOut (state, payload) {
      state.isAuthenticated = false
    },
    userSignUp (state, payload) {
      state.isAuthenticated = true
    }
  },
  actions: {
  },
  getters: {
  }
})

import Vue from 'vue'
import Vuex from 'vuex'
import axios from 'axios'
import router from '@/router'

Vue.use(Vuex)

export const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: {
    appTitle: 'Jasper',
    error: null,
    loading: false,
    session: null
  },
  mutations: {
    setError (state, payload) {
      state.error = payload
    },
    setLoading (state, payload) {
      state.loading = payload
    },
    setSession (state, payload) {
      state.session = payload
      if (payload !== null) {
        window.sessionStorage.setItem('session', payload)
      } else {
        window.sessionStorage.removeItem('session')
      }
    }
  },
  actions: {
    userSignUp ({commit}, payload) { },
    userSignIn ({commit}, payload) {
      commit('setLoading', true)
      axios.post(process.env.URL + 'signIn', payload)
      .then(result => {
        commit('setLoading', false)
        if (result.data.success) {
          commit('setSession', result.data.session)
          router.push('/')
        } else {
          commit('setError', result.data.error)
        }
      })
      .catch(error => {
        commit('setError', error.message)
        commit('setLoading', false)
      })
    },
    userSignOut ({commit}, payload) {
      axios.post(process.env.URL + 'signOut', {session: this.state.session})
      .then(result => {
        if (result.data.success) {
          commit('setSession', null)
          router.push('/')
        } else {
          commit('setError', result.data.error)
        }
      })
      .catch(error => {
        console.log(error)
      })
      commit('setSession', null)
      router.push('/')
    }
  },
  getters: {
    isAuthenticated (state) {
      return state.session !== null && state.session !== undefined
    },
    session (state) {
      return state.session
    }
  }
})

store.commit('setSession', window.sessionStorage.getItem('session'))

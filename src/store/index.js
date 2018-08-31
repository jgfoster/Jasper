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
    isCallInProgress: false,
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
    server ({commit}, payload) {
      payload.args.session = this.state.session
      this.isCallInProgress = true
      axios.post(process.env.URL + payload.path, payload.args)
      .then(result => {
        this.isCallInProgress = false
        payload.result(result)
      }, error => {
        this.isCallInProgress = false
        if (payload.error) {
          payload.error(error)
        } else {
          console.error(error)
        }
      })
    },
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
      return state.session !== null
    },
    isCallInProgress (state) {
      return state.isCallInProgress
    },
    session (state) {
      return state.session
    },
    sessionOrNone (state) {
      return state.session ? state.session : 'none'
    }
  }
})

store.commit('setSession', window.sessionStorage.getItem('session'))

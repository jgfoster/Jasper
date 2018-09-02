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
    lastCall: null,
    thisCall: null,
    session: null
  },
  mutations: {
    setError (state, payload) {
      state.error = payload
    },
    setIsCallInProgress (state, payload) {
      state.isCallInProgress = payload
    },
    setLoading (state, payload) {
      state.loading = payload
    },
    setLastCall (state, payload) {
      state.lastCall = payload
    },
    setThisCall (state, payload) {
      state.thisCall = payload
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
      var seconds = 0
      var msStart = (new Date()).getTime()
      this.commit('setThisCall', payload.path + ' (0)')
      var timer = setInterval(() => {
        seconds = seconds + 1
        this.commit('setThisCall', payload.path + ' (' + seconds + ')')
      }, 1000) // milliseconds
      payload.args.session = this.state.session
      this.commit('setIsCallInProgress', true)
      axios.post(process.env.URL + payload.path, payload.args)
      .then(result => {
        clearInterval(timer)
        this.commit('setThisCall', null)
        this.commit('setIsCallInProgress', false)
        var msStop = (new Date()).getTime()
        var string = payload.path +
          ' (' + result.data.time + 'ms server + ' +
          (msStop - msStart - result.data.time) + 'ms network)'
        console.log(string)
        this.commit('setLastCall', string)
        delete result.data.success
        delete result.data.time
        payload.result(result.data)
      }, error => {
        clearInterval(timer)
        this.commit('setThisCall', null)
        this.commit('setIsCallInProgress', false)
        if (payload.error) {
          payload.error(error)
        } else {
          console.error(error)
        }
      })
    },
    timerTick () { },
    userSignUp ({commit}, payload) { },
    userSignIn ({commit}, payload) {
      commit('setLoading', true)
      store.dispatch('server', {
        path: 'signIn',
        args: payload,
        result: data => {
          commit('setLoading', false)
          commit('setSession', data.session)
          router.push('/')
        },
        error: error => {
          commit('setError', error.message)
          commit('setLoading', false)
        }
      })
    },
    userSignOut ({commit}, payload) {
      store.dispatch('server', {
        path: 'signOut',
        args: { },
        session: this.state.session,
        result: data => {
          if (data.success) {
            commit('setSession', null)
            router.push('/')
          } else {
            commit('setError', data.error)
          }
        },
        error: error => {
          console.log(error)
        }
      })
      commit('setSession', null)
      router.push('/')
    }
  },
  getters: {
    isAuthenticated (state) {
      return state.session !== null
    },
    session (state) {
      return state.session
    }
  }
})

store.commit('setSession', window.sessionStorage.getItem('session'))

import Vue from 'vue'
import Vuex from 'vuex'
import axios from 'axios'
import router from '@/router'

Vue.use(Vuex)

export const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: {
    error: null,
    isCallInProgress: false,
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
    setLastCall (state, payload) {
      state.lastCall = payload
    },
    setSession (state, payload) {
      state.session = payload
      if (payload !== null) {
        window.sessionStorage.setItem('session', payload)
      } else {
        window.sessionStorage.removeItem('session')
      }
    },
    setThisCall (state, payload) {
      state.thisCall = payload
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
      var args = payload.args ? payload.args : { }
      args.session = this.state.session
      this.commit('setIsCallInProgress', true)
      var after = (data) => {
        clearInterval(timer)
        this.commit('setThisCall', null)
        this.commit('setIsCallInProgress', false)
        var msStop = (new Date()).getTime()
        var string = payload.path +
          ' (' + data.time + 'ms server + ' +
          (msStop - msStart - data.time) + 'ms network)'
        console.log(string)
        this.commit('setLastCall', string)
      }
      axios.post(process.env.URL + payload.path, args)
      .then(result => {
        console.log(payload.path, result)
        after(result.data)
        var flag = result.data.success
        delete result.data.success
        delete result.data.time
        if (flag) {
          if (payload.result) {
            payload.result(result.data)
          }
        } else {
          if (payload.error) {
            payload.error(result.data.error)
          } else {
            commit('setError', result.data.error)
          }
        }
      }, error => {
        after(error)
        if (payload.error) {
          payload.error(error)
        } else {
          commit('setError', error)
        }
      })
    },
    timerTick () { },
    userSignUp ({commit}, payload) { },
    userSignIn ({commit}, payload) { debugger },
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

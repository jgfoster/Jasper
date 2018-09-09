import Vue from 'vue'
import Vuex from 'vuex'
import axios from 'axios'
// import router from '@/router'

Vue.use(Vuex)

export const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: {
    error: null,
    isCallInProgress: false,
    lastCall: null,
    thisCall: null,
    session: null,
    stone: null,
    user: null
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
      if (payload === null) {
        window.sessionStorage.removeItem('session')
      } else {
        window.sessionStorage.setItem('session', payload)
      }
    },
    setThisCall (state, payload) {
      state.thisCall = payload
    },
    setStone (state, payload) {
      state.stone = payload
      if (payload === null) {
        window.sessionStorage.removeItem('stone')
      } else {
        window.sessionStorage.setItem('stone', payload)
      }
    },
    setUser (state, payload) {
      state.user = payload
      if (payload === null) {
        window.sessionStorage.removeItem('user')
      } else {
        window.sessionStorage.setItem('user', payload)
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
          (msStop - msStart - data.time) + 'ms other)'
        console.log(string)
        this.commit('setLastCall', string)
      }
      axios.post(process.env.URL + payload.path, args)
      .then(result => {
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
store.commit('setStone', window.sessionStorage.getItem('stone'))
store.commit('setUser', window.sessionStorage.getItem('user'))

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
    msInLastCall: null,
    secondsInCall: null,
    session: null,
    stone: '(no stone)',
    user: '(no user)'
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
    setMsInLastCall (state, payload) {
      state.msInLastCall = payload
    },
    setSecondsInCall (state, payload) {
      state.secondsInCall = payload
    },
    setSession (state, payload) {
      state.session = payload
      if (payload !== null) {
        window.sessionStorage.setItem('session', payload)
      } else {
        window.sessionStorage.removeItem('session')
      }
    },
    setStone (state, payload) {
      state.stone = payload
    },
    setUser (state, payload) {
      state.user = payload
    }
  },
  actions: {
    server ({commit}, payload) {
      console.log(this)
      var timer = setInterval(() => {
        console.log('timerTick', this.secondsInCall)
        this.commit('setSecondsInCall', (this.secondsInCall ? this.secondsInCall : 0) + 1)
      }, 1000) // milliseconds
      payload.args.session = this.state.session
      this.commit('setIsCallInProgress', true)
      axios.post(process.env.URL + payload.path, payload.args)
      .then(result => {
        clearInterval(timer)
        this.commit('setSecondsInCall', null)
        this.commit('setIsCallInProgress', false)
        this.commit('setMsInLastCall', result.data.time)
        delete result.time
        payload.result(result.data)
      }, error => {
        clearInterval(timer)
        this.commit('setSecondsInCall', null)
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
      axios.post(process.env.URL + 'signIn', payload)
      .then(result => {
        commit('setLoading', false)
        if (result.data.success) {
          commit('setSession', result.data.session)
          commit('setStone', result.data.stone)
          commit('setUser', result.data.user)
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
      commit('setStone', '(no stone)')
      commit('setUser', '(no user)')
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

<template>
  <v-container fluid>
    <v-layout row wrap>
      <v-flex xs12 class="text-xs-center" mt-5>
        <h1>GemStone Sign In</h1>
      </v-flex>
      <v-flex xs12 sm6 offset-sm3 mt-3>
        <form @submit.prevent="userSignIn">
          <v-layout column>
            <v-flex>
              <v-alert type="error" dismissible v-model="alert">
                {{ error }}
              </v-alert>
            </v-flex>
            <v-flex>
              <v-text-field
                name="userID"
                label="User ID"
                id="userID"
                type="text"
                ref="userID"
                v-model="userID"
                autocomplete="username"
                required></v-text-field>
            </v-flex>
            <v-flex>
              <v-text-field
                name="password"
                label="Password"
                id="password"
                type="password"
                v-model="password"
                autocomplete="current-password"
                required></v-text-field>
            </v-flex>
            <v-flex class="text-xs-center" mt-5>
              <v-btn color="primary" type="submit">Sign In</v-btn>
            </v-flex>
          </v-layout>
        </form>
      </v-flex>
    </v-layout>
  </v-container>
</template>

<script>
export default {
  data () {
    return {
      userID: '',
      password: '',
      alert: false
    }
  },
  methods: {
    userSignIn () {
      this.$store.dispatch('userSignIn', { userID: this.userID, password: this.password })
    }
  },
  computed: {
    error () {
      return this.$store.state.error
    },
    loading () {
      return this.$store.state.loading
    }
  },
  mounted () { this.$nextTick(() => this.$refs.userID.focus()) },
  watch: {
    error (value) {
      if (value) {
        this.alert = true
      }
    },
    alert (value) {
      if (!value) {
        this.$store.commit('setError', null)
      }
    }
  }
}
</script>

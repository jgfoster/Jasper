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
      password: ''
    }
  },
  methods: {
    userSignIn () {
      this.$store.dispatch('server', {
        path: 'signIn',
        args: { userID: this.userID, password: this.password },
        result: data => {
          this.$store.commit('setSession', data.session)
          this.$store.commit('setStone', data.stone)
          this.$store.commit('setUser', data.user)
          this.$router.push('/')
        }
      })
    }
  },
  // https://vuejs.org/v2/guide/custom-directive.html has a focus but it didn't work
  mounted () { this.$nextTick(() => this.$refs.userID.focus()) }
}
</script>

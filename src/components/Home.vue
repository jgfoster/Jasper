<template>
  <v-container fluid>
    <v-layout row wrap>
      <v-flex xs12>
        <div v-for="(value, key) in this.info">
          {{ key }}: {{ value }}
        </div>
      </v-flex>
    </v-layout>
  </v-container>
</template>

<script>
  export default {
    data () {
      return {
        info: {}
      }
    },
    computed: {
      isAuthenticated () {
        return this.$store.getters.isAuthenticated
      },
      session () {
        return this.$store.getters.session
      }
    },
    mounted () {
      this.$store.dispatch('server', {
        path: 'home',
        args: {},
        result: data => {
          this.info = data
        }
      })
    },
    methods: { }
  }
</script>

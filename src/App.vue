<template>
  <!--  https://vuetifyjs.com/en/layout/pre-defined  -->
  <v-app j-app-1>
    <v-navigation-drawer app v-model="sidebar">
      <v-list>
        <v-list-tile
          v-for="item in menuItems"
          :key="item.title"
          :to="item.path">
          <v-list-tile-action>
          <font-awesome-icon :icon="item.icon" />&nbsp;
          </v-list-tile-action>
          <v-list-tile-content>{{ item.title }}</v-list-tile-content>
        </v-list-tile>
        <v-list-tile v-if="isAuthenticated" @click="signOut">
          <v-list-tile-action>
            <font-awesome-icon icon="sign-out-alt" />
          </v-list-tile-action>
          <v-list-tile-content>Sign Out</v-list-tile-content>
        </v-list-tile>
      </v-list>
    </v-navigation-drawer>
    <v-toolbar app dense>
      <span class="hidden-sm-and-up">
        <v-toolbar-side-icon @click="sidebar = !sidebar">
        </v-toolbar-side-icon>
      </span>
      <v-toolbar-title>
        <router-link to="/" tag="span" style="cursor: pointer">
          Jasper
        </router-link>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-toolbar-items class="hidden-xs-only">
        <v-btn
          flat
          v-for="item in menuItems"
          :key="item.title"
          :to="item.path">
          <font-awesome-icon :icon="item.icon" />&nbsp;
          {{ item.title }}
        </v-btn>
        <v-btn flat v-if="isAuthenticated" @click="signOut">
          <font-awesome-icon icon="sign-out-alt" />&nbsp;
          Sign Out
        </v-btn>
      </v-toolbar-items>
    </v-toolbar>
    <v-content app j-app-2>
      <v-container fluid pa-0 style="position:fixed; top:52px; bottom:40px" j-app-3>
        <v-layout column fill-height j-app-4>
          <v-flex xs-12 style="overflow=auto" j-error>
            <v-alert type="error" dismissible="true" v-model="alert">
              <pre>{{ error }}</pre>
            </v-alert>
          </v-flex>
          <v-flex xs-12 style="overflow=auto" j-alert>
            <v-dialog
              v-model="this.$store.state.isCallInProgress"
              persistent
            >
              <v-container fill-height fluid>
                <v-layout row wrap align-center>
                  <v-flex xs-12 text-xs-center>
                    <v-card>
                      <img
                        :src="require('@/assets/GemStone.jpg')"
                        height="128px"
                      ></img>
                      <v-card-text>
                        {{ this.$store.state.thisCall }}
                        <v-progress-linear
                          indeterminate
                          color="white"
                          class="mb-0"
                        ></v-progress-linear>
                      </v-card-text>
                      <v-card-actions text-xs-center>
                        <v-btn small v-on:click='softBreak' color="red">Soft Break</v-btn>
                      </v-card-actions>
                    </v-card>
                  </v-flex>
                </v-layout>
              </v-container>
            </v-dialog>
          </v-flex>
          <v-flex xs-12 fill-height style="overflow=auto" j-router>
            <router-view>
              <!-- contents replaced by router/index.js (https://router.vuejs.org/) -->
            </router-view>
          </v-flex>
        </v-layout>
      </v-container>
    </v-content>
    <jasper-footer app></jasper-footer>
  </v-app>
</template>

<script>
  import './Components/Footer'
  export default {
    data () {
      return {
        alert: false,
        sidebar: false
      }
    },
    computed: {
      error () {
        return this.$store.state.error
      },
      isAuthenticated () {
        return this.$store.getters.isAuthenticated
      },
      menuItems () {
        if (this.isAuthenticated) {
          return [
            //  common
            { title: 'Stone', path: '/stone', icon: 'gem' },
            { title: 'Gems', path: '/gems', icon: 'users' },
            { title: 'Stats', path: '/stats', icon: 'chart-line' },
            //  available when signed in
            { title: 'Gem', path: '/gem', icon: 'gem' },
            { title: 'Workspace', path: '/workspace', icon: 'edit' },
            { title: 'Browser', path: '/browser', icon: 'edit' }
          ]
        } else {
          return [
            //  common
            { title: 'Stone', path: '/stone', icon: 'gem' },
            { title: 'Gems', path: '/gems', icon: 'users' },
            { title: 'Stats', path: '/stats', icon: 'chart-line' },
            //  available when not signed in
//          { title: 'Sign Up', path: '/signup', icon: 'user-plus' },
            { title: 'Sign In', path: '/signin', icon: 'sign-in-alt' }
          ]
        }
      }
    },
    methods: {
      softBreak () {
        this.$store.dispatch('server', { path: 'softBreak' })
      },
      signOut () {
        this.$store.dispatch('server', {
          path: 'signOut',
          result: data => {
            this.$store.commit('setSession', null)
            this.$store.commit('setStone', null)
            this.$store.commit('setUser', null)
            this.$router.push('/')
          }
        })
      }
    },
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

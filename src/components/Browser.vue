<template>
  <v-container pa-1 fluid j-browser>
    <v-layout row wrap>
      <v-flex xs12>
        <v-container pa-0 fluid j-top>
          <v-layout column>
            <v-flex xs-12 j-top>
              <v-container pa-0 fluid>
                <v-layout row wrap>
                  <v-flex xs-4 j-dictionaries>
                    <v-list dense subheader>
                      <v-list-tile
                        v-for="item in browser.dictionaries"
                        :key="item.name"
                        @click="selectedDictionary(item)"
                      >
                        <v-list-tile-content>
                          <v-list-tile-title v-text="item.name"></v-list-tile-title>
                        </v-list-tile-content>
                      </v-list-tile>
                    </v-list>
                  </v-flex>
                  <v-flex xs-4 j-classes>
                    <v-list dense subheader>
                      <v-list-tile
                        v-for="item in browser.classes"
                        :key="item.name"
                        @click="selectedClass(item)"
                      >
                        <v-list-tile-content>
                          <v-list-tile-title v-text="item.name"></v-list-tile-title>
                        </v-list-tile-content>
                      </v-list-tile>
                    </v-list>
                  </v-flex>
                  <v-flex xs-4 j-methods>
                    <v-list dense subheader>
                      <v-list-tile
                        v-for="item in browser.methods"
                        :key="item"
                      >
                        <v-list-tile-content>
                          <v-list-tile-title v-text="item"></v-list-tile-title>
                        </v-list-tile-content>
                      </v-list-tile>
                    </v-list>
                  </v-flex>
                </v-layout>
              </v-container>
            </v-flex>
          </v-layout>
        </v-container>
      </v-flex>
        <v-flex xs-12 j-bottom>
          bottom
        </v-flex>
    </v-layout>
  </v-container>
</template>

<script>
  export default {
    data () {
      return {
        browser: {
          dictionaries: [],
          classCategories: [],
          classes: [],
          methodCategories: [],
          methods: []
        },
        selections: {
          dictionary: null,
          classCategory: null,
          aClass: null,
          methodCategory: null,
          method: null
        }
      }
    },
    mounted () {
      this.update()
    },
    methods: {
      selectedClass (item) {
        this.selections.class = item.oop
        this.update()
      },
      selectedDictionary (item) {
        this.selections.dictionary = item.oop
        this.update()
      },
      update () {
        this.$store.dispatch('server', {
          path: 'browser',
          args: this.selections,
          result: data => {
            console.log(data)
            this.browser = data
          }
        })
      }
    }
  }
</script>

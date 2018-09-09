<template>
  <v-container pa-1 fluid j-browser>
    <v-layout column wrap>
      <v-flex xs12 j-top>
        <v-container pa-0 fluid>
          <v-layout row wrap>
            <v-flex xs-4 j-dictionaries>
              <v-list dense subheader>
                <v-list-tile
                  v-for="item in browser.dictionaries"
                  :key="item.oop"
                  :color="item.color"
                  @click="selectedDictionary(item)"
                >
                  <v-list-tile-content>
                    <v-list-tile-title v-text="item.name"></v-list-tile-title>
                  </v-list-tile-content>
                </v-list-tile>
              </v-list>
            </v-flex>
            <v-flex xs-4 j-classCategories>
              <v-list dense subheader>
                <v-list-tile
                  v-for="item in browser.classCategories"
                  :key="item.name"
                  :color="item.color"
                  @click="selectedClassCategory(item)"
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
                  :key="item.oop"
                  :color="item.color"
                  @click="selectedClass(item)"
                >
                  <v-list-tile-content>
                    <v-list-tile-title v-text="item.name"></v-list-tile-title>
                  </v-list-tile-content>
                </v-list-tile>
              </v-list>
            </v-flex>
            <v-flex xs-4 j-methodCategories>
              <v-list dense subheader>
                <v-list-tile
                  v-for="item in browser.methodCategories"
                  :key="item.name"
                  :color="item.color"
                  @click="selectedMethodCategory(item)"
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
                  :key="item.name"
                  :color="item.color"
                  @click="selectedMethod(item)"
                >
                  <v-list-tile-content>
                    <v-list-tile-title v-text="item.name"></v-list-tile-title>
                  </v-list-tile-content>
                </v-list-tile>
              </v-list>
            </v-flex>
          </v-layout>
        </v-container>
      </v-flex>
      <v-flex xs-12 j-bottom>
        <div style='width: 100%' j-ace-editor>
          <ace-editor v-model='browser.code' min-lines='20' max-lines='50'></ace-editor>
        </div>
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
          code: '',
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
        if (this.selections.aClass === item.oop) {
          this.selections.aClass = null
        } else {
          this.selections.aClass = item.oop
        }
        this.update()
      },
      selectedClassCategory (item) {
        if (this.selections.classCategory === item.name) {
          this.selections.classCategory = null
        } else {
          this.selections.classCategory = item.name
        }
        this.update()
      },
      selectedDictionary (item) {
        if (this.selections.dictionary === item.oop) {
          this.selections.dictionary = null
        } else {
          this.selections.dictionary = item.oop
        }
        this.update()
      },
      selectedMethod (item) {
        if (this.selections.method === item.name) {
          this.selections.method = null
        } else {
          this.selections.method = item.name
        }
        this.update()
      },
      selectedMethodCategory (item) {
        if (this.selections.methodCategory === item.name) {
          this.selections.methodCategory = null
        } else {
          this.selections.methodCategory = item.name
        }
        this.update()
      },
      update () {
        this.$store.dispatch('server', {
          path: 'browser',
          args: this.selections,
          result: data => {
            this.browser = data
            // selected dictionary
            var x = data.dictionaries.find(obj => {
              return obj.oop === this.selections.dictionary
            })
            if (x) { x.color = 'red' } else { this.selections.dictionary = null }
            // class categories
            x = data.classCategories.find(obj => {
              return obj.name === this.selections.classCategory
            })
            if (x) { x.color = 'red' } else { this.selections.classCategory = null }
            // classes
            x = data.classes.find(obj => {
              return obj.oop === this.selections.aClass
            })
            if (x) { x.color = 'red' } else { this.selections.aClass = null }
            // method categories
            x = data.methodCategories.find(obj => {
              return obj.name === this.selections.methodCategory
            })
            if (x) { x.color = 'red' } else { this.selections.methodCategory = null }
            // methods
            x = data.methods.find(obj => {
              return obj.name === this.selections.method
            })
            if (x) { x.color = 'red' } else { this.selections.method = null }
            // method code
            this.$nextTick(() => {
              this.editor.moveCursorTo(0, 0)
              this.editor.focus()
            })
          }
        })
      }
    }
  }
</script>

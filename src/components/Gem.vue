<template>
  <v-container fluid>
    <v-layout row wrap>
      <v-flex xs12>
        <div>
          Session: {{ session }}
        </div>
        <div>
          User: {{ user }}
        </div>
      </v-flex>
      <v-expansion-panel expand inset>
        <v-expansion-panel-content>
          <div slot="header">Version</div>
          <v-data-table
            :items="this.version"
            class="elevation-1"
            hide-actions
            hide-headers
          >
            <template slot="items" slot-scope="props">
              <td>{{ props.item[0] }}</td>
              <td>{{ props.item[1] }}</td>
            </template>
          </v-data-table>
        </v-expansion-panel-content>
        <v-expansion-panel-content>
          <div slot="header">Config</div>
                <v-data-table
            :items="this.config"
            class="elevation-1"
            hide-actions
            hide-headers
          >
            <template slot="items" slot-scope="props">
              <td>{{ props.item[0] }}</td>
              <td>{{ props.item[1] }}</td>
            </template>
          </v-data-table>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-layout>
  </v-container>
</template>

<script>
  export default {
    data () {
      return {
        config: [],
        session: null,
        user: '',
        version: []
      }
    },
    mounted () {
      this.$axios.post(process.env.URL + 'gem', {session: this.$store.state.session})
      .then(result => {
        this.config = result.data.config
        this.session = result.data.session
        this.user = result.data.user
        this.version = result.data.version
      }, error => {
        console.error(error)
      })
    },
    methods: { }
  }
</script>

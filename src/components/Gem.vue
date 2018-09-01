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
      this.$store.dispatch('server', {
        path: 'gem',
        args: {},
        result: data => {
          this.config = data.config
          this.session = data.session
          this.user = data.user
          this.version = data.version
        }
      })
    },
    methods: { }
  }
</script>

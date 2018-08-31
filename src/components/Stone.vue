<template>
  <v-container fluid>
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
      <v-expansion-panel-content>
        <div slot="header">History</div>
        <v-card>
          <v-card-text>
            {{ this.history }}
          </v-card-text>
        </v-card>
      </v-expansion-panel-content>
    </v-expansion-panel>
  </v-container>
</template>

<script>
  export default {
    data () {
      return {
        config: [],
        history: '',
        version: []
      }
    },
    mounted () {
      this.$store.dispatch('server', {
        path: 'stone',
        args: {},
        result: result => {
          this.config = result.data.config
          this.history = result.data.history
          this.version = result.data.version
        }
      })
    },
    methods: { }
  }
</script>

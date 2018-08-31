<template>
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
      this.$axios.get(process.env.URL + 'stone').then(result => {
        this.config = result.data.config
        this.history = result.data.history
        this.version = result.data.version
      }, error => {
        console.error(error)
      })
    },
    methods: { }
  }
</script>

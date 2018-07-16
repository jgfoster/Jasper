<template>
  <v-expansion-panel expand inset>
    <v-expansion-panel-content>
      <div slot="header">Version</div>
      <v-data-table
        :items="this.$store.state.stoneVersion"
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
        :items="this.$store.state.stoneConfig"
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
          {{ this.$store.state.stoneHistory }}
        </v-card-text>
      </v-card>
    </v-expansion-panel-content>
  </v-expansion-panel>
</template>

<script>
  export default {}
</script>

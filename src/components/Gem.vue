<template>
  <v-expansion-panel expand inset>
    <v-expansion-panel-content>
      <div slot="header">User</div>
      <v-data-table
        :items="this.$store.state.gemUser"
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
      <div slot="header">Version</div>
      <v-data-table
        :items="this.$store.state.gemVersion"
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
        :items="this.$store.state.gemConfig"
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
</template>

<script>
  export default {}
</script>

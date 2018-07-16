<template>
  <v-data-table
    :headers="this.$store.state.gemsHeader"
    :items="this.$store.state.gemsData"
    class="elevation-1"
    hide-actions
  >
    <template slot="items" slot-scope="props">
      <td>{{ props.item.id }}</td>
      <td>{{ props.item.serial }}</td>
      <td>{{ props.item.descr }}</td>
      <td>{{ props.item.user }}</td>
      <td>{{ props.item.host }}</td>
      <td>{{ props.item.pid }}</td>
      <td>{{ props.item.viewAge }}</td>
      <td>{{ props.item.oldestCR }}</td>
      <td>{{ props.item.backlog }}</td>
      <td>{{ props.item.prim }}</td>
      <td>{{ props.item.state }}</td>
      <td>{{ props.item.trans }}</td>
      <td>{{ props.item.age }}</td>
      <td>{{ props.item.quiet }}</td>
      <td>{{ props.item.ip }}</td>
      <td>{{ props.item.hostId }}</td>
      <td>{{ props.item.priority }}</td>
      <td>{{ props.item.vote }}</td>
      <td>{{ props.item.objects }}</td>
      <td>{{ props.item.pages }}</td>
      <td>{{ props.item.oop }}</td>
    </template>
  </v-data-table>
</template>

<script>
  export default {}
</script>

<template>
  <v-data-table
    :headers="this.headers"
    :items="this.gems"
    class="elevation-1"
    hide-actions
  >
    <template slot="items" slot-scope="props">
      <td class="text-xs-right">{{ props.item.id }}</td>
      <td class="text-xs-right">{{ props.item.serial }}</td>
      <td>{{ props.item.descr }}</td>
      <td>{{ props.item.user }}</td>
      <td>{{ props.item.host }}</td>
      <td class="text-xs-right">{{ props.item.pid }}</td>
      <td class="text-xs-right">{{ props.item.gci }}</td>
      <td class="text-xs-right">{{ props.item.viewAge }}</td>
      <td class="text-xs-center">{{ props.item.oldestCR }}</td>
      <td class="text-xs-right">{{ props.item.backlog }}</td>
      <td class="text-xs-right">{{ props.item.prim }}</td>
      <td class="text-xs-right">{{ props.item.state }}</td>
      <td class="text-xs-right">{{ props.item.trans }}</td>
      <td class="text-xs-right">{{ props.item.age }}</td>
      <td class="text-xs-right">{{ props.item.quiet }}</td>
      <td>{{ props.item.ip }}</td>
      <td>{{ props.item.hostId }}</td>
      <td class="text-xs-right">{{ props.item.priority }}</td>
      <td class="text-xs-right">{{ props.item.vote }}</td>
      <td class="text-xs-right">{{ props.item.objects }}</td>
      <td class="text-xs-right">{{ props.item.pages }}</td>
      <td>{{ props.item.type }}</td>
      <td>{{ props.item.kerberos }}</td>
      <td class="text-xs-right">{{ props.item.agent }}</td>
      <td class="text-xs-right">{{ props.item.port }}</td>
    </template>
  </v-data-table>
</template>

<script>
  import axios from 'axios'

  export default {
    data () {
      return {
        gems: [],
        headers: [
          {text: 'ID', align: 'center', value: 'id'},
          {text: 'Serial', align: 'center', value: 'serial'},
          {text: 'Description', align: 'center', value: 'descr'},
          {text: 'User', align: 'center', value: 'user'},
          {text: 'Host', align: 'center', value: 'host'},
          {text: 'Gem PID', align: 'center', value: 'pid'},
          {text: 'GCI PID', align: 'center', value: 'gci'},
          {text: 'View Age', align: 'center', value: 'viewAge'},
          {text: 'Has Oldest CR', align: 'center', value: 'oldestCR'},
          {text: 'Backlog', align: 'center', value: 'backlog'},
          {text: 'Primitive', align: 'center', value: 'prim'},
          {text: 'State', align: 'center', value: 'state'},
          {text: 'Transaction', align: 'center', value: 'trans'},
          {text: 'Age', align: 'center', value: 'age'},
          {text: 'Quiet Time', align: 'center', value: 'quiet'},
          {text: 'IP', align: 'center', value: 'id'},
          {text: 'Host Id', align: 'center', value: 'hostId'},
          {text: 'Priority', align: 'center', value: 'priority'},
          {text: 'Vote State', align: 'center', value: 'vote'},
          {text: 'Objects', align: 'center', value: 'objects'},
          {text: 'Pages', align: 'center', value: 'pages'},
          {text: 'Type', align: 'center', value: 'type'},
          {text: 'Kerberos', align: 'center', value: 'kerberos'},
          {text: 'Host Agent', align: 'center', value: 'agent'},
          {text: 'Agent Port', align: 'center', value: 'port'}
        ]
      }
    },
    mounted () {
      axios({ method: 'GET', 'url': 'https://localhost:8888/gems' }).then(result => {
        this.gems = result.data
      }, error => {
        console.error(error)
      })
    },
    methods: { }
  }
</script>

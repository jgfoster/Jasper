<template>
  <v-container fluid>
    <v-layout row wrap>
      <v-flex xs12>
        <v-data-table
          :headers="this.headers"
          :items="this.gems"
          class="elevation-1"
          hide-actions
        >
          <template slot="headerCell" slot-scope="props">
            <v-tooltip bottom>
              <span slot="activator">
                {{ props.header.text }}
              </span>
              <span>
                {{ props.header.tip }}
              </span>
            </v-tooltip>
          </template>
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
      </v-flex>
      <v-flex xs9>
        <v-slider
          v-model="sleep"
          :max="60"
          height=75
          label="Refresh interval in seconds"
        ></v-slider>
      </v-flex>
      <v-flex xs1>
        <v-text-field
          v-model="sleep"
          reverse
          type="number"
        ></v-text-field>
      </v-flex>
      <v-flex xs1 mt-0>
        <v-text-field
          v-model="slept"
          disabled reverse
        ></v-text-field>
      </v-flex>
      <v-flex xs1 mt-2>
        <v-btn small v-on:click.native="fetchGemList">Refresh</v-btn>
      </v-flex>
    </v-layout>
  </v-container>
</template>

<script>
  import axios from 'axios'

  export default {
    data () {
      return {
        gems: [],
        headers: [
        /*

 12. The priority of the session (a SmallInteger).
 13. Unique host ID of the host where the session is running (an Integer)
 14. Time of the session''s most recent request to stone (from System timeGmt)
 15. Time the session logged in (from System timeGmt)
 16. Number of commits which have occurred since the session obtained its view.
 17. Nil or a String describing a system or gc gem .
 18. Number of temporary (uncommitted) object IDs allocated to the session.
 19. Number of temporary (non-persistent) page IDs allocated to the session.
 20. A SmallInteger, 0 session has not voted, 1 session voting in progress,
     2 session has voted, or voting not active.
 21. A SmallInteger, processId of the remote GCI client process,
     or -1 if the session has no remote GCI client .
 22. The KerberosPrincipal object used for passwordless login to the session,
     or nil if passwordless login was not used.
 23. The sessionId of the hostagent session through which this session is
     communicating to stone, or -1 if session is not using a hostagent .
 24. SmallInteger listening port if this session is a hostagent, or -1 .
        */
          {text: 'ID', align: 'center', value: 'id', tip: 'The session\'s sessionId (unique among current sessions).'},
          {text: 'Serial', align: 'center', value: 'serial', tip: 'The session\'s serial number (unique since the stone started).'},
          {text: 'Description', align: 'center', value: 'descr', tip: ''},
          {text: 'User', align: 'center', value: 'user', tip: 'The UserProfile of the session; nil if the UserProfile is recently created and not visible from this session\'s transactional view or the session is in login or processing, or has logged out.'},
          {text: 'Host', align: 'center', value: 'host', tip: 'The hostname of the machine running the Gem process. Specifically, the peer\'s hostname as seen by stone, for the gem to stone network connection used for login.'},
          {text: 'Gem PID', align: 'center', value: 'pid', tip: 'The process ID of the Gem or topaz -l process.'},
          {text: 'GCI PID', align: 'center', value: 'gci', tip: ''},
          {text: 'View Age', align: 'center', value: 'viewAge', tip: 'Time since the session\'s most recent beginTransaction, commitTransaction, or abortTransaction.'},
          {text: 'Has Oldest CR', align: 'center', value: 'oldestCR', tip: 'A Boolean whose value is true if the session is currently referencing the oldest commit record, and false if it is not.'},
          {text: 'Backlog', align: 'center', value: 'backlog', tip: ''},
          {text: 'Primitive', align: 'center', value: 'prim', tip: 'Primitive number in which the Gem is executing, or 0 if it is not executing in a long primitive.'},
          {text: 'State', align: 'center', value: 'state', tip: 'The session state.'},
          {text: 'Transaction', align: 'center', value: 'trans', tip: 'A SmallInteger whose value is -1 if the session is in transactionless mode, 0 if it is not in a transaction and 1 if it is in a transaction.'},
          {text: 'Age', align: 'center', value: 'age', tip: ''},
          {text: 'Quiet Time', align: 'center', value: 'quiet', tip: ''},
          {text: 'IP', align: 'center', value: 'id', tip: 'A String containing the ip address of host running the GCI process. If the GCI application is remote, the peer address as seen by the gem of the GCI app to gem network connection. For a hostagent, this is the ip address of the remote host being serviced, otherwise if the GCI application is linked (using libgcilnk*.so or gcilnk*.dll) this is the peer\'s ip address as seen by stone, for the gem to stone network connection used for login.'},
          {text: 'Host Id', align: 'center', value: 'hostId', tip: ''},
          {text: 'Priority', align: 'center', value: 'priority', tip: ''},
          {text: 'Vote State', align: 'center', value: 'vote', tip: ''},
          {text: 'Objects', align: 'center', value: 'objects', tip: ''},
          {text: 'Pages', align: 'center', value: 'pages', tip: ''},
          {text: 'Type', align: 'center', value: 'type', tip: ''},
          {text: 'Kerberos', align: 'center', value: 'kerberos', tip: ''},
          {text: 'Host Agent', align: 'center', value: 'agent', tip: ''},
          {text: 'Agent Port', align: 'center', value: 'port', tip: ''}
        ],
        sleep: 0,
        slept: 0,
        timer: '',
        callInProgress: false
      }
    },
    mounted () {
      this.fetchGemList()
      this.timer = setInterval(this.timerTick, 1000) // milliseconds
    },
    beforeDestroy () {
      clearInterval(this.timer)
    },
    methods: {

      fetchGemList () {
        if (!this.callInProgress) {
          this.callInProgress = true
          axios({ method: 'GET', 'url': process.env.URL + 'gems' }).then(result => {
            this.gems = result.data
            this.slept = 0
            this.callInProgress = false
          }, error => {
            console.error(error)
            this.callInProgress = false
          })
        }
      },
      timerTick () {
        this.slept = this.slept + 1
        if (this.sleep > 0) {
          if (this.slept >= this.sleep) {
            this.fetchGemList()
          }
        }
      }

    }
  }
</script>

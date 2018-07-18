import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)

export const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: {
    appTitle: 'Jasper',
    gemConfig: [],
    gemUser: [],
    gemVersion: [],
    stats: 'statistics',
    user: null,
    error: null,
    loading: false,
    isAuthenticated: false
  },
  mutations: {
    gemConfig (state, payload) {
      state.gemConfig = payload
    },
    gemUser (state, payload) {
      state.gemUser = payload
    },
    gemVersion (state, payload) {
      state.gemVersion = payload
    },
    userSignIn (state, payload) {
      state.isAuthenticated = true
    },
    userSignOut (state, payload) {
      state.isAuthenticated = false
    },
    userSignUp (state, payload) {
      state.isAuthenticated = true
    }
  },
  actions: {
  },
  getters: {
  }
})

store.commit('gemUser', [
  ['userId', 'DataCurator'],
  ['stoneHost', 'localhost'],
  ['stoneName', 'gs64stone4'],
  ['stoneSession', 5],
  ['gemHost', 'vienna'],
  ['netService', 'netldi4'],
  ['netTask', 'gemnetobject'],
  ['gciVersion', '64-bit 3.4.1'],
  ['gciSession', 1],
  ['stoneSerial', 21],
  ['logPath', '/Users/jfoster/Library/GemStone/db4/log']
])
store.commit('gemVersion', [
  ['cpuArchitecture', 'x86-64'],
  ['cpuKind', 'x86_64'],
  ['gsBuildArchitecture', 'Darwin (Mac)'],
  ['gsBuildDate', 'Tue Jan  2 11:10:18 2018'],
  ['gsBuildSerialNum', 'gss64_3_4_x_branch-43410'],
  ['gsBuildType', 'FAST'],
  ['gsRelease', '3.4.1'],
  ['gsVersion', '3.4.1'],
  ['nodeName', 'vienna.local'],
  ['osName', 'Darwin'],
  ['osRelease', '17.6.0'],
  ['osVersion', 'Darwin Kernel Version 17.6.0, Tue May  8 15:22:16 PDT 2018; root:xnu-4570.61.1~1/RELEASE_X86_64'],
  ['processId', 38810],
  ['processorCount', 4]
])
store.commit('gemConfig', [
  ['CONFIG_WARNINGS_FATAL', false],
  ['DUMP_OPTIONS', true],
  ['GEM_ABORT_MAX_CRS', 0],
  ['GEM_CACHE_WARMER_ARGS', ''],
  ['GEM_CACHE_WARMER_MID_CACHE_ARGS', ''],
  ['GEM_COMPRESS_TRANLOG_RECORDS', true],
  ['GEM_FREE_FRAME_CACHE_SIZE', -1],
  ['GEM_FREE_FRAME_LIMIT', -1],
  ['GEM_FREE_PAGEIDS_CACHE', 200],
  ['GEM_HALT_ON_ERROR', -1],
  ['GEM_KEEP_MIN_SOFTREFS', 0],
  ['GEM_KERBEROS_KEYTAB_FILE', ''],
  ['GEM_KEYRING_DIRS', ''],
  ['GEM_MAX_SMALLTALK_STACK_DEPTH', 1000],
  ['GEM_NATIVE_CODE_ENABLED', 2],
  ['GEM_PGSVR_COMPRESS_PAGE_TRANSFERS', false],
  ['GEM_PGSVR_FREE_FRAME_CACHE_SIZE', -1],
  ['GEM_PGSVR_FREE_FRAME_LIMIT', -1],
  ['GEM_PGSVR_UPDATE_CACHE_ON_READ', false],
  ['GEM_PGSVR_USE_SSL', false],
  ['GEM_PRIVATE_PAGE_CACHE_KB', 983040],
  ['GEM_READ_AUTH_ERR_STUBS', false],
  ['GEM_REPOSITORY_IN_MEMORY', false],
  ['GEM_RPC_KEEPALIVE_INTERVAL', 0],
  ['GEM_RPC_USE_SSL', true],
  ['GEM_RPCGCI_TIMEOUT', 0],
  ['GEM_SOFTREF_CLEANUP_PERCENT_MEM', 50],
  ['GEM_STATMONITOR_ARGS', ''],
  ['GEM_STATMONITOR_MID_CACHE_ARGS', ''],
  ['GEM_TEMPOBJ_AGGRESSIVE_STUBBING', true],
  ['GEM_TEMPOBJ_CACHE_SIZE', 153600000],
  ['GEM_TEMPOBJ_CONSECUTIVE_MARKSWEEP_LIMIT', 50],
  ['GEM_TEMPOBJ_MESPACE_SIZE', 0],
  ['GEM_TEMPOBJ_OOMSTATS_CSV', false],
  ['GEM_TEMPOBJ_OOPMAP_SIZE', 0],
  ['GEM_TEMPOBJ_POMGEN_PRUNE_ON_VOTE', 90],
  ['GEM_TEMPOBJ_POMGEN_SCAVENGE_INTERVAL', 1800],
  ['GEM_TEMPOBJ_POMGEN_SIZE', 0],
  ['GEM_TEMPOBJ_SCOPES_SIZE', 2000],
  ['GEM_TEMPOBJ_START_ADDR', 0],
  ['GemAbortMaxCrs', 0],
  ['GemCompressTranlogRecords', true],
  ['GemConvertArrayBuilder', false],
  ['GemDropCommittedExportedObjs', false],
  ['GemExceptionSignalCapturesStack', false],
  ['GemFreeFrameLimit', 625],
  ['GemFreePageIdsCache', 200],
  ['GemHaltOnError', 0],
  ['GemKeepMinSoftRefs', 0],
  ['GemKeyRingDirs', ''],
  ['GemNativeCodeEnabled', 2],
  ['GemPgsvrCompressPageTransfers', false],
  ['GemPgsvrUpdateCacheOnRead', false],
  ['GemPomGenPruneOnVote', 90],
  ['GemReadAuthErrStubs', false],
  ['GemRepositoryInMemory', false],
  ['GemSoftRefCleanupPercentMem', 50],
  ['GemTempObjCacheSize', 149952],
  ['GemTempObjConsecutiveMarksweepLimit', 50],
  ['GemTempObjOomstatsCsv', false],
  ['GemTempObjPomgenScavengeInterval', 1800],
  ['LOG_WARNINGS', true],
  ['SHR_NUM_FREE_FRAME_SERVERS', -1],
  ['SHR_PAGE_CACHE_LARGE_MEMORY_PAGE_POLICY', 0],
  ['SHR_PAGE_CACHE_LARGE_MEMORY_PAGE_SIZE_MB', 0],
  ['SHR_PAGE_CACHE_LOCKED', false],
  ['SHR_PAGE_CACHE_NUM_PROCS', 5105],
  ['SHR_PAGE_CACHE_NUM_SHARED_COUNTERS', 1900],
  ['SHR_PAGE_CACHE_PERMISSIONS', 432],
  ['SHR_PAGE_CACHE_SIZE_KB', 76800000],
  ['SHR_SPIN_LOCK_COUNT', -1],
  ['SHR_TARGET_FREE_FRAME_COUNT', -1],
  ['SHR_WELL_KNOWN_PORT_NUMBER', 0]
])

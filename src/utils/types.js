const LAYERS = {
  L0: 'l0',
  CURRENCY_L1: 'currency-l1',
  DATA_L1: 'data-l1'
}

const KEY_LAYERS = {
  L0: 'l0',
  CURRENCY_L1: 'cl1',
  DATA_L1: 'dl1'
}

const SEEDLIST_LAYERS = {
  ML0: 'ml0',
  CL1: 'cl1',
  DL1: 'dl1'
}

const VALID_NETWORKS_TAGS_OPSGENIE = {
  mainnet: 'env:MainNet',
  integrationnet: 'env:IntegrationNet',
  testnet: 'env:TestNet'
}

const DATE_FORMAT = "YYYY-MM-DDTHH:mm:ssZ"

const RESTART_REASONS = {
  STOP_PRODUCING_SNAPSHOTS: "Metagraph stopped producing snapshots",
  FORCE_METAGRAPH_RESTART: "Force metagraph restart provided",
  UNHEALTHY_NODES: "Individual nodes are unhealthy"
}

const DYNAMO_RESTART_TYPES = {
  NOT_RESTART: "NOT RESTART",
  FULL_CLUSTER: "Full Cluster",
  INDIVIDUAL_NODES: "Individual Nodes"
}

const DYNAMO_RESTART_STATE = {
  NEW: 'NEW',
  ROLLBACK_IN_PROGRESS: 'ROLLBACK IN PROGRESS',
  READY_TO_JOIN: 'READY TO JOIN',
  JOINING: 'JOINING',
  READY: 'READY'
}

const DYNAMO_DB_TABLE_AUTO_RESTART = 'auto_restart'
const CHECK_NODE_HEALTHY_LIMIT = 50

const OPSGENIE_API_KEY_PATH = '/metagraph-nodes/opsgenie-api-key'

const ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES = 60

const NETWORK_NODES = {
  testnet: {
    node_1: {
      ip: "13.57.186.140",
      port: 9000,
      id: "e2f4496e5872682d7a55aa06e507a58e96b5d48a5286bfdff7ed780fa464d9e789b2760ecd840f4cb3ee6e1c1d81b2ee844c88dbebf149b1084b7313eb680714"
    },
    node_2: {
      ip: "54.193.165.70",
      port: 9000,
      id: "3458a688925a4bd89f2ac2c695362e44d2e0c2903bdbb41b341a4d39283b22d8c85b487bd33cc5d36dbe5e31b5b00a10a6eab802718ead4ed7192ade5a5d1941"
    },
    node_3: {
      ip: "54.177.255.227",
      port: 9000,
      id: "46daea11ca239cb8c0c8cdeb27db9dbe9c03744908a8a389a60d14df2ddde409260a93334d74957331eec1af323f458b12b3a6c3b8e05885608aae7e3a77eac7"
    },
  },
  integrationnet: {
    node_1: {
      ip: "3.101.147.116",
      port: 9000,
      id: "e2f4496e5872682d7a55aa06e507a58e96b5d48a5286bfdff7ed780fa464d9e789b2760ecd840f4cb3ee6e1c1d81b2ee844c88dbebf149b1084b7313eb680714"
    },
    node_2: {
      ip: "52.53.216.201",
      port: 9000,
      id: "3458a688925a4bd89f2ac2c695362e44d2e0c2903bdbb41b341a4d39283b22d8c85b487bd33cc5d36dbe5e31b5b00a10a6eab802718ead4ed7192ade5a5d1941"
    },
    node_3: {
      ip: "54.67.6.165",
      port: 9000,
      id: "46daea11ca239cb8c0c8cdeb27db9dbe9c03744908a8a389a60d14df2ddde409260a93334d74957331eec1af323f458b12b3a6c3b8e05885608aae7e3a77eac7"
    },
  },
  mainnet: {
    node_1: {
      ip: "52.53.46.33",
      port: 9000,
      id: "e0c1ee6ec43510f0e16d2969a7a7c074a5c8cdb477c074fe9c32a9aad8cbc8ff1dff60bb81923e0db437d2686a9b65b86c403e6a21fa32b6acc4e61be4d70925"
    },
    node_2: {
      ip: "54.215.18.98",
      port: 9000,
      id: "629880a5b8d4cc6d12aec26f24230a463825c429723153aeaff29475b29e39d2406af0f8b034ba7798ae598dbd5f513d642bcbbeef088290abeadac61a0445d6"
    },
    node_3: {
      ip: "54.151.19.111",
      port: 9000,
      id: "710b3dc521b805aea7a798d61f5d4dae39601124f1f34fac9738a78047adeff60931ba522250226b87a2194d3b7d39da8d2cbffa35d6502c70f1a7e97132a4b0"
    },
  }
}

const SEEDLIST_EXTERNAL_STORAGE = {
  GITHUB: 'Github'
}

const NUMBER_OF_SNAPSHOTS_TO_FETCH_DATA_TRANSACTIONS = 10
const MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS = 3

export {
  LAYERS,
  KEY_LAYERS,
  SEEDLIST_LAYERS,
  VALID_NETWORKS_TAGS_OPSGENIE,
  DATE_FORMAT,
  RESTART_REASONS,
  DYNAMO_RESTART_TYPES,
  DYNAMO_RESTART_STATE,
  DYNAMO_DB_TABLE_AUTO_RESTART,
  CHECK_NODE_HEALTHY_LIMIT,
  NETWORK_NODES,
  OPSGENIE_API_KEY_PATH,
  ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES,
  SEEDLIST_EXTERNAL_STORAGE,
  NUMBER_OF_SNAPSHOTS_TO_FETCH_DATA_TRANSACTIONS,
  MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS
}
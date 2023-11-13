const LAYERS = {
  L0: 'l0',
  CURRENCY_L1: 'currency-l1',
  DATA_L1: 'data-l1'
}

const VALID_NETWORKS = ['mainnet', 'integrationnet', 'testnet']
const VALID_NETWORKS_TAGS_OPSGENIE = {
  mainnet: 'env:MainNet',
  integrationnet: 'env:IntegrationNet',
  testnet: 'env:TestNet'
}

const DATE_FORMAT = "YYYY-MM-DDTHH:mm:ssZ"

const RESTART_REASONS = {
  STOP_PRODUCING_SNAPSHOTS: "Metagraph stopped producing snapshots",
  FORCE_METAGRAPH_RESTART: "Force metagraph restart provided",
  UNHEALTHY_CLUSTER: "One of the clusters are unhealthy (less than 3 nodes or nodes with not Ready state)"
}

const DYNAMO_RESTART_STATE = {
  NEW: 'NEW',
  ROLLBACK_IN_PROGRESS: "ROLLBACK IN PROGRESS",
  READY: 'READY'
}

const DYNAMO_DB_TABLE_AUTO_RESTART = 'auto_restart'

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
  //DOR METAGRAPH GL0s
  mainnet: {
    node_1: {
      ip: "54.191.143.91",
      port: 9000,
      id: "ced1b13081d75a8c2e1463a8c2ff09f1ea14ff7af3265bcd3d4acfa3290626f965001a7ed6dbf2a748145ddecf1eb8ffeddf42d29dee3541a769601ea4cbba02"
    },
    node_2: {
      ip: "54.213.58.75",
      port: 9000,
      id: "c54ccbea2a8d3c989281a51e7e41298e1e0f668c0c8112f1837944d137744d0c38c0a493d0c45ddfe5e0489bef180bccfcd654b250a539116e83965b90e0413c"
    },
    node_3: {
      ip: "34.211.239.153",
      port: 9000,
      id: "f27242529710fd85a58fcacba31e34857e9bc92d622b4ca856c79a12825bca8fa133dd5697fd650d3caedc93d1524670dd1150b266505c1350d8aafce5f364f8"
    },
  }
}

export {
  LAYERS,
  VALID_NETWORKS,
  VALID_NETWORKS_TAGS_OPSGENIE,
  DATE_FORMAT,
  RESTART_REASONS,
  DYNAMO_RESTART_STATE,
  DYNAMO_DB_TABLE_AUTO_RESTART,
  NETWORK_NODES
}
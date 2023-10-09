const LAYERS = {
  L0: 'l0',
  CURRENCY_L1: 'currency-l1',
  DATA_L1: 'data-l1'
}

const VALID_NETWORKS = ['mainnet', 'integrationnet', 'testnet']

const RESTART_REASONS = {
  STOP_PRODUCING_SNAPSHOTS: "Metagraph stop producing snapshots",
  FORCE_METAGRAPH_RESTART: "Force metagraph restart provided",
  UNHEALTHY_CLUSTER: "One of the clusters are unhealthy (less than 3 nodes or nodes with not Ready status)"
}
export {
  LAYERS,
  VALID_NETWORKS,
  RESTART_REASONS
}
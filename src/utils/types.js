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

export {
  LAYERS,
  VALID_NETWORKS,
  VALID_NETWORKS_TAGS_OPSGENIE,
  DATE_FORMAT,
  RESTART_REASONS,
  DYNAMO_RESTART_STATE,
  DYNAMO_DB_TABLE_AUTO_RESTART
}
import axios from "axios"
import { getLatesMetagraphSnapshotOfNetwork } from "../shared/get_metagraph_info.js"
import { DYNAMO_RESTART_TYPES, NUMBER_OF_SNAPSHOTS_TO_FETCH_DATA_TRANSACTIONS, RESTART_REASONS } from "../utils/types.js"

const _snapshotContainsDataTransaction = async (
  ordinal,
  { nodeIp, nodePort }
) => {
  const beUrl = `http://${nodeIp}:${nodePort}/snapshots/${ordinal}`
  try {
    const response = await axios.get(beUrl)
    const dataApplicationBlocks = response.data.value.dataApplication.blocks
    const dataApplicationBlocksExists = dataApplicationBlocks.length > 0

    console.log(`Snapshot ${ordinal} contains data application blocks? ${dataApplicationBlocksExists}`)

    return dataApplicationBlocksExists
  } catch (e) {
    console.log(`Error when searching for snapshot ${ordinal} on: ${nodeIp}:${nodePort}`, e)
    return false
  }
}

const _getNodesIfDataL1TransactionsStopped = async (
  event
) => {
  const { ports } = event.metagraph
  const { name: networkName } = event.network
  const { lastSnapshotOrdinal } = await getLatesMetagraphSnapshotOfNetwork(
    networkName,
    event.metagraph.id
  )

  const promises = []
  for (let idx = lastSnapshotOrdinal; idx > lastSnapshotOrdinal - NUMBER_OF_SNAPSHOTS_TO_FETCH_DATA_TRANSACTIONS; idx--) {
    promises.push(
      _snapshotContainsDataTransaction(idx, {
        nodeIp: event.aws.ec2.instances.genesis.ip,
        nodePort: ports.metagraph_l0_public_port
      })
    )
  }

  const snapshotsResponses = await Promise.all(promises)
  if (snapshotsResponses.some(response => response)) {
    console.log(`Metagraph sending data transactions normally`)
    return []
  }

  console.log(`Could not find any data transaction in the last 10 snapshots. Data L1 layer will be restarted`)
  return [
    { ip: event.aws.ec2.instances.genesis.ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.genesis.id },
    { ip: event.aws.ec2.instances.validators[0].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[0].id },
    { ip: event.aws.ec2.instances.validators[1].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[1].id },
  ]
}

const checkDataL1TransactionsStopped = async (
  event
) => {
  if (!event.metagraph.monitor_data_l1_transactions || !event.metagraph.include_data_l1_layer) {
    return null
  }

  const dataL1Nodes = await _getNodesIfDataL1TransactionsStopped(event)
  if (dataL1Nodes.length === 0) {
    return null
  }

  return {
    restartType: DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES,
    reason: RESTART_REASONS.UNHEALTHY_NODES,
    unhealthyNodes: {
      unhealthyDataL1: dataL1Nodes
    }
  }
}

export {
  checkDataL1TransactionsStopped
}
import axios from 'axios'
import { LAYERS, NETWORK_NODES } from '../utils/types.js'
import { sleep } from './shared.js'


const _checkIfSnapshotExistsOnNode = async (
  nodeIp,
  nodePort,
  snapshotHash
) => {
  const nodeUrl = `http://${nodeIp}:${nodePort}/global-snapshots/${snapshotHash}`
  try {
    await axios.get(nodeUrl)
    console.log(`Snapshot exists on node: ${nodeIp}`)
    return true
  } catch (e) {
    console.log(`Snapshot does not exists on node: ${nodeIp}`)
    return false
  }
}

const getLatestGlobalSnapshotOfNetwork = async (
  networkName
) => {
  const beUrl = `https://be-${networkName}.constellationnetwork.io/global-snapshots/latest`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotOrdinal = response.data.data.ordinal
    const lastSnapshotHash = response.data.data.hash

    console.log(`LAST SNAPSHOT OF NETWORK: ${networkName}. Ordinal: ${lastSnapshotOrdinal}. Hash: ${lastSnapshotHash}`)

    return {
      lastSnapshotOrdinal,
      lastSnapshotHash
    }
  } catch (e) {
    console.log(e)
    throw Error(`Error when searching for snapshot on: ${beUrl}`, e)
  }
}

const getLatesMetagraphSnapshotOfNetwork = async (
  networkName,
  metagraphId
) => {
  const beUrl = `https://be-${networkName}.constellationnetwork.io/currency/${metagraphId}/snapshots/latest`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotOrdinal = response.data.data.ordinal
    const lastSnapshotHash = response.data.data.hash

    console.log(`LAST METAGRAPH SNAPSHOT OF NETWORK: ${networkName}. Ordinal: ${lastSnapshotOrdinal}. Hash: ${lastSnapshotHash}`)

    return {
      lastSnapshotOrdinal,
      lastSnapshotHash
    }
  } catch (e) {
    console.log(e)
    throw Error(`Error when searching for snapshot on: ${beUrl}`, e)
  }
}

const getLastMetagraphInfo = async (
  event
) => {
  const { network, metagraph } = event
  const beUrl = `https://be-${network.name}.constellationnetwork.io/currency/${metagraph.id}/snapshots/latest`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotTimestamp = response.data.data.timestamp
    const lastSnapshotOrdinal = response.data.data.ordinal
    const lastSnapshotHash = response.data.data.hash

    console.log(`LAST SNAPSHOT OF METAGRAPH ${metagraph.id}: ${lastSnapshotTimestamp}. Ordinal: ${lastSnapshotOrdinal}. Hash: ${lastSnapshotHash}`)

    return {
      lastSnapshotTimestamp,
      lastSnapshotOrdinal,
      lastSnapshotHash
    }
  } catch (e) {
    console.log(e)
    throw Error(`Error when searching for metagraph on: ${beUrl}`, e)
  }
}

const getReferenceSourceNode = async (
  event
) => {
  const { network } = event
  const networkName = network.name

  console.log(`Starting to get reference source node for network: ${networkName}`)

  const networkNodes = NETWORK_NODES[networkName]
  if (!networkNodes || Object.keys(networkNodes).length === 0) {
    throw Error(`Could not find nodes of network: ${networkName}`)
  }

  const { node_1, node_2, node_3 } = networkNodes
  const { lastSnapshotHash } = await getLatestGlobalSnapshotOfNetwork(networkName)

  const snapshotExistsOnNode1 = await _checkIfSnapshotExistsOnNode(node_1.ip, node_1.port, lastSnapshotHash)
  if (snapshotExistsOnNode1) {
    return node_1
  }

  const snapshotExistsOnNode2 = await _checkIfSnapshotExistsOnNode(node_2.ip, node_2.port, lastSnapshotHash)
  if (snapshotExistsOnNode2) {
    return node_2
  }

  const snapshotExistsOnNode3 = await _checkIfSnapshotExistsOnNode(node_3.ip, node_3.port, lastSnapshotHash)
  if (snapshotExistsOnNode3) {
    return node_3
  }

  return null
}

const getInformationToJoinNode = async (
  event,
  layer
) => {
  const { ports } = event.metagraph
  var urls = {
    [LAYERS.L0]: [
      `http://${event.aws.ec2.instances.genesis.ip}:${ports.metagraph_l0_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[0].ip}:${ports.metagraph_l0_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[1].ip}:${ports.metagraph_l0_public_port}/node/info`,
    ],
    [LAYERS.CURRENCY_L1]: [
      `http://${event.aws.ec2.instances.genesis.ip}:${ports.currency_l1_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[0].ip}:${ports.currency_l1_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[1].ip}:${ports.currency_l1_public_port}/node/info`,
    ],
    [LAYERS.DATA_L1]: [
      `http://${event.aws.ec2.instances.genesis.ip}:${ports.data_l1_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[0].ip}:${ports.data_l1_public_port}/node/info`,
      `http://${event.aws.ec2.instances.validators[1].ip}:${ports.data_l1_public_port}/node/info`,
    ]
  }

  for (let idx = 0; idx < 60; idx++) {
    for (const url of urls[layer]) {
      try {
        const response = await axios.get(url)
        const nodeId = response.data.id
        const nodeHost = response.data.host
        const nodeP2pPort = response.data.p2pPort
        const state = response.data.state
        if (state !== 'Ready') {
          throw Error('Node not ready yet')
        }

        console.log(`Node selected to JOIN on layer ${layer}:
         peerId: ${nodeId}
         nodeHost: ${nodeHost}
         nodeP2pPort: ${nodeP2pPort}
         `)
        return { nodeId, nodeHost, nodeP2pPort }
      } catch (e) {
        if (idx === 59) {
          throw Error(`Could not get information of node in URL: ${urls[layer]}`)
        }
        console.log(`Node ${url} is possibly not READY yet, waiting for 1s to try again (${idx + 1}/60)`)
        await sleep(1 * 1000)
      }
    }
  }
}


export {
  getLatestGlobalSnapshotOfNetwork,
  getLatesMetagraphSnapshotOfNetwork,
  getLastMetagraphInfo,
  getReferenceSourceNode,
  getInformationToJoinNode
}
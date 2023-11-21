import axios from 'axios'
import { LAYERS, NETWORK_NODES, CHECK_NODE_HEALTHY_LIMIT } from '../utils/types.js'
import { sleep } from './shared.js'

const _getLatestMetagraphOfNetwork = async (networkName) => {
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

const _checkIfSnapshotExistsOnNode = async (nodeIp, nodePort, snapshotHash) => {
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

const _getUnhealthyNodes = async (clusterInfo) => {
  const { layer, nodes } = clusterInfo

  console.log(`Checking nodes health of cluster: ${layer}`)
  const unhealthyNodes = []

  for (const node of nodes) {
    console.log(`Checking node: ${node.ip}:${node.port}`)
    for (let idx = 0; idx < CHECK_NODE_HEALTHY_LIMIT; idx++) {
      try {
        const response = await axios.get(`http://${node.ip}:${node.port}/node/info`)
        const nodeInfo = response.data
        if (nodeInfo.state !== 'Ready') {
          console.log(`Node is unhealthy`)
          unhealthyNodes.push({
            layer,
            ip: node.ip,
            port: node.port,
            id: node.id
          })
          break
        }

        console.log('Node is healthy')
        break
      } catch (e) {
        if (idx === 4) {
          console.log(`Unhealthy node after trying ${CHECK_NODE_HEALTHY_LIMIT} times`)
          unhealthyNodes.push({
            layer,
            ip: node.ip,
            port: node.port,
            id: node.id
          })

          break
        }
        console.log(`Could not get node information at: ${node.ip}. Trying again in 5s (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
        await sleep(5 * 1000)
      }
    }
  }

  return unhealthyNodes
}

const getLastMetagraphInfo = async (event) => {
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

const getReferenceSourceNode = async (event) => {
  const { network } = event
  const networkName = network.name

  console.log(`Starting to get reference source node for network: ${networkName}`)

  const networkNodes = NETWORK_NODES[networkName]
  if (!networkNodes || Object.keys(networkNodes).length === 0) {
    throw Error(`Could not find nodes of network: ${networkName}`)
  }

  const { node_1, node_2, node_3 } = networkNodes
  const { lastSnapshotHash } = await _getLatestMetagraphOfNetwork(networkName)

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

const getInformationToJoinNode = async (event, layer) => {
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
        console.log(`Node ${url} is possibly not READY yet, waiting for 10s to try again (${idx + 1}/60)`)
        await sleep(10 * 1000)
      }
    }
  }
}

const getAllUnhealthyNodes = async (event) => {
  const { ports } = event.metagraph
  let clusterInfos = [{
    layer: LAYERS.L0,
    nodes: [
      { ip: event.aws.ec2.instances.genesis.ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.genesis.id },
      { ip: event.aws.ec2.instances.validators[0].ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.validators[0].id },
      { ip: event.aws.ec2.instances.validators[1].ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.validators[1].id },
    ]
  }]

  if (event.metagraph.include_currency_l1_layer) {
    clusterInfos.push({
      layer: LAYERS.CURRENCY_L1,
      nodes: [
        { ip: event.aws.ec2.instances.genesis.ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.genesis.id },
        { ip: event.aws.ec2.instances.validators[0].ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.validators[0].id },
        { ip: event.aws.ec2.instances.validators[1].ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.validators[1].id },
      ]
    })
  }

  if (event.metagraph.include_data_l1_layer) {
    clusterInfos.push({
      layer: LAYERS.DATA_L1,
      nodes: [
        { ip: event.aws.ec2.instances.genesis.ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.genesis.id },
        { ip: event.aws.ec2.instances.validators[0].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[0].id },
        { ip: event.aws.ec2.instances.validators[1].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[1].id },
      ]
    })
  }

  const allUnhealthyNodes = []
  for (const clusterInfo of clusterInfos) {
    const unhealthyNodes = await _getUnhealthyNodes(clusterInfo)
    if (unhealthyNodes.length > 0) {
      console.log(`Some nodes of layer: ${clusterInfo.layer} are unhealthy: ${JSON.stringify(unhealthyNodes)}`)
      allUnhealthyNodes.push(...unhealthyNodes)
    }
  }

  return allUnhealthyNodes
}

export {
  getLastMetagraphInfo,
  getReferenceSourceNode,
  getInformationToJoinNode,
  getAllUnhealthyNodes
}
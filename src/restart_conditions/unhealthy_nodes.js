import axios from "axios"
import { CHECK_NODE_HEALTHY_LIMIT, DYNAMO_RESTART_TYPES, LAYERS, RESTART_REASONS } from "../utils/types.js"

const _getUnhealthyNodes = async (
  clusterInfo
) => {
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
        if (idx === CHECK_NODE_HEALTHY_LIMIT - 1) {
          console.log(`Unhealthy node after trying ${CHECK_NODE_HEALTHY_LIMIT} times`)
          unhealthyNodes.push({
            layer,
            ip: node.ip,
            port: node.port,
            id: node.id
          })

          break
        }
        console.log(`Could not get node information at: ${node.ip}. Trying again in 1s (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
        await sleep(1 * 1000)
      }
    }
  }

  return unhealthyNodes
}

const _checkIfNodesAreHealthy = async (
  clusterInfo
) => {
  const unhealthyNodes = await _getUnhealthyNodes(clusterInfo)
  if (unhealthyNodes.length === 0) {
    console.log(`All nodes of layer: ${clusterInfo.layer} are healthy`)
    return []
  }

  console.log(`Some nodes of layer: ${clusterInfo.layer} are unhealthy: ${JSON.stringify(unhealthyNodes)}`)
  return unhealthyNodes
}

const _getMetagraphL0UnhealthyNodes = async (
  event
) => {
  const { ports } = event.metagraph
  const clusterInfo = {
    layer: LAYERS.L0,
    nodes: [
      { ip: event.aws.ec2.instances.genesis.ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.genesis.id },
      { ip: event.aws.ec2.instances.validators[0].ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.validators[0].id },
      { ip: event.aws.ec2.instances.validators[1].ip, port: ports.metagraph_l0_public_port, id: event.aws.ec2.instances.validators[1].id },
    ]
  }

  return await _checkIfNodesAreHealthy(clusterInfo)
}

const _getCurrencyL1UnhealthyNodes = async (
  event
) => {
  const { ports } = event.metagraph
  if (!event.metagraph.include_currency_l1_layer) {
    return []
  }
  const clusterInfo = {
    layer: LAYERS.CURRENCY_L1,
    nodes: [
      { ip: event.aws.ec2.instances.genesis.ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.genesis.id },
      { ip: event.aws.ec2.instances.validators[0].ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.validators[0].id },
      { ip: event.aws.ec2.instances.validators[1].ip, port: ports.currency_l1_public_port, id: event.aws.ec2.instances.validators[1].id },
    ]
  }


  return await _checkIfNodesAreHealthy(clusterInfo)
}

const _getDataL1UnhealthyNodes = async (
  event
) => {
  const { ports } = event.metagraph
  if (!event.metagraph.include_data_l1_layer) {
    return []
  }
  const clusterInfo = {
    layer: LAYERS.DATA_L1,
    nodes: [
      { ip: event.aws.ec2.instances.genesis.ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.genesis.id },
      { ip: event.aws.ec2.instances.validators[0].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[0].id },
      { ip: event.aws.ec2.instances.validators[1].ip, port: ports.data_l1_public_port, id: event.aws.ec2.instances.validators[1].id },
    ]
  }

  return await _checkIfNodesAreHealthy(clusterInfo)
}

const checkUnhealthyNodes = async (
  event
) => {
  const unhealthyMetagraphL0 = await _getMetagraphL0UnhealthyNodes(event)
  const unhealthyCurrencyL1 = await _getCurrencyL1UnhealthyNodes(event)
  const unhealthyDataL1 = await _getDataL1UnhealthyNodes(event)

  if (unhealthyMetagraphL0.length === 0 && unhealthyCurrencyL1.length === 0 && unhealthyDataL1.length === 0) {
    console.log(`All nodes are healthy`)
    return null
  }

  const unhealthyNodes = [...unhealthyMetagraphL0, ...unhealthyCurrencyL1, unhealthyDataL1]
  if (unhealthyNodes.length === 9 || unhealthyMetagraphL0.length === 3) {
    console.log(`Restart type FULL CLUSTER: Unhealthy clusters. ML0: ${JSON.stringify(unhealthyMetagraphL0)}, CL1: ${JSON.stringify(unhealthyCurrencyL1)}, DL1: ${JSON.stringify(unhealthyDataL1)}`)
    return {
      restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
      reason: RESTART_REASONS.UNHEALTHY_NODES,
      unhealthyNodes: {
        unhealthyMetagraphL0,
        unhealthyCurrencyL1,
        unhealthyDataL1
      }
    }
  }

  console.log(`Restart type INDIVIDUAL NODES: Unhealthy clusters. ML0: ${JSON.stringify(unhealthyMetagraphL0)}, CL1: ${JSON.stringify(unhealthyCurrencyL1)}, DL1: ${JSON.stringify(unhealthyDataL1)}`)
  return {
    restartType: DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES,
    reason: RESTART_REASONS.UNHEALTHY_NODES,
    unhealthyNodes: {
      unhealthyMetagraphL0,
      unhealthyCurrencyL1,
      unhealthyDataL1
    }
  }
}


export {
  checkUnhealthyNodes
}
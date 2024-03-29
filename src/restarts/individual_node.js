import { startValidatorNodeCurrencyL1 } from "../currency-l1/index.js"
import { startValidatorNodeDataL1 } from "../data-l1/index.js"
import { startValidatorNodeL0 } from "../metagraph-l0/index.js"
import { checkIfNodeStarted } from "../shared/check_nodes_health.js"
import { getInformationToJoinNode } from "../shared/get_metagraph_info.js"
import { joinNodeToCluster } from "../shared/restart_operations.js"
import { LAYERS } from "../utils/types.js"

const startMetagraphL0ValidatorNode = async (
  ssmClient,
  event,
  node,
  logName,
  nodeInformation,
  referenceSourceNode
) => {
  console.log(`Starting validator ${node.ip}`)
  await startValidatorNodeL0(
    ssmClient,
    event,
    logName,
    node,
    referenceSourceNode
  )

  await checkIfNodeStarted(`http://${node.ip}:${node.port}/node/info`)
  console.log(`Joining validator ${node.ip}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeInformation, [node.id])
}

const startCurrencyL1ValidatorNode = async (
  ssmClient,
  event,
  node,
  logName,
  ml0NodeId,
  referenceSourceNode
) => {
  const nodeInformation = await getInformationToJoinNode(event, LAYERS.CURRENCY_L1)
  console.log(`Starting validator ${node.ip}`)
  await startValidatorNodeCurrencyL1(
    ssmClient,
    event,
    logName,
    ml0NodeId,
    node,
    referenceSourceNode
  )

  await checkIfNodeStarted(`http://${node.ip}:${node.port}/node/info`)

  console.log(`Joining validator ${node.ip}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.CURRENCY_L1, nodeInformation, [node.id])
}

const startDataL1ValidatorNode = async (
  ssmClient,
  event,
  node,
  logName,
  ml0NodeId,
  referenceSourceNode
) => {
  const nodeInformation = await getInformationToJoinNode(event, LAYERS.DATA_L1)

  console.log(`Starting validator ${node.ip}`)
  await startValidatorNodeDataL1(
    ssmClient,
    event,
    logName,
    ml0NodeId,
    node,
    referenceSourceNode
  )

  await checkIfNodeStarted(`http://${node.ip}:${node.port}/node/info`)
  console.log(`Joining validator ${node.ip}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.DATA_L1, nodeInformation, [node.id])
}

const restartIndividualNode = async (
  ssmClient,
  event,
  logName,
  node,
  referenceSourceNode
) => {
  const nodeInformation = await getInformationToJoinNode(event, LAYERS.L0)

  if (node.layer === LAYERS.L0) {
    await startMetagraphL0ValidatorNode(ssmClient, event, node, logName, nodeInformation, referenceSourceNode)
  }
  if (node.layer === LAYERS.CURRENCY_L1) {
    await startCurrencyL1ValidatorNode(ssmClient, event, node, logName, nodeInformation.nodeId, referenceSourceNode)
  }
  if (node.layer === LAYERS.DATA_L1) {
    await startDataL1ValidatorNode(ssmClient, event, node, logName, nodeInformation.nodeId, referenceSourceNode)
  }
}

export {
  restartIndividualNode
}
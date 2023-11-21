import { startValidatorNodeCurrencyL1 } from "../currency-l1/index.js"
import { startValidatorNodeDataL1 } from "../data-l1/index.js"
import { startValidatorNodeL0 } from "../metagraph-l0/index.js"
import { getInformationToJoinNode, sleep, joinNodeToCluster, checkIfNodeStarted } from "../shared/index.js"
import { LAYERS } from "../utils/types.js"

const startMetagraphL0ValidatorNode = async (ssmClient, event, node, logName, nodeId, referenceSourceNode) => {
  console.log(`Starting validator ${node.ip}`)
  await startValidatorNodeL0(
    ssmClient,
    event,
    logName,
    node,
    referenceSourceNode
  )

  await checkIfNodeStarted(`http://${node.ip}:${node.port}/node/info`)
  await sleep(10 * 1000)
  await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeId, [node.id])

  return nodeId
}

const startCurrencyL1ValidatorNode = async (ssmClient, event, node, logName, ml0NodeId, referenceSourceNode) => {
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
  await sleep(10 * 1000)

  console.log(`Joining validator ${node.ip}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.CURRENCY_L1, nodeInformation, [node.id])
}

const startDataL1ValidatorNode = async (ssmClient, event, node, logName, ml0NodeId, referenceSourceNode) => {
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
  await sleep(10 * 1000)

  console.log(`Joining validator ${node.ip}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.DATA_L1, nodeInformation, [node.id])
}

const restartIndividualNode = async (ssmClient, event, logName, node, referenceSourceNode) => {
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.L0)

  if (node.layer === LAYERS.L0) {
    await startMetagraphL0ValidatorNode(ssmClient, event, node, logName, nodeId, referenceSourceNode)
  }
  if (node.layer === LAYERS.CURRENCY_L1) {
    await startCurrencyL1ValidatorNode(ssmClient, event, node, logName, nodeId, referenceSourceNode)
  }
  if (node.layer === LAYERS.DATA_L1) {
    await startDataL1ValidatorNode(ssmClient, event, node, logName, nodeId, referenceSourceNode)
  }
}

export {
  restartIndividualNode
}
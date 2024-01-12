import { startInitialValidatorNodeCurrencyL1, startValidatorNodeCurrencyL1 } from "../currency-l1/index.js"
import { startInitialValidatorNodeDataL1, startValidatorNodeDataL1 } from "../data-l1/index.js"
import { startRollbackNodeL0, startValidatorNodeL0 } from "../metagraph-l0/index.js"
import { getInformationToJoinNode, sleep, joinNodeToCluster, killCurrentExecution, checkIfNodeStarted } from "../shared/index.js"
import { LAYERS } from "../utils/types.js"

const startMetagraphL0Validators = async (ssmClient, event, logName, nodeId, referenceSourceNode) => {
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Starting validator ${validator.ip}`)
    await startValidatorNodeL0(
      ssmClient,
      event,
      logName,
      validator,
      referenceSourceNode
    )

    const { metagraph_l0_public_port } = event.metagraph.ports
    await checkIfNodeStarted(`http://${validator.ip}:${metagraph_l0_public_port}/node/info`)
    console.log(`Joining validator ${validator.ip}`)
    await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeId, [validator.id])
  }
}

const startCurrencyL1Nodes = async (ssmClient, event, logName, ml0NodeId, referenceSourceNode) => {
  console.log(`Starting initial validator`)
  await startInitialValidatorNodeCurrencyL1(ssmClient, event, logName, ml0NodeId, event.aws.ec2.instances.genesis, referenceSourceNode)
  await sleep(10 * 1000)

  const nodeInformation = await getInformationToJoinNode(event, LAYERS.CURRENCY_L1)
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Starting validator ${validator.ip}`)
    await startValidatorNodeCurrencyL1(
      ssmClient,
      event,
      logName,
      ml0NodeId,
      validator,
      referenceSourceNode
    )
    const { currency_l1_public_port } = event.metagraph.ports

    await checkIfNodeStarted(`http://${validator.ip}:${currency_l1_public_port}/node/info`)
    console.log(`Joining validator ${validator.ip}`)
    await joinNodeToCluster(ssmClient, event, LAYERS.CURRENCY_L1, nodeInformation, [validator.id])
  }
}

const startDataL1Nodes = async (ssmClient, event, logName, ml0NodeId, referenceSourceNode) => {
  await startInitialValidatorNodeDataL1(ssmClient, event, logName, ml0NodeId, event.aws.ec2.instances.genesis, referenceSourceNode)
  await sleep(10 * 1000)

  const nodeInformation = await getInformationToJoinNode(event, LAYERS.DATA_L1)
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Starting validator ${validator.ip}`)
    await startValidatorNodeDataL1(
      ssmClient,
      event,
      logName,
      ml0NodeId,
      validator,
      referenceSourceNode
    )

    const { data_l1_public_port } = event.metagraph.ports

    await checkIfNodeStarted(`http://${validator.ip}:${data_l1_public_port}/node/info`)
    console.log(`Joining validator ${validator.ip}`)
    await joinNodeToCluster(ssmClient, event, LAYERS.DATA_L1, nodeInformation, [validator.id])
  }
}

const startMetagraphRollback = async (ssmClient, event, l0LogName, referenceSourceNode) => {
  const allInstancesIds = [event.aws.ec2.instances.genesis.id, event.aws.ec2.instances.validators[0].id, event.aws.ec2.instances.validators[1].id]

  await killCurrentExecution(ssmClient, event, LAYERS.L0, allInstancesIds)
  await killCurrentExecution(ssmClient, event, LAYERS.CURRENCY_L1, allInstancesIds)
  await killCurrentExecution(ssmClient, event, LAYERS.DATA_L1, allInstancesIds)

  await startRollbackNodeL0(ssmClient, event, event.aws.ec2.instances.genesis, referenceSourceNode, l0LogName, false)
}

const finishMetagraphRollback = async (ssmClient, event, { l0LogName, cl1LogName, dl1LogName }, referenceSourceNode) => {
  const node = await getInformationToJoinNode(event, LAYERS.L0)

  await startMetagraphL0Validators(ssmClient, event, l0LogName, node, referenceSourceNode)

  if (event.metagraph.include_currency_l1_layer) {
    await startCurrencyL1Nodes(ssmClient, event, cl1LogName, node.nodeId, referenceSourceNode)
  }

  if (event.metagraph.include_data_l1_layer) {
    await startDataL1Nodes(ssmClient, event, dl1LogName, node.nodeId, referenceSourceNode)
  }
}

export {
  startMetagraphRollback,
  finishMetagraphRollback,
  startCurrencyL1Nodes,
  startDataL1Nodes
}
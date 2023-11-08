import { upsertMetagraphRestart } from '../external/aws/dynamo.js'
import {
  sendCommand,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  joinNodeToCluster,
  printSeparatorWithMessage,
  getKeys,
  saveLogs,
  getAllEC2NodesInstances
} from '../shared/index.js'
import { DYNAMO_RESTART_STATE, LAYERS } from '../utils/types.js'

const startRollbackFirstNodeL0 = async (ssmClient, event, ec2InstancesIds, referenceSourceNode) => {
  const l0Keys = await getKeys(ssmClient, event.aws.ec2.instances.genesis.id, LAYERS.L0)

  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_metagraph_l0_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${l0Keys.keyStore}"`,
    `export CL_KEYALIAS="${l0Keys.keyAlias}"`,
    `export CL_PASSWORD="${l0Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.metagraph_l0_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_metagraph_l0_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${file_system.base_metagraph_l0_directory}`,
    `nohup java -jar metagraph-l0.jar run-rollback --ip ${event.aws.ec2.instances.genesis.ip} > node-l0.log 2>&1 &`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const startValidatorNodeL0 = async (ssmClient, event, keys, instanceIp, ec2InstancesIds, referenceSourceNode) => {
  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_metagraph_l0_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_PUBLIC_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.metagraph_l0_cli_port}`,
    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,
    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_metagraph_l0_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${file_system.base_metagraph_l0_directory}`,
    `nohup java -jar metagraph-l0.jar run-validator --ip ${instanceIp} > node-l0.log 2>&1 &`
  ]

  await sendCommand(ssmClient, [...keys, ...commands], ec2InstancesIds)
}

const restartL0Nodes = async (ssmClient, event, logName, currentMetagraphRestart, referenceSourceNode) => {
  if (currentMetagraphRestart.state === DYNAMO_RESTART_STATE.NEW) {
    const allEC2NodesIntances = getAllEC2NodesInstances(event)
    await saveLogs(ssmClient, event, logName, LAYERS.L0, allEC2NodesIntances)

    printSeparatorWithMessage('Starting rollback genesis l0 node')
    await startRollbackFirstNodeL0(ssmClient, event, [event.aws.ec2.instances.genesis.id], referenceSourceNode)
    
    console.log("Updating state to ROLLBACK_IN_PROGRESS")
    currentMetagraphRestart = await upsertMetagraphRestart(event.metagraph.id, DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS)
    printSeparatorWithMessage('Finished')
  }

  if (currentMetagraphRestart.state !== DYNAMO_RESTART_STATE.READY) {
    return null
  }

  printSeparatorWithMessage('Starting validators L0 nodes')
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Starting validator ${validator.ip}`)
    const validator1Keys = await getKeys(ssmClient, validator.id, LAYERS.L0)
    await startValidatorNodeL0(
      ssmClient,
      event,
      [
        `export CL_KEYSTORE="${validator1Keys.keyStore}"`,
        `export CL_KEYALIAS="${validator1Keys.keyAlias}"`,
        `export CL_PASSWORD="${validator1Keys.password}"`
      ],
      validator.ip,
      [validator.id],
      referenceSourceNode
    )
  }
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting to get information to join node')
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.L0)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Check if validators started successfully')
  await checkIfValidatorsStarted(event, LAYERS.L0)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage(`Joining validators L0 to the cluster. GenesisNodeId: ${nodeId}`)
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Joining validator ${validator.ip}`)
    await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeId, [validator.id])
  }
  printSeparatorWithMessage('Finished')

  return nodeId
}

export {
  restartL0Nodes
}
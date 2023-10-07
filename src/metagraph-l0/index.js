import moment from 'moment'
import {
  sendCommand,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  joinNodeToCluster,
  printSeparatorWithMessage,
  getKeys,
  saveLogs
} from '../shared/index.js'
import { LAYERS } from '../utils/types.js'

const startRollbackFirstNodeL0 = async (ssmClient, event, ec2InstancesIds) => {
  const l0Keys = await getKeys(ssmClient, event.ec2_instance_1_id, LAYERS.L0)

  const envVariables = [
    `export CL_KEYSTORE="${l0Keys.keyStore}"`,
    `export CL_KEYALIAS="${l0Keys.keyAlias}"`,
    `export CL_PASSWORD="${l0Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.metagraph_l0_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,

    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=${event.cl_app_env}`,
    `export CL_COLLATERAL=${event.cl_collateral}`,
  ]

  for (const variable of event.additional_metagraph_l0_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${event.base_metagraph_l0_directory}`,
    `nohup java -jar metagraph-l0.jar run-rollback --prioritySeedlist seedlist --ip ${event.ec2_instance_1_ip} > node-l0.log 2>&1 &`
  ]

  console.log(commands)
  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const startValidatorNodeL0 = async (ssmClient, event, keys, instanceIp, ec2InstancesIds) => {
  const envVariables = [
    `export CL_PUBLIC_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.metagraph_l0_cli_port}`,
    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,
    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=${event.cl_app_env}`,
    `export CL_COLLATERAL=${event.cl_collateral}`,
  ]

  for (const variable of event.additional_metagraph_l0_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${event.base_metagraph_l0_directory}`,
    `nohup java -jar metagraph-l0.jar run-validator --ip ${instanceIp} > node-l0.log 2>&1 &`
  ]

  await sendCommand(ssmClient, [...keys, ...commands], ec2InstancesIds)
}

const restartL0Nodes = async (ssmClient, event, logName) => {
  await saveLogs(ssmClient, event, logName, LAYERS.L0, [
    event.ec2_instance_1_id,
    event.ec2_instance_2_id,
    event.ec2_instance_3_id
  ])

  printSeparatorWithMessage('Starting rollback genesis l0 node')
  await startRollbackFirstNodeL0(ssmClient, event, [event.ec2_instance_1_id])
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting validators L0 nodes')
  const validator1Keys = await getKeys(ssmClient, event.ec2_instance_2_id, LAYERS.L0)
  await startValidatorNodeL0(
    ssmClient,
    event,
    [
      `export CL_KEYSTORE="${validator1Keys.keyStore}"`,
      `export CL_KEYALIAS="${validator1Keys.keyAlias}"`,
      `export CL_PASSWORD="${validator1Keys.password}"`
    ],
    event.ec2_instance_2_ip,
    [event.ec2_instance_2_id]
  )

  const validator2Keys = await getKeys(ssmClient, event.ec2_instance_3_id, LAYERS.L0)
  await startValidatorNodeL0(
    ssmClient,
    event,
    [
      `export CL_KEYSTORE="${validator2Keys.keyStore}"`,
      `export CL_KEYALIAS="${validator2Keys.keyAlias}"`,
      `export CL_PASSWORD="${validator2Keys.password}"`
    ],
    event.ec2_instance_3_ip,
    [event.ec2_instance_3_id]
  )
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting to get information to join node')
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.L0)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Check if validators started successfully')
  await checkIfValidatorsStarted(event, LAYERS.L0)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage(`Joining validators L0 to the cluster. GenesisNodeId: ${nodeId}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeId, [event.ec2_instance_2_id])
  await joinNodeToCluster(ssmClient, event, LAYERS.L0, nodeId, [event.ec2_instance_3_id])
  printSeparatorWithMessage('Finished')

  return nodeId
}

export {
  restartL0Nodes
}
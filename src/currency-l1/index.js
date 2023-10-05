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

const startInitialValidatorNodeL1 = async (ssmClient, event, mL0NodeId, ec2InstancesIds) => {
  const cl1Keys = await getKeys(ssmClient, event.ec2_instance_1_id, 'cl1')

  const envVariables = [
    `export CL_KEYSTORE="${cl1Keys.keyStore}"`,
    `export CL_KEYALIAS="${cl1Keys.keyAlias}"`,
    `export CL_PASSWORD="${cl1Keys.password}"`,
    `export CL_PUBLIC_HTTP_PORT=${event.currency_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.currency_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.currency_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.ec2_instance_1_ip}`,
    `export CL_L0_PEER_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=${event.cl_app_env}`,
    `export CL_COLLATERAL=${event.cl_collateral}`
  ]

  for (const variable of event.additional_currency_l1_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${event.base_currency_l1_directory}`,
    `nohup java -jar currency-l1.jar run-initial-validator --ip ${event.ec2_instance_1_ip} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const startValidatorNodeL1 = async (ssmClient, event, mL0NodeId, keys, instanceIp, ec2InstancesIds) => {
  const envVariables = [
    `export CL_PUBLIC_HTTP_PORT=${event.currency_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.currency_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.currency_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.ec2_instance_1_ip}`,
    `export CL_L0_PEER_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=${event.cl_app_env}`,
    `export CL_COLLATERAL=${event.cl_collateral}`,
  ]

  for (const variable of event.additional_currency_l1_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${event.base_currency_l1_directory}`,
    `nohup java -jar currency-l1.jar run-validator --ip ${instanceIp} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, [...keys, ...commands], ec2InstancesIds)
}

const restartCurrencyL1Nodes = async (ssmClient, event, metagraphL0NodeId, logName) => {
  await saveLogs(ssmClient, event, logName, LAYERS.CURRENCY_L1, [
    event.ec2_instance_1_id,
    event.ec2_instance_2_id,
    event.ec2_instance_3_id
  ])

  printSeparatorWithMessage('Starting initial validator currency l1 node')
  await startInitialValidatorNodeL1(ssmClient, event, metagraphL0NodeId, [event.ec2_instance_1_id])
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting validators currency l1 node')
  const validator1Keys = await getKeys(ssmClient, event.ec2_instance_2_id, 'cl1')
  await startValidatorNodeL1(
    ssmClient,
    event,
    metagraphL0NodeId,
    [
      `export CL_KEYSTORE="${validator1Keys.keyStore}"`,
      `export CL_KEYALIAS="${validator1Keys.keyAlias}"`,
      `export CL_PASSWORD="${validator1Keys.password}"`
    ],
    event.ec2_instance_2_ip,
    [event.ec2_instance_2_id]
  )

  const validator2Keys = await getKeys(ssmClient, event.ec2_instance_3_id, 'cl1')
  await startValidatorNodeL1(
    ssmClient,
    event,
    metagraphL0NodeId,
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
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.CURRENCY_L1)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Check if validators started successfully')
  await checkIfValidatorsStarted(event, LAYERS.CURRENCY_L1)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage(`Joining validators currency L1 to the cluster. GenesisNodeId: ${nodeId}`)
  await joinNodeToCluster(ssmClient, event, LAYERS.CURRENCY_L1, nodeId, [event.ec2_instance_2_id])
  await joinNodeToCluster(ssmClient, event, LAYERS.CURRENCY_L1, nodeId, [event.ec2_instance_3_id])
  printSeparatorWithMessage('Finished')

}

export { restartCurrencyL1Nodes }
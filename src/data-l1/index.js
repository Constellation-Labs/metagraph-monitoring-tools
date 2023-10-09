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
import { LAYERS } from '../utils/types.js'

const startInitialValidatorNodeL1 = async (ssmClient, event, mL0NodeId, ec2InstancesIds) => {
  const dl1Keys = await getKeys(ssmClient, event.aws.ec2.instances.genesis.id, 'dl1')

  const { ports } = event.metagraph
  const { gl0_node_ip, gl0_node_id, gl0_node_port } = event.network
  const {
    id,
    required_env_variables,
    additional_data_l1_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${dl1Keys.keyStore}"`,
    `export CL_KEYALIAS="${dl1Keys.keyAlias}"`,
    `export CL_PASSWORD="${dl1Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${ports.data_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.data_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.data_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${gl0_node_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${gl0_node_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${gl0_node_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.aws.ec2.instances.genesis.ip}`,
    `export CL_L0_PEER_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`
  ]

  for (const variable of additional_data_l1_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${file_system.base_data_l1_directory}`,
    `nohup java -jar data-l1.jar run-initial-validator --ip ${event.aws.ec2.instances.genesis.ip} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const startValidatorNodeL1 = async (ssmClient, event, mL0NodeId, keys, instanceIp, ec2InstancesIds) => {
  const { ports } = event.metagraph
  const { gl0_node_ip, gl0_node_id, gl0_node_port } = event.network
  const {
    id,
    required_env_variables,
    additional_data_l1_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_PUBLIC_HTTP_PORT=${ports.data_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.data_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.data_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${gl0_node_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${gl0_node_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${gl0_node_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.aws.ec2.instances.genesis.ip}`,
    `export CL_L0_PEER_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_data_l1_env_variables) {
    envVariables.push(`export ${variable}`)
  }

  const commands = [
    ...envVariables,
    `cd ${file_system.base_data_l1_directory}`,
    `nohup java -jar data-l1.jar run-validator --ip ${instanceIp} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, [...keys, ...commands], ec2InstancesIds)
}

const restartDataL1Nodes = async (ssmClient, event, metagraphL0NodeId, logName) => {
  const allEC2NodesIntances = getAllEC2NodesInstances(event)
  await saveLogs(ssmClient, event, logName, LAYERS.DATA_L1, allEC2NodesIntances)

  printSeparatorWithMessage('Starting initial validator data l1 node')
  await startInitialValidatorNodeL1(ssmClient, event, metagraphL0NodeId, [event.aws.ec2.instances.genesis.id])
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting validators data L1 nodes')
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Starting validator ${validator.ip}`)
    const validator1Keys = await getKeys(ssmClient, validator.id, 'cl1')
    await startValidatorNodeL1(
      ssmClient,
      event,
      metagraphL0NodeId,
      [
        `export CL_KEYSTORE="${validator1Keys.keyStore}"`,
        `export CL_KEYALIAS="${validator1Keys.keyAlias}"`,
        `export CL_PASSWORD="${validator1Keys.password}"`
      ],
      validator.ip,
      [validator.id]
    )
  }
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Starting to get information to join node')
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.DATA_L1)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Check if validators started successfully')
  await checkIfValidatorsStarted(event, LAYERS.DATA_L1)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage(`Joining validators data L1 to the cluster. GenesisNodeId: ${nodeId}`)
  for (const validator of event.aws.ec2.instances.validators) {
    console.log(`Joining validator ${validator.ip}`)
    await joinNodeToCluster(ssmClient, event, LAYERS.DATA_L1, nodeId, [validator.id])
  }
  printSeparatorWithMessage('Finished')

}

export { restartDataL1Nodes }
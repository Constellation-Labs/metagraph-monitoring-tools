import {
  sendCommand,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  joinNodeToCluster,
  printSeparator,
  getKeys
} from './shared.js'

const startInitialValidatorNodeL1 = async (ssmClient, event, mL0NodeId, ec2InstancesIds) => {
  const dl1Keys = await getKeys(ssmClient, event.ec2_instance_1_id, 'dl1')

  const commands = [
    `cd /home/ubuntu/code/data-l1`,

    `export CL_KEYSTORE="${dl1Keys.keyStore}"`,
    `export CL_KEYALIAS="${dl1Keys.keyAlias}"`,
    `export CL_PASSWORD="${dl1Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${event.data_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.data_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.data_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.ec2_instance_1_ip}`,
    `export CL_L0_PEER_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=testnet`,
    `export CL_COLLATERAL=0`,

    `nohup java -jar data-l1.jar run-initial-validator --ip ${event.ec2_instance_1_ip} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const startValidatorNodeL1 = async (ssmClient, event, mL0NodeId, keys, instanceIp, ec2InstancesIds) => {
  const commands = [
    `cd /home/ubuntu/code/data-l1`,

    `export CL_PUBLIC_HTTP_PORT=${event.data_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${event.data_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${event.data_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${event.network_global_l0_ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${event.network_global_l0_port}`,
    `export CL_GLOBAL_L0_PEER_ID=${event.network_global_l0_id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.ec2_instance_1_ip}`,
    `export CL_L0_PEER_HTTP_PORT=${event.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${event.metagraph_id}`,
    `export CL_APP_ENV=testnet`,
    `export CL_COLLATERAL=0`,

    `nohup java -jar data-l1.jar run-validator --ip ${instanceIp} > node-l1.log 2>&1 &`
  ]

  await sendCommand(ssmClient, [...keys, ...commands], ec2InstancesIds)
}

const restartDataL1Nodes = async (ssmClient, event, metagraphL0NodeId) => {
  printSeparator()
  console.log('Starting initial validator data l1 node')
  await startInitialValidatorNodeL1(ssmClient, event, metagraphL0NodeId, [event.ec2_instance_1_id])
  console.log('Starting initial validator data l1 node finished')
  printSeparator()

  printSeparator()
  console.log('Starting validators data L1 nodes')

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

  const validator2Keys = await getKeys(ssmClient, event.ec2_instance_3_id, 'dl1')
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
  console.log('Starting validators data L1 nodes finished')
  printSeparator()

  printSeparator()
  console.log('Starting to get information to join node')
  const { nodeId } = await getInformationToJoinNode(event, 'data-l1')
  console.log('Starting to get information to join node finished')
  printSeparator()

  printSeparator()
  console.log('Check if validators started successfully')
  await checkIfValidatorsStarted(event, 'data-l1')
  console.log('Check if validators started successfully finished')
  printSeparator()

  printSeparator()
  console.log(`Joining validators data L1 to the cluster. GenesisNodeId: ${nodeId}`)
  await joinNodeToCluster(ssmClient, event, 'data-l1', nodeId, [event.ec2_instance_2_id])
  await joinNodeToCluster(ssmClient, event, 'data-l1', nodeId, [event.ec2_instance_3_id])
  console.log(`Joining validators data L1 to the cluster. GenesisNodeId: ${nodeId} finished`)
  printSeparator()

}

export { restartDataL1Nodes }
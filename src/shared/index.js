import moment from 'moment';
import axios from 'axios';
import { SendCommandCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { LAYERS } from '../utils/types.js'

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getLastMetagraphInfo = async (event) => {
  const { network, metagraph } = event;
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

const sendCommand = async (ssmClient, commands, ec2InstancesIds) => {
  const params = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: ec2InstancesIds,
    Parameters: {
      commands
    },
  };

  try {
    const commandResponse = await ssmClient.send(new SendCommandCommand(params));
    console.log("Command sent successfully. Command ID:", commandResponse.Command.CommandId);
  } catch (error) {
    console.error("Error sending command:", error);
  }
}

const getSSMParameter = async (ssmClient, parameterName) => {
  const getParameterCommand = new GetParameterCommand({
    Name: parameterName,
  });

  const parameter = await ssmClient.send(getParameterCommand)
  return parameter.Parameter.Value
}

const getKeys = async (ssmClient, instanceId, layer) => {
  const keyStore = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/keystore`)
  const keyAlias = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/keyalias`)
  const password = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/password`)

  return { keyStore, keyAlias, password }
}

const killCurrentProcesses = async (ssmClient, event, ec2InstancesIds) => {
  const {
    metagraph_l0_public_port,
    currency_l1_public_port,
    data_l1_public_port,
  } = event.metagraph.ports

  const commands = [
    `fuser -k ${metagraph_l0_public_port}/tcp`,
    `fuser -k ${currency_l1_public_port}/tcp`,
    `fuser -k ${data_l1_public_port}/tcp`,
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const getRemoveInstructionByOrdinal = async (event, ordinal) => {
  const beUrl = `https://be-${event.network.name}.constellationnetwork.io/currency/${event.metagraph.id}/snapshots/${ordinal}`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotOrdinal = response.data.data.ordinal
    const lastSnapshotHash = response.data.data.hash

    return [`rm data/incremental_snapshot/${lastSnapshotOrdinal}`, `rm data/incremental_snapshot/${lastSnapshotHash}`]
  } catch (e) {
    return [`rm data/incremental_snapshot/${ordinal}`]
  }
}

const deleteSnapshotNotSyncToGL0 = async (ssmClient, event, ec2InstancesIds) => {
  const { file_system } = event.metagraph
  const { lastSnapshotOrdinal } = await getLastMetagraphInfo(event)
  const initialSnapshotToRemove = lastSnapshotOrdinal
  const finalSnapshotToRemove = initialSnapshotToRemove + 50

  console.log(`Removing snapshots on data folder between: ${initialSnapshotToRemove} - ${finalSnapshotToRemove}`)

  //Somehow the syntax rm data/incremental_snapshot/{x..y} doesn't work, so we put individually
  const promises = []
  for (let idx = initialSnapshotToRemove; idx <= finalSnapshotToRemove; idx++) {
    promises.push(getRemoveInstructionByOrdinal(event, idx))
  }

  const deletingCommands = await Promise.all(promises)
  const allDeletingCommands = deletingCommands.reduce((acc, curr) => [...acc, ...curr], []);

  const commands = [
    `cd ${file_system.base_metagraph_l0_directory}`,
    ...allDeletingCommands
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const joinNodeToCluster = async (ssmClient, event, layer, joiningNodeId, ec2InstancesIds) => {
  const { ports } = event.metagraph

  const joiningInstruction = {
    [LAYERS.L0]: `curl -v -X POST http://localhost:${ports.metagraph_l0_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.aws.ec2.instances.genesis.ip}", "p2pPort": ${ports.metagraph_l0_p2p_port} }'`,
    [LAYERS.CURRENCY_L1]: `curl -v -X POST http://localhost:${ports.currency_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.aws.ec2.instances.genesis.ip}", "p2pPort": ${ports.currency_l1_p2p_port} }'`,
    [LAYERS.DATA_L1]: `curl -v -X POST http://localhost:${ports.data_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.aws.ec2.instances.genesis.ip}", "p2pPort": ${ports.data_l1_p2p_port} }'`
  }

  const commands = [joiningInstruction[layer]]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const getInformationToJoinNode = async (event, layer) => {
  const { ports } = event.metagraph
  var urls = {
    [LAYERS.L0]: `http://${event.aws.ec2.instances.genesis.ip}:${ports.metagraph_l0_public_port}/node/info`,
    [LAYERS.CURRENCY_L1]: `http://${event.aws.ec2.instances.genesis.ip}:${ports.currency_l1_public_port}/node/info`,
    [LAYERS.DATA_L1]: `http://${event.aws.ec2.instances.genesis.ip}:${ports.data_l1_public_port}/node/info`,
  }

  for (let idx = 0; idx < 11; idx++) {
    try {
      const response = await axios.get(urls[layer])
      const nodeId = response.data.id

      return { nodeId }
    } catch (e) {
      if (idx === 10) {
        throw Error(`Could not get information of node in URL: ${urls[layer]}`)
      }
      console.log(`Node is possibly not READY yet, waiting for 10s to try again (${idx + 1}/11)`)
      await sleep(10000)
    }
  }
}

const checkIfValidatorsStarted = async (event, layer) => {
  const { ports } = event.metagraph
  var layerPorts = {
    [LAYERS.L0]: ports.metagraph_l0_public_port,
    [LAYERS.CURRENCY_L1]: ports.currency_l1_public_port,
    [LAYERS.DATA_L1]: ports.data_l1_public_port
  }

  const validatorsUrls = event.aws.ec2.instances.validators.map(validator => {
    return `http://${validator.ip}:${layerPorts[layer]}/node/info`
  })

  for (const url of validatorsUrls) {
    console.log(`Checking validator at URL: ${url}`)
    for (let idx = 0; idx < 11; idx++) {
      try {
        await axios.get(url)
        console.log(`Node started and healthy`)
        return
      } catch (e) {
        if (idx === 10) {
          throw Error(`Could not get information of node in URL: ${url}`)
        }
        console.log(`Node is possibly not READY yet, waiting for 10s to try again (${idx + 1}/11)`)
        await sleep(10000)
      }
    }
  }
}

const saveLogs = async (ssmClient, event, logName, layer, ec2InstancesIds) => {
  const { file_system } = event.metagraph
  printSeparatorWithMessage(`Saving logs ${layer} layer`)
  const directory = {
    [LAYERS.L0]: `cd ${file_system.base_metagraph_l0_directory}`,
    [LAYERS.CURRENCY_L1]: `cd ${file_system.base_currency_l1_directory}`,
    [LAYERS.DATA_L1]: `cd ${file_system.base_data_l1_directory}`
  }

  const commands = [
    directory[layer],
    `mkdir -p ../restart_logs`,
    `zip -r ${logName} logs/app.log`,
    `mv ${logName} ../restart_logs`,
    `rm -r logs`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)

  console.log('Waiting 10s to finish the compression...')
  await sleep(10000)
  printSeparatorWithMessage('Finished')
}

const checkIfAllNodesAreReady = async (event, layer) => {
  printSeparatorWithMessage(`[${layer}] Checking nodes statuses`)
  const { ports } = event.metagraph
  var layerPorts = {
    [LAYERS.L0]: ports.metagraph_l0_public_port,
    [LAYERS.CURRENCY_L1]: ports.currency_l1_public_port,
    [LAYERS.DATA_L1]: ports.data_l1_public_port
  }

  const validatorsUrls = layer === LAYERS.L0 ? [] : event.aws.ec2.instances.validators.map(validator => {
    return `http://${validator.ip}:${layerPorts[layer]}/node/info`
  })

  let urls = [`http://${event.aws.ec2.instances.genesis.ip}:${layerPorts[layer]}/node/info`, ...validatorsUrls]
  for (let idx = 0; idx < 20; idx++) {
    try {
      const readyNodesUrls = []
      for (const url of urls) {
        const response = await axios.get(url)
        const nodeState = response.data.state
        if (nodeState === 'Ready') {
          readyNodesUrls.push(url)
        }
      }
      if (readyNodesUrls.length > 0) {
        console.log(`[${layer}] The following nodes are already ready: ${JSON.stringify(readyNodesUrls)}`)
        urls = urls.filter(url => !readyNodesUrls.includes(url))
      }

      if (urls.length === 0) {
        console.log(`[${layer}] All nodes are on ready status`)
        printSeparatorWithMessage(`[${layer}] Finished`)
        return
      } else {
        console.log(`[${layer}] The following nodes are not ready yet: ${JSON.stringify(urls)}`)
        console.log(`[${layer}] Not all nodes are on Ready status, trying again in 10s (${idx + 1}/20)`)
        await sleep(10000)
      }
    } catch (e) {
      if (idx === 19) {
        throw new Error(`[${layer}] Failing when restarting nodes. All nodes should be on READY status`)
      }

      console.log(`[${layer}] Not all nodes are on Ready status, trying again in 10s (${idx + 1}/20)`)
      await sleep(10000)
    }
  }

}

const getAllEC2NodesInstances = (event) => {
  const genesisNodeId = event.aws.ec2.instances.genesis.id
  const validatorNodesId = event.aws.ec2.instances.validators.map(validator => validator.id)

  return [genesisNodeId, ...validatorNodesId]
}

const getUnhealthyClusters = async (event) => {
  const { ports } = event.metagraph
  let urls = [`http://${event.aws.ec2.instances.genesis.ip}:${ports.metagraph_l0_public_port}/cluster/info`]

  if (event.metagraph.include_currency_l1_layer) {
    urls.push(`http://${event.aws.ec2.instances.genesis.ip}:${ports.currency_l1_public_port}/cluster/info`)
  }

  if (event.metagraph.include_data_l1_layer) {
    urls.push(`http://${event.aws.ec2.instances.genesis.ip}:${ports.data_l1_public_port}/cluster/info`)
  }

  const unhealthyClusters = []
  for (const url of urls) {
    try {
      const response = await axios.get(url)
      const clusterInfo = response.data
      if (!url.includes(ports.metagraph_l0_public_port) && clusterInfo.length < 3) {
        console.log(`Less than 3: ${url}`)
        unhealthyClusters.push(url)
        continue
      }

      const anyNodeNotReady = clusterInfo.some(node => {
        return node.state !== 'Ready'
      })

      if (anyNodeNotReady) {
        console.log(`Not READY: ${url}`)
        unhealthyClusters.push(url)
      }
    } catch (e) {
      unhealthyClusters.push(url)
    }
  }

  return unhealthyClusters
}

const printSeparatorWithMessage = (message) => {
  console.log(`\n########################## ${message} ###############################\n`)
}

export {
  sleep,
  getLastMetagraphInfo,
  sendCommand,
  killCurrentProcesses,
  joinNodeToCluster,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  printSeparatorWithMessage,
  getSSMParameter,
  getKeys,
  saveLogs,
  checkIfAllNodesAreReady,
  getAllEC2NodesInstances,
  deleteSnapshotNotSyncToGL0,
  getUnhealthyClusters
}
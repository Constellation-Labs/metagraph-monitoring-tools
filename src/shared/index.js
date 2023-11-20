import axios from 'axios'
import moment from 'moment'
import { SendCommandCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { CHECK_CLUSTER_HEALTHY_LIMIT, LAYERS, NETWORK_NODES } from '../utils/types.js'

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const getLastMetagraphInfo = async (event) => {
  const { network, metagraph } = event
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

const getLatestMetagraphOfNetwork = async (networkName) => {
  const beUrl = `https://be-${networkName}.constellationnetwork.io/global-snapshots/latest`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotOrdinal = response.data.data.ordinal
    const lastSnapshotHash = response.data.data.hash

    console.log(`LAST SNAPSHOT OF NETWORK: ${networkName}. Ordinal: ${lastSnapshotOrdinal}. Hash: ${lastSnapshotHash}`)

    return {
      lastSnapshotOrdinal,
      lastSnapshotHash
    }
  } catch (e) {
    console.log(e)
    throw Error(`Error when searching for snapshot on: ${beUrl}`, e)
  }
}

const checkIfSnapshotExistsOnNode = async (nodeIp, nodePort, snapshotHash) => {
  const nodeUrl = `http://${nodeIp}:${nodePort}/global-snapshots/${snapshotHash}`
  try {
    await axios.get(nodeUrl)
    console.log(`Snapshot exists on node: ${nodeIp}`)
    return true
  } catch (e) {
    console.log(`Snapshot does not exists on node: ${nodeIp}`)
    return false
  }
}

const getReferenceSourceNode = async (event) => {
  const { network } = event
  const networkName = network.name

  console.log(`Starting to get reference source node for network: ${networkName}`)

  const networkNodes = NETWORK_NODES[networkName]
  if (!networkNodes || Object.keys(networkNodes).length === 0) {
    throw Error(`Could not find nodes of network: ${networkName}`)
  }

  const { node_1, node_2, node_3 } = networkNodes
  const { lastSnapshotHash } = await getLatestMetagraphOfNetwork(networkName)

  const snapshotExistsOnNode1 = await checkIfSnapshotExistsOnNode(node_1.ip, node_1.port, lastSnapshotHash)
  if (snapshotExistsOnNode1) {
    return node_1
  }

  const snapshotExistsOnNode2 = await checkIfSnapshotExistsOnNode(node_2.ip, node_2.port, lastSnapshotHash)
  if (snapshotExistsOnNode2) {
    return node_2
  }

  const snapshotExistsOnNode3 = await checkIfSnapshotExistsOnNode(node_3.ip, node_3.port, lastSnapshotHash)
  if (snapshotExistsOnNode3) {
    return node_3
  }

  return null
}

const sendCommand = async (ssmClient, commands, ec2InstancesIds) => {
  const params = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: ec2InstancesIds,
    Parameters: {
      commands
    },
  }

  try {
    const commandResponse = await ssmClient.send(new SendCommandCommand(params))
    console.log("Command sent successfully. Command ID:", commandResponse.Command.CommandId)
  } catch (error) {
    console.error("Error sending command:", error)
  }
}

const getSSMParameter = async (ssmClient, parameterName) => {
  const getParameterCommand = new GetParameterCommand({
    Name: parameterName,
  })

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

const deleteSnapshotNotSyncToGL0 = async (ssmClient, event, ec2InstancesIds) => {
  const { file_system } = event.metagraph
  const { lastSnapshotOrdinal } = await getLastMetagraphInfo(event)
  const initialSnapshotToRemove = lastSnapshotOrdinal
  const finalSnapshotToRemove = initialSnapshotToRemove + 1

  console.log(`Creating the mv_snapshot.sh script under metagraph-l0 directory`)
  const bkpDirectoryName = `incremental_snapshot_bkp_${moment.utc().format('YYYY_MM_DD_HH_mm_ss')}`
  const creatingCommands = [
    `cd ${file_system.base_metagraph_l0_directory}`,
    `mkdir -p data/${bkpDirectoryName}`,

    `echo "# Set the source and target directories
    source_dir="data/incremental_snapshot"
    target_dir="data/${bkpDirectoryName}/"
    # Use find to locate the files within the specified range
    for i in \\$(seq \\$1 \\$2); do
      source_file="\\$source_dir/\\$i"

      # Check if the source file exists before attempting to move it
      if [ -e "\\$source_file" ]; then
          echo "Processing file with ID \\$source_file"
          find \\$source_dir -mount -samefile \\$source_file -exec mv {} "\\$target_dir" \\;
      else
          echo "File \\$source_file does not exist."
      fi
    done" > mv_snapshots.sh`,

    `sudo chmod +x mv_snapshots.sh`,
  ]
  await sendCommand(ssmClient, creatingCommands, ec2InstancesIds)
  console.log(`Finished creating mv_snapshot.sh script`)

  console.log(`Moving incremental snapshots on data/incremental_snapshot to data/incremental_snapshot_bkp between: ${initialSnapshotToRemove} - ${finalSnapshotToRemove}`)
  const commands = [
    `cd ${file_system.base_metagraph_l0_directory}`,
    `./mv_snapshots.sh ${initialSnapshotToRemove} ${finalSnapshotToRemove}`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
  console.log(`Finishing moving the snapshots`)
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

  for (let idx = 0; idx < 60; idx++) {
    try {
      const response = await axios.get(urls[layer])
      const nodeId = response.data.id
      const state = response.data.state
      if (state !== 'Ready') {
        throw Error('Node not ready yet')
      }

      return { nodeId }
    } catch (e) {
      if (idx === 59) {
        throw Error(`Could not get information of node in URL: ${urls[layer]}`)
      }
      console.log(`Node is possibly not READY yet, waiting for 10s to try again (${idx + 1}/60)`)
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
  printSeparatorWithMessage(`[${layer}] Checking nodes states`)
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
        console.log(`[${layer}] All nodes are on ready state`)
        printSeparatorWithMessage(`[${layer}] Finished`)
        return
      } else {
        console.log(`[${layer}] The following nodes are not ready yet: ${JSON.stringify(urls)}`)
        console.log(`[${layer}] Not all nodes are on Ready state, trying again in 10s (${idx + 1}/20)`)
        await sleep(10000)
      }
    } catch (e) {
      if (idx === 19) {
        throw new Error(`[${layer}] Failing when restarting nodes. All nodes should be on READY state`)
      }

      console.log(`[${layer}] Not all nodes are on Ready state, trying again in 10s (${idx + 1}/20)`)
      await sleep(10000)
    }
  }

}

const getAllEC2NodesInstances = (event) => {
  const genesisNodeId = event.aws.ec2.instances.genesis.id
  const validatorNodesId = event.aws.ec2.instances.validators.map(validator => validator.id)

  return [genesisNodeId, ...validatorNodesId]
}

const _checkIfClusterIsUnhealthy = async (url, ports) => {
  for (let idx = 0; idx < CHECK_CLUSTER_HEALTHY_LIMIT; idx++) {
    try {
      const response = await axios.get(url)
      const clusterInfo = response.data
      const isL0Url = url.includes(ports.metagraph_l0_public_port)

      console.log(`Cluster Info ${url} response: ${JSON.stringify(clusterInfo)}`)

      if (isL0Url) {
        console.log(`L0 Cluster, at least one node should be Ready`)

        const anyNodeReady = clusterInfo.some(node => {
          return node.state === 'Ready'
        })

        if (!anyNodeReady) {
          console.log("All L0 nodes are not ready")
          return true
        }

        return false
      }

      console.log(`L1 Cluster, at least 3 nodes should be Ready`)
      if (clusterInfo.length < 3) {
        console.log(`Less than 3 nodes: ${url}`)
        return true
      }

      const readyNodes = clusterInfo.filter(node => {
        return node.state === 'Ready'
      })

      if (readyNodes.length < 3) {
        console.log(`We should have at least 3 ready nodes: ${url}`)
        return true
      }

      return false
    } catch (e) {
      if (idx === 4) {
        console.log(`Unhealthy cluster after trying ${CHECK_CLUSTER_HEALTHY_LIMIT} times`)
        return true
      }
      console.log(`Could not get cluster information at URL: ${url}. Trying again in 5s (${idx + 1}/${CHECK_CLUSTER_HEALTHY_LIMIT})`)
      await sleep(5 * 1000)
    }
  }
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
    const clusterIsUnhealthy = await _checkIfClusterIsUnhealthy(url, ports)
    if(clusterIsUnhealthy){
      unhealthyClusters.push(url)
    }
  }

  return unhealthyClusters
}

const printSeparatorWithMessage = (message) => {
  console.log(`\n########################## ${message} ###############################\n`)
}

const checkIfRollbackFinished = async (event) => {
  try {
    const { metagraph_l0_public_port } = event.metagraph.ports
    const url = `http://${event.aws.ec2.instances.genesis.ip}:${metagraph_l0_public_port}/node/info`

    const response = await axios.get(url)
    const nodeState = response.data.state
    console.log(`Current state of genesis node: ${nodeState}`)
    if (nodeState === 'Ready') {
      return true
    }
    return false
  } catch (e) {
    console.log("Error when checking node url", e)
    return false
  }
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
  getUnhealthyClusters,
  checkIfRollbackFinished,
  getReferenceSourceNode
}
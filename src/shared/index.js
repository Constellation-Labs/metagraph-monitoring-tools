import moment from 'moment';
import axios from 'axios';
import { SendCommandCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { LAYERS } from '../utils/types.js'

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getDiffBetweenLastMetagraphSnapshotAndNow = async (network, metagraph_id) => {
  const beUrl = `https://be-${network}.constellationnetwork.io/currency/${metagraph_id}/snapshots/latest`
  try {
    const response = await axios.get(beUrl)
    const lastSnapshotTimestamp = response.data.data.timestamp
    console.log(`LAST SNAPSHOT OF METAGRAPH ${metagraph_id}: ${lastSnapshotTimestamp}`)

    return moment.utc().diff(lastSnapshotTimestamp, 'minutes')
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
  } = event

  const commands = [
    `fuser -k ${metagraph_l0_public_port}/tcp`,
    `fuser -k ${currency_l1_public_port}/tcp`,
    `fuser -k ${data_l1_public_port}/tcp`,
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const joinNodeToCluster = async (ssmClient, event, layer, joiningNodeId, ec2InstancesIds) => {
  const joiningInstruction = {
    [LAYERS.L0]: `curl -v -X POST http://localhost:${event.metagraph_l0_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.metagraph_l0_p2p_port} }'`,
    [LAYERS.CURRENCY_L1]: `curl -v -X POST http://localhost:${event.currency_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.currency_l1_p2p_port} }'`,
    [LAYERS.DATA_L1]: `curl -v -X POST http://localhost:${event.data_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.data_l1_p2p_port} }'`
}

const commands = [joiningInstruction[layer]]

await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const getInformationToJoinNode = async (event, layer) => {
  var urls = {
    [LAYERS.L0]: `http://${event.ec2_instance_1_ip}:${event.metagraph_l0_public_port}/node/info`,
    [LAYERS.CURRENCY_L1]: `http://${event.ec2_instance_1_ip}:${event.currency_l1_public_port}/node/info`,
    [LAYERS.DATA_L1]: `http://${event.ec2_instance_1_ip}:${event.data_l1_public_port}/node/info`,
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
  var urls = {
    [LAYERS.L0]: [
      `http://${event.ec2_instance_2_ip}:${event.metagraph_l0_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.metagraph_l0_public_port}/node/info`
    ],
    [LAYERS.CURRENCY_L1]: [
      `http://${event.ec2_instance_2_ip}:${event.currency_l1_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.currency_l1_public_port}/node/info`
    ],
    [LAYERS.DATA_L1]: [
      `http://${event.ec2_instance_2_ip}:${event.data_l1_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.data_l1_public_port}/node/info`
    ],
  }

  const validatorsUrls = urls[layer]
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
  printSeparatorWithMessage(`Saving logs ${layer} layer`)
  const directory = {
    [LAYERS.L0]: `cd ${event.base_metagraph_l0_directory}`,
    [LAYERS.CURRENCY_L1]: `cd ${event.base_currency_l1_directory}`,
    [LAYERS.DATA_L1]: `cd ${event.base_data_l1_directory}`
  }

  const commands = [
    directory[layer],
    `mkdir -p ../restart_logs`,
    `zip -r ${logName} logs/app.log`,
    `mv ${logName} ../restart_logs`,
    `rm -r logs`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)

  console.log('Waiting 30s to finish the compression...')
  await sleep(30000)
  printSeparatorWithMessage('Finished')
}

const checkIfAllNodesAreReady = async (event, layer) => {
  printSeparatorWithMessage(`[${layer}] Checking nodes statuses`)
  const allUrls = {
    // Using only first node because the other ones could take more than timeout limit of lambda
    [LAYERS.L0]: [
      `http://${event.ec2_instance_1_ip}:${event.metagraph_l0_public_port}/node/info`,
    ],
    [LAYERS.CURRENCY_L1]: [
      `http://${event.ec2_instance_1_ip}:${event.currency_l1_public_port}/node/info`,
      `http://${event.ec2_instance_2_ip}:${event.currency_l1_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.currency_l1_public_port}/node/info`
    ],
    [LAYERS.DATA_L1]: [
      `http://${event.ec2_instance_1_ip}:${event.data_l1_public_port}/node/info`,
      `http://${event.ec2_instance_2_ip}:${event.data_l1_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.data_l1_public_port}/node/info`
    ]
  }

  let urls = allUrls[layer]
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

const printSeparatorWithMessage = (message) => {
  console.log(`\n########################## ${message} ###############################\n`)
}

export {
  sleep,
  getDiffBetweenLastMetagraphSnapshotAndNow,
  sendCommand,
  killCurrentProcesses,
  joinNodeToCluster,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  printSeparatorWithMessage,
  getSSMParameter,
  getKeys,
  saveLogs,
  checkIfAllNodesAreReady
}
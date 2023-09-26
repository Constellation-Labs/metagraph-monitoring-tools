import moment from 'moment';
import axios from 'axios';
import { SendCommandCommand, GetParameterCommand } from '@aws-sdk/client-ssm'

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
    l0: `curl -v -X POST http://localhost:${event.metagraph_l0_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.metagraph_l0_p2p_port} }'`,
    'currency-l1': `curl -v -X POST http://localhost:${event.currency_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.currency_l1_p2p_port} }'`,
    'data-l1': `curl -v -X POST http://localhost:${event.data_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${joiningNodeId}", "ip": "${event.ec2_instance_1_ip}", "p2pPort": ${event.data_l1_p2p_port} }'`
  }

  const commands = [joiningInstruction[layer]]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const getInformationToJoinNode = async (event, layer) => {
  var urls = {
    l0: `http://${event.ec2_instance_1_ip}:${event.metagraph_l0_public_port}/node/info`,
    'currency-l1': `http://${event.ec2_instance_1_ip}:${event.currency_l1_public_port}/node/info`,
    'data-l1': `http://${event.ec2_instance_1_ip}:${event.data_l1_public_port}/node/info`,
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
    l0: [
      `http://${event.ec2_instance_2_ip}:${event.metagraph_l0_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.metagraph_l0_public_port}/node/info`
    ],
    'currency-l1': [
      `http://${event.ec2_instance_2_ip}:${event.currency_l1_public_port}/node/info`,
      `http://${event.ec2_instance_3_ip}:${event.currency_l1_public_port}/node/info`
    ],
    'data-l1': [
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

const printSeparator = () => {
  console.log("\n######################################################\n")
}

export {
  sleep,
  getDiffBetweenLastMetagraphSnapshotAndNow,
  sendCommand,
  killCurrentProcesses,
  joinNodeToCluster,
  getInformationToJoinNode,
  checkIfValidatorsStarted,
  printSeparator,
  getKeys
}
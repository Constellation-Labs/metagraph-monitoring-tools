import moment from 'moment'
import { LAYERS } from '../utils/types.js'
import { sendCommand } from '../external/aws/ssm.js'
import { sleep } from './shared.js'

const killCurrentExecution = async (
  ssmClient,
  event,
  layer,
  ec2InstancesIds
) => {
  const {
    metagraph_l0_public_port,
    currency_l1_public_port,
    data_l1_public_port,
  } = event.metagraph.ports

  console.log(`Stopping ${layer} on ${JSON.stringify(ec2InstancesIds)}`)

  if (layer === LAYERS.L0) {
    const commands = [`fuser -k ${metagraph_l0_public_port}/tcp`]
    await sendCommand(ssmClient, commands, ec2InstancesIds)
    return
  }

  if (layer === LAYERS.CURRENCY_L1) {
    const commands = [`fuser -k ${currency_l1_public_port}/tcp`]
    await sendCommand(ssmClient, commands, ec2InstancesIds)
    return
  }

  if (layer === LAYERS.DATA_L1) {
    const commands = [`fuser -k ${data_l1_public_port}/tcp`]
    await sendCommand(ssmClient, commands, ec2InstancesIds)
    return
  }
}

const joinNodeToCluster = async (
  ssmClient,
  event,
  layer,
  nodeInformation,
  ec2InstancesIds
) => {
  const { nodeId, nodeHost, nodeP2pPort } = nodeInformation
  const { ports } = event.metagraph

  console.log(`Joining to node ${nodeHost} with id: ${nodeId}`)
  const joiningInstruction = {
    [LAYERS.L0]: `curl -v -X POST http://localhost:${ports.metagraph_l0_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${nodeId}", "ip": "${nodeHost}", "p2pPort": ${nodeP2pPort} }'`,
    [LAYERS.CURRENCY_L1]: `curl -v -X POST http://localhost:${ports.currency_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${nodeId}", "ip": "${nodeHost}", "p2pPort": ${nodeP2pPort} }'`,
    [LAYERS.DATA_L1]: `curl -v -X POST http://localhost:${ports.data_l1_cli_port}/cluster/join -H "Content-type: application/json" -d '{ "id":"${nodeId}", "ip": "${nodeHost}", "p2pPort": ${nodeP2pPort} }'`
  }

  const commands = [joiningInstruction[layer]]
  console.log(`Sending joining ${commands} to :${ec2InstancesIds}`)
  await sendCommand(ssmClient, commands, ec2InstancesIds)
}

const saveLogs = async (
  ssmClient,
  event,
  logName,
  layer,
  ec2InstancesIds
) => {
  console.log(`Saving logs ${layer} nodes: ${JSON.stringify(ec2InstancesIds)}`)
  const { file_system } = event.metagraph
  const directory = {
    [LAYERS.L0]: `cd ${file_system.base_metagraph_l0_directory}`,
    [LAYERS.CURRENCY_L1]: `cd ${file_system.base_currency_l1_directory}`,
    [LAYERS.DATA_L1]: `cd ${file_system.base_data_l1_directory}`
  }

  const commands = [
    directory[layer],
    `mkdir -p ../restart_logs`,
    `zip -r ${logName} logs`,
    `mv ${logName} ../restart_logs`,
    `rm -r logs`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
  console.log(`Waiting 10s to compress logs and store...`)
  await sleep(10 * 1000)
}

const getLogsNames = () => {
  const now = moment.utc().format('YYY-MM-DD_HH-mm-ss')

  const l0LogName = `log-${now}-l0.zip`
  const cl1LogName = `log-${now}-cl1.zip`
  const dl1LogName = `log-${now}-dl1.zip`

  return {
    l0LogName,
    cl1LogName,
    dl1LogName
  }
}

export {
  killCurrentExecution,
  joinNodeToCluster,
  saveLogs,
  getLogsNames
}
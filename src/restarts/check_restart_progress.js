import moment from 'moment'
import { deleteMetagraphRestart, getMetagraphRestartOrCreateNew, upsertMetagraphRestart } from "../external/aws/dynamo.js"
import { closeCurrentMetagraphRestartAlert, createMetagraphRestartFailureAlert } from "../external/opsgenie/index.js"
import { checkIfNodeIsReady, getLogsNames } from "../shared/index.js"
import { DYNAMO_RESTART_STATE, DYNAMO_RESTART_TYPES, ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES, DATE_FORMAT } from "../utils/types.js"
import { finishMetagraphRollback } from "./full_cluster.js"

const checkFullClusterRestart = async (event, metagraphId, currentMetagraphRestart) => {
  console.log(`Checking full cluster restart`)
  const { state, restartType, restartReason, referenceNodeIp } = currentMetagraphRestart;

  const node1 = event.aws.ec2.instances.genesis
  const node2 = event.aws.ec2.instances.validators[0]
  const node3 = event.aws.ec2.instances.validators[1]
  const { ports } = event.metagraph

  const node1Ready = await checkIfNodeIsReady(node1.ip, ports.metagraph_l0_public_port)
  const node2Ready = await checkIfNodeIsReady(node2.ip, ports.metagraph_l0_public_port)
  const node3Ready = await checkIfNodeIsReady(node3.ip, ports.metagraph_l0_public_port)

  if (node1Ready && node2Ready && node3Ready) {
    console.log('All nodes are READY')
    return await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY, restartType, restartReason, referenceNodeIp)
  }

  if ((node1Ready || node2Ready || node3Ready) && state === DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS) {
    console.log('Initial node ready to JOIN')
    return await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY_TO_JOIN, restartType, restartReason, referenceNodeIp)
  }

  console.log(`Still restarting`)
  return currentMetagraphRestart
}

const checkIndividualNodesRestart = async (metagraphId, currentMetagraphRestart) => {
  console.log(`Checking inidivudal node restart`)
  const { restartType, restartReason, individualNodesIpsWithPorts } = currentMetagraphRestart;
  if (!individualNodesIpsWithPorts) {
    throw Error(`Could not get individualNodesIpsWithPorts from individual nodes restart`)
  }

  const individualNodesIpsWithPortsAsList = individualNodesIpsWithPorts.split(',')
  const nodesReady = []

  console.log(`Starting to check the status of nodes: ${JSON.stringify(individualNodesIpsWithPortsAsList)}`)
  for (const currentNodeIpAndPort of individualNodesIpsWithPortsAsList) {
    const node = currentNodeIpAndPort.split(':')
    const nodeReady = await checkIfNodeIsReady(node[0], node[1])
    if (nodeReady) {
      nodesReady.push(currentNodeIpAndPort)
    }
  }

  if (nodesReady.length === individualNodesIpsWithPortsAsList.length) {
    console.log(`All nodes READY`)
    return await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY, restartType, restartReason, '', individualNodesIpsWithPorts)
  }

  console.log(`Still restarting`)
  return currentMetagraphRestart
}

const checkRestartStatus = async (event, networkName, currentMetagraphRestart) => {
  const { restartType, state } = currentMetagraphRestart;
  const metagraphId = event.metagraph.id

  if (state === DYNAMO_RESTART_STATE.NEW) {
    return currentMetagraphRestart
  }
  if (restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) {
    return await checkFullClusterRestart(event, metagraphId, currentMetagraphRestart)
  }
  if (restartType === DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES) {
    return await checkIndividualNodesRestart(metagraphId, currentMetagraphRestart)
  }

  throw Error(`Error when checking restart status of metagraph: ${networkName}`)
}

const checkMetagraphRestartProgress = async (event, metagraphId, oldMetagraphRestart) => {
  console.log(`Getting current restart status`)
  const metagraphRestart = await checkRestartStatus(event, metagraphId, oldMetagraphRestart)
  if (metagraphRestart.state === DYNAMO_RESTART_STATE.READY) {
    return {
      statusCode: 200,
      finishCurrentDynamoDBMetagraphRestart: true,
      message: 'All nodes are in READY state',
      metagraphRestart
    }
  }

  const { updatedAt } = metagraphRestart
  const lastRestartTimeDiff = moment.utc().diff(moment.utc(updatedAt), 'minutes')

  if (lastRestartTimeDiff <= ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES) {
    const timeoutTime = moment.utc(updatedAt).add(ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES, 'minutes')
    console.log(`Operation running since: ${updatedAt} will timeout at ${timeoutTime.format(DATE_FORMAT)}`)

    return {
      statusCode: 200,
      finishCurrentDynamoDBMetagraphRestart: false,
      message: 'There is already one restart in progress for this metagraph, please wait this operation could take hours',
      metagraphRestart
    }
  }

  return {
    statusCode: 400,
    finishCurrentDynamoDBMetagraphRestart: true,
    message: `The last restart of network is taking more than ${ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES} minutes, please check the logs. Triggering a new restart...`,
    metagraphRestart
  }
}

const getMetagraphRestartProgress = async (ssmClient, event, currentMetagraphRestart, referenceSourceNode) => {
  console.log(`Starting to get metagraph restart progress`)
  if (currentMetagraphRestart.state === DYNAMO_RESTART_STATE.NEW) {
    console.log(`New restart`)
    return {
      status: 200,
      body: 'New Restart',
      restartState: DYNAMO_RESTART_STATE.NEW,
      metagraphRestart: currentMetagraphRestart
    }
  }

  const metagraphRestartProgress = await checkMetagraphRestartProgress(
    event,
    event.metagraph.id,
    currentMetagraphRestart
  )

  const { state, restartType, restartReason, referenceNodeIp } = metagraphRestartProgress.metagraphRestart
  if (state === DYNAMO_RESTART_STATE.READY_TO_JOIN && restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) {
    console.log(`Metagraph is READY_TO_JOIN triggering finishMetagraphRollback`)
    
    const logsNames = getLogsNames()
    await finishMetagraphRollback(ssmClient, event, logsNames, referenceSourceNode)

    await upsertMetagraphRestart(
      event.metagraph.id,
      DYNAMO_RESTART_STATE.JOINING,
      restartType,
      restartReason,
      referenceNodeIp,
    )

    return {
      status: 200,
      restartState: DYNAMO_RESTART_STATE.JOINING,
      body: 'finishMetagraphRollback triggered, finishing current execution.',
      metagraphRestart: currentMetagraphRestart
    }
  }

  if (metagraphRestartProgress.finishCurrentDynamoDBMetagraphRestart) {
    console.log(`Deleting current metagraph restart on dynamo table`)
    await deleteMetagraphRestart(event.metagraph.id)
    if (metagraphRestartProgress.statusCode === 200) {
      await closeCurrentMetagraphRestartAlert(ssmClient, event)
    }
  }

  if (metagraphRestartProgress.statusCode === 200) {
    return {
      statusCode: 200,
      body: JSON.stringify(metagraphRestartProgress.message),
      metagraphRestart: currentMetagraphRestart
    }
  }

  await createMetagraphRestartFailureAlert(
    ssmClient,
    event,
    metagraphRestartProgress.message,
    metagraphRestartProgress.metagraphRestart
  )

  const metagraphRestart = await getMetagraphRestartOrCreateNew(metagraphId)
  return {
    status: 200,
    restartState: DYNAMO_RESTART_STATE.NEW,
    body: 'Starting a new restart because the last one timed out',
    metagraphRestart
  }
}

export {
  getMetagraphRestartProgress
}
import moment from 'moment'
import { deleteMetagraphRestart, getMetagraphRestartOrCreateNew, upsertMetagraphRestart } from "../external/aws/dynamo.js"
import { createMetagraphRestartFailureAlert } from "../external/opsgenie/index.js"
import { DYNAMO_RESTART_STATE, DYNAMO_RESTART_TYPES, ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES, DATE_FORMAT } from "../utils/types.js"
import { finishMetagraphRollback } from "./full_cluster.js"
import { checkIfNodeIsReady } from '../shared/check_nodes_health.js'
import { getLogsNames } from '../shared/restart_operations.js'

const _checkFullClusterRestart = async (
  event,
  metagraphId,
  currentMetagraphRestart
) => {
  console.log(`Checking full cluster restart`)
  const { state, restartType, restartReason, referenceNodeIp } = currentMetagraphRestart;

  const node1 = event.aws.ec2.instances.genesis
  const node2 = event.aws.ec2.instances.validators[0]
  const node3 = event.aws.ec2.instances.validators[1]
  const { ports } = event.metagraph

  const { nodeIsReady: node1Ready } = await checkIfNodeIsReady(node1.ip, ports.metagraph_l0_public_port)
  const { nodeIsReady: node2Ready } = await checkIfNodeIsReady(node2.ip, ports.metagraph_l0_public_port)
  const { nodeIsReady: node3Ready } = await checkIfNodeIsReady(node3.ip, ports.metagraph_l0_public_port)

  if (node1Ready && node2Ready && node3Ready) {
    console.log('All nodes are READY')
    return {
      metagraphRestart: await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY, restartType, restartReason, referenceNodeIp),
      successExecution: true
    }
  }

  if ((node1Ready || node2Ready || node3Ready) && state === DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS) {
    console.log('Initial node ready to JOIN')
    return {
      metagraphRestart: await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY_TO_JOIN, restartType, restartReason, referenceNodeIp),
      successExecution: true
    }
  }

  console.log(`Still restarting`)
  return {
    metagraphRestart: currentMetagraphRestart,
    successExecution: true
  }
}

const _checkIndividualNodesRestart = async (
  metagraphId,
  currentMetagraphRestart
) => {
  console.log(`Checking inidivudal node restart`)
  const { restartType, restartReason, individualNodesIpsWithPorts } = currentMetagraphRestart;
  if (!individualNodesIpsWithPorts) {
    throw Error(`Could not get individualNodesIpsWithPorts from individual nodes restart`)
  }

  const individualNodesIpsWithPortsAsList = individualNodesIpsWithPorts.split(',')
  const nodesReady = []
  const nodesFailureExecution = []

  console.log(`Starting to check the status of nodes: ${JSON.stringify(individualNodesIpsWithPortsAsList)}`)
  for (const currentNodeIpAndPort of individualNodesIpsWithPortsAsList) {
    const node = currentNodeIpAndPort.split(':')
    const { nodeIsReady, successCheck } = await checkIfNodeIsReady(node[0], node[1])
    if (nodeIsReady && successCheck) {
      nodesReady.push(currentNodeIpAndPort)
    }
    if (!successCheck) {
      nodesFailureExecution.push(currentNodeIpAndPort)
    }
  }

  if (nodesReady.length === individualNodesIpsWithPortsAsList.length) {
    console.log(`All nodes READY`)
    return {
      metagraphRestart: await upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.READY, restartType, restartReason, '', individualNodesIpsWithPorts),
      successExecution: true
    }
  }

  if (nodesFailureExecution.length > 0) {
    console.log(`Failure checking node`)
    return {
      metagraphRestart: currentMetagraphRestart,
      successExecution: false
    }
  }

  console.log(`Still restarting`)
  return {
    metagraphRestart: currentMetagraphRestart,
    successExecution: true
  }
}

const _checkRestartStatus = async (
  event,
  networkName,
  currentMetagraphRestart
) => {
  const { restartType, state } = currentMetagraphRestart;
  const metagraphId = event.metagraph.id

  if (state === DYNAMO_RESTART_STATE.NEW) {
    return {
      metagraphRestart: currentMetagraphRestart,
      successExecution: true
    }
  }

  if (restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) {
    return await _checkFullClusterRestart(event, metagraphId, currentMetagraphRestart)
  }

  if (restartType === DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES) {
    return await _checkIndividualNodesRestart(metagraphId, currentMetagraphRestart)
  }

  throw Error(`Error when checking restart status of metagraph: ${networkName}`)
}

const _checkMetagraphRestartProgress = async (
  event,
  metagraphId,
  currentMetagraphRestart
) => {
  console.log(`Getting current restart status`)
  const { metagraphRestart, successExecution } = await _checkRestartStatus(
    event,
    metagraphId,
    currentMetagraphRestart
  )

  if (!successExecution) {
    return {
      restartCompleted: false,
      triggerNewRestart: true,
      closeOpsgenieAlerts: false,
      deleteCurrentRestart: true,
      message: `Failure checking current restart, triggering a new...`,
      updatedMetagraphRestart: metagraphRestart
    }
  }

  if (metagraphRestart.state === DYNAMO_RESTART_STATE.READY) {
    return {
      restartCompleted: true,
      triggerNewRestart: false,
      closeOpsgenieAlerts: true,
      deleteCurrentRestart: true,
      message: 'All nodes are in READY state',
      updatedMetagraphRestart: metagraphRestart
    }
  }

  const { updatedAt } = metagraphRestart
  const lastRestartTimeDiff = moment.utc().diff(moment.utc(updatedAt), 'minutes')

  if (lastRestartTimeDiff <= ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES) {
    const timeoutTime = moment.utc(updatedAt).add(ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES, 'minutes')
    console.log(`Operation running since: ${updatedAt} will timeout at ${timeoutTime.format(DATE_FORMAT)}`)

    return {
      restartCompleted: false,
      triggerNewRestart: false,
      closeOpsgenieAlerts: false,
      deleteCurrentRestart: false,
      message: 'There is already one restart in progress for this metagraph, please wait this operation could take some minutes',
      updatedMetagraphRestart: metagraphRestart
    }
  }

  return {
    restartCompleted: false,
    triggerNewRestart: true,
    closeOpsgenieAlerts: false,
    deleteCurrentRestart: true,
    message: `The last restart of network is taking more than ${ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES} minutes, please check the logs. Triggering a new restart...`,
    updatedMetagraphRestart: metagraphRestart
  }
}

const checkCurrentMetagraphRestart = async (
  ssmClient,
  event,
  referenceSourceNode,
  currentMetagraphRestart
) => {
  console.log(`Starting to get metagraph restart progress`)
  if (currentMetagraphRestart.state === DYNAMO_RESTART_STATE.NEW) {
    return {
      closeOpsgenieAlerts: false,
      deleteCurrentRestart: false,
      restartState: DYNAMO_RESTART_STATE.NEW,
      message: 'New Restart',
    }
  }

  const {
    restartCompleted,
    triggerNewRestart,
    closeOpsgenieAlerts,
    deleteCurrentRestart,
    message,
    updatedMetagraphRestart
  } = await _checkMetagraphRestartProgress(
    event,
    event.metagraph.metagraphId,
    currentMetagraphRestart
  )

  if (restartCompleted) {
    return {
      closeOpsgenieAlerts,
      deleteCurrentRestart,
      restartState: DYNAMO_RESTART_STATE.READY,
      message
    }
  }

  if (triggerNewRestart) {
    await createMetagraphRestartFailureAlert(
      ssmClient,
      event,
      message,
      updatedMetagraphRestart
    )

    await deleteMetagraphRestart(event.metagraph.id)
    await getMetagraphRestartOrCreateNew(event.metagraph.id)

    return {
      closeOpsgenieAlerts,
      deleteCurrentRestart,
      restartState: DYNAMO_RESTART_STATE.NEW,
      message: 'Starting a new restart because the last one failed',
    }
  }

  const { state, restartType, restartReason, referenceNodeIp } = updatedMetagraphRestart
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
      closeOpsgenieAlerts,
      deleteCurrentRestart,
      restartState: DYNAMO_RESTART_STATE.JOINING,
      message: 'finishMetagraphRollback triggered, finishing current execution.',
    }
  }

  return {
    closeOpsgenieAlerts,
    deleteCurrentRestart,
    restartState: DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS,
    message,
  }
}

export {
  checkCurrentMetagraphRestart
}
import { SSMClient } from '@aws-sdk/client-ssm'
import moment from 'moment'
import { LAYERS, RESTART_REASONS, DYNAMO_RESTART_STATE, DYNAMO_RESTART_TYPES, MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS } from './src/utils/types.js'
import { deleteMetagraphRestart, getMetagraphRestartOrCreateNew, upsertMetagraphRestart } from './src/external/aws/dynamo.js'
import { startMetagraphRollback } from './src/restarts/full_cluster.js'
import { restartIndividualNode } from './src/restarts/individual_node.js'
import { closeCurrentMetagraphRestartAlert, createMetagraphRestartFailureAlert, createMetagraphRestartStartedAlert } from './src/external/opsgenie/index.js'
import { checkCurrentMetagraphRestart } from './src/restarts/check_restart_progress.js'
import { restartIndividualCluster } from './src/restarts/individual_cluster.js'
import { checkUnhealthyNodes } from './src/restart_conditions/unhealthy_nodes.js'
import { checkDataL1TransactionsStopped } from './src/restart_conditions/data_l1_transactions_stopped.js'
import { checkIfForceRestartIsProvided } from './src/restart_conditions/force_restart.js'
import { checkIfSnapshotsStopped } from './src/restart_conditions/snapshots_stopped.js'
import { getLastMetagraphInfo, getReferenceSourceNode } from './src/shared/get_metagraph_info.js'
import { sleep } from './src/shared/shared.js'
import { checkIfAllNodesAreReady } from './src/shared/check_nodes_health.js'
import { getLogsNames } from './src/shared/restart_operations.js'

const _validateIfAllNodesAreReady = async (
  event
) => {
  console.log(`Starting validation to check if all nodes are ready`)

  const promises = []
  promises.push(checkIfAllNodesAreReady(event, LAYERS.L0))

  if (event.include_currency_l1_layer) {
    promises.push(checkIfAllNodesAreReady(event, LAYERS.CURRENCY_L1))
  }

  if (event.include_data_l1_layer) {
    promises.push(checkIfAllNodesAreReady(event, LAYERS.DATA_L1))
  }

  await Promise.all(promises)

  console.log(`All nodes are ready\n\n`)
}

const _checkIfNewSnapshotsAreProducedAfterRestart = async (
  event
) => {
  console.log("Checking if new snapshots was produced after restart. Waiting 10s ...")
  await sleep(10 * 1000)
  const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)

  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff > MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS) {
    await deleteMetagraphRestart(event.metagraph.id)
    throw Error("Snapshots keep not being produced even after restarting, take a look at the instances")
  }

  console.log(`New snapshots were produced`)
}

const _getMetagraphRestartType = async (
  event
) => {
  const forceRestartCheck = await checkIfForceRestartIsProvided(event)
  if (forceRestartCheck) {
    console.log(`Restarting FULL CLUSTER: Force metagraph restart provided`)
    return forceRestartCheck
  }

  const snapshotStoppedCheck = await checkIfSnapshotsStopped(event)
  if (snapshotStoppedCheck) {
    console.log(`Restart type FULL CLUSTER: Snapshots stopped being produced`)
    return snapshotStoppedCheck
  }

  const unhealthyNodesCheck = await checkUnhealthyNodes(event)
  if (unhealthyNodesCheck) {
    console.log(`Unhealthy nodes detected, starting a restart`)
    return unhealthyNodesCheck
  }

  const dataL1TransactionsStoppedCheck = await checkDataL1TransactionsStopped(event)
  if (dataL1TransactionsStoppedCheck) {
    console.log(`Restart type FULL LAYER: Data L1 transactions stopped`)
    return dataL1TransactionsStoppedCheck
  }

  console.log(`Restart type NOT RESTART: Metagraph healthy`)
  return {
    restartType: DYNAMO_RESTART_TYPES.NOT_RESTART,
    reason: 'Metagraph healthy',
    unhealthyNodes: {}
  }
}

const _getReferenceSourceNodeFromNetwork = async (
  event
) => {
  console.log(`Getting reference source node from network`)
  const referenceSourceNode = await getReferenceSourceNode(event)
  if (!referenceSourceNode) {
    throw Error(`Could not get reference node to network ${event.network.name}`)
  }

  console.log(`ReferenceSourceNode found: ${JSON.stringify(referenceSourceNode)}`)

  return referenceSourceNode
}

const _handleRestartMetagraph = async (
  event,
  ssmClient
) => {
  const metagraphId = event.metagraph.id

  console.log(`Starting the restart script`)

  console.log(`Getting the current metagraph restart`)
  const currentMetagraphRestart = await getMetagraphRestartOrCreateNew(metagraphId)

  console.log(`Getting the reference source node`)
  const referenceSourceNode = await _getReferenceSourceNodeFromNetwork(event)

  console.log(`Getting possible metagraph restart type`)
  const metagraphRestartType = await _getMetagraphRestartType(event)

  if (
    !(currentMetagraphRestart.restartType === DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES && metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) &&
    currentMetagraphRestart.state !== DYNAMO_RESTART_STATE.NEW
  ) {
    console.log(`Checking current metagraph restart`)
    const { closeOpsgenieAlerts, deleteCurrentRestart, restartState, message } = await checkCurrentMetagraphRestart(
      ssmClient,
      event,
      referenceSourceNode,
      currentMetagraphRestart
    );

    if (restartState === DYNAMO_RESTART_STATE.READY) {
      console.log(`Current restart READY, validating the nodes`)
      await _validateIfAllNodesAreReady(event);
      console.log(`All nodes are READY`)

      await _checkIfNewSnapshotsAreProducedAfterRestart(event);
    }

    return {
      closeOpsgenieAlerts,
      deleteCurrentRestart,
      message
    }
  }

  try {
    const { l0LogName, cl1LogName, dl1LogName } = getLogsNames()
    if (metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.NOT_RESTART) {
      console.log(`Restart Type: ${DYNAMO_RESTART_TYPES.NOT_RESTART}, skipping restart!`)
      return {
        closeOpsgenieAlerts: true,
        deleteCurrentRestart: true,
        message: metagraphRestartType.reason
      }
    }

    if (metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) {
      console.log(`Restart Type: ${DYNAMO_RESTART_TYPES.FULL_CLUSTER}, triggering restart!`)
      await startMetagraphRollback(ssmClient, event, l0LogName, referenceSourceNode)
      const metagraphRestart = await upsertMetagraphRestart(
        metagraphId,
        DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS,
        DYNAMO_RESTART_TYPES.FULL_CLUSTER,
        metagraphRestartType.reason,
        event.aws.ec2.instances.genesis.ip
      )

      await createMetagraphRestartStartedAlert(ssmClient, event, metagraphRestart)
      return {
        closeOpsgenieAlerts: false,
        deleteCurrentRestart: false,
        message: RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS,
      }
    }

    console.log(`Restart Type: ${DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES}, triggering restart!`)
    const { unhealthyMetagraphL0 = [] } = metagraphRestartType.unhealthyNodes
    const { unhealthyCurrencyL1 = [] } = metagraphRestartType.unhealthyNodes
    const { unhealthyDataL1 = [] } = metagraphRestartType.unhealthyNodes

    const unhealthyNodes = [...unhealthyMetagraphL0]
    const unhealthyClusters = []

    if (unhealthyCurrencyL1 && unhealthyCurrencyL1.length === 3) {
      await restartIndividualCluster(ssmClient, event, cl1LogName, LAYERS.CURRENCY_L1, referenceSourceNode)
      unhealthyClusters.push(...unhealthyCurrencyL1)
    } else {
      unhealthyNodes.push(...unhealthyCurrencyL1)
    }

    if (unhealthyDataL1 && unhealthyDataL1.length === 3) {
      await restartIndividualCluster(ssmClient, event, dl1LogName, LAYERS.DATA_L1, referenceSourceNode)
      unhealthyClusters.push(...unhealthyDataL1)
    } else {
      unhealthyNodes.push(...unhealthyDataL1)
    }

    for (const node of unhealthyNodes) {
      const logName = node.layer === LAYERS.L0 ? l0LogName : node.layer === LAYERS.CURRENCY_L1 ? cl1LogName : dl1LogName
      await restartIndividualNode(ssmClient, event, logName, node, referenceSourceNode)
    }

    const nodesIpsWithPorts = [...unhealthyNodes, ...unhealthyClusters].map(node => `${node.ip}:${node.port}`)
    const metagraphRestart = await upsertMetagraphRestart(
      metagraphId,
      DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS,
      DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES,
      metagraphRestartType.reason,
      '',
      nodesIpsWithPorts.join(',')
    )

    await createMetagraphRestartStartedAlert(ssmClient, event, metagraphRestart)
    return {
      closeOpsgenieAlerts: false,
      deleteCurrentRestart: false,
      message: RESTART_REASONS.UNHEALTHY_NODES,
    }
  } catch (e) {
    await createMetagraphRestartFailureAlert(ssmClient, event, e.message, 'Unknow reason')
    throw e
  }
}

export const handler = async (
  event
) => {
  const ssmClient = new SSMClient({ region: event.aws.region })
  const { closeOpsgenieAlerts, deleteCurrentRestart, message } = await _handleRestartMetagraph(event, ssmClient)

  if (closeOpsgenieAlerts) {
    console.log(`Closing opsgenie alerts`)
    await closeCurrentMetagraphRestartAlert(ssmClient, event)
  }

  if (deleteCurrentRestart) {
    console.log(`Deleting current restart`)
    await deleteMetagraphRestart(event.metagraph.id)
  }

  return {
    statusCode: 200,
    body: JSON.stringify(message)
  }
}
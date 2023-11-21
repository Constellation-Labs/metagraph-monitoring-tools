import { SSMClient } from '@aws-sdk/client-ssm'
import moment from 'moment'
import {
  getLastMetagraphInfo,
  checkIfAllNodesAreReady,
  sleep,
  getAllUnhealthyNodes,
  getLogsNames,
  groupBy,
  getReferenceSourceNode
} from './src/shared/index.js'
import { LAYERS, RESTART_REASONS, DYNAMO_RESTART_STATE, DYNAMO_RESTART_TYPES } from './src/utils/types.js'
import { deleteMetagraphRestart, getMetagraphRestartOrCreateNew, upsertMetagraphRestart } from './src/external/aws/dynamo.js'
import { startMetagraphRollback } from './src/restarts/full_cluster.js'
import { restartIndividualNode } from './src/restarts/individual_node.js'
import { createMetagraphRestartFailureAlert, createMetagraphRestartStartedAlert } from './src/external/opsgenie/index.js'
import { getMetagraphRestartProgress } from './src/restarts/check_restart_progress.js'
import { restartIndividualCluster } from './src/restarts/individual_cluster.js'

const validateIfAllNodesAreReady = async (event) => {
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

const checkIfNewSnapshotsAreProducedAfterRestart = async (event) => {
  console.log("Checking if new snapshots was produced after restart. Waiting 10s ...")
  await sleep(10 * 1000)
  const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)

  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff > 4) {
    await deleteMetagraphRestart(event.metagraph.id)
    throw Error("Snapshots keep not being produced even after restarting, take a look at the instances")
  }

  console.log(`New snapshots were produced`)
}

const getMetagraphRestartType = async (event, lastSnapshotTimestamp) => {
  console.log(`Starting to get the metagraph restart type`)

  if (event.force_metagraph_restart) {
    console.log(`Restarting FULL CLUSTER: Force metagraph restart provided`)
    await deleteMetagraphRestart(event.metagraph.id)
    return {
      restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
      reason: RESTART_REASONS.FORCE_METAGRAPH_RESTART,
      unhealthyNodes: {}
    }
  }

  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff > 4) {
    console.log(`Restart type FULL CLUSTER: Snapshots stopped being produced`)
    return {
      restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
      reason: RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS,
      unhealthyNodes: {}
    }
  }

  console.log(`Snapshots are being producing normally, last snapshot timestamp: ${lastSnapshotTimestamp}`)

  const unhealthyNodes = await getAllUnhealthyNodes(event)
  if (unhealthyNodes.length > 0) {
    const unhealthyNodesGroupedByLayer = groupBy(unhealthyNodes, 'layer')
    const unhealthyMetagraphL0 = unhealthyNodesGroupedByLayer[LAYERS.L0] ?? []
    const unhealthyCurrencyL1 = unhealthyNodesGroupedByLayer[LAYERS.CURRENCY_L1] ?? []
    const unhealthyDataL1 = unhealthyNodesGroupedByLayer[LAYERS.DATA_L1] ?? []

    if (unhealthyNodes.length === 9 || unhealthyMetagraphL0.length === 3) {
      console.log(`Restart type FULL CLUSTER: Unhealthy clusters. ML0: ${JSON.stringify(unhealthyMetagraphL0)}, CL1: ${unhealthyCurrencyL1}, DL1: ${unhealthyDataL1}`)
      return {
        restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
        reason: RESTART_REASONS.UNHEALTHY_CLUSTER,
        unhealthyNodes: {
          unhealthyMetagraphL0,
          unhealthyCurrencyL1,
          unhealthyDataL1
        }
      }
    }

    console.log(`Restart type INDIVIDUAL NODES: Unhealthy clusters. ML0: ${unhealthyMetagraphL0}, CL1: ${unhealthyCurrencyL1}, DL1: ${unhealthyDataL1}`)
    return {
      restartType: DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES,
      reason: RESTART_REASONS.UNHEALTHY_CLUSTER,
      unhealthyNodes: {
        unhealthyMetagraphL0,
        unhealthyCurrencyL1,
        unhealthyDataL1
      }
    }
  }

  console.log(`Restart type NOT RESTART: Metagraph healthy`)
  return {
    restartType: DYNAMO_RESTART_TYPES.NOT_RESTART,
    reason: '',
    unhealthyNodes: {}
  }
}

const getReferenceSourceNodeFromNetwork = async (event) => {
  console.log(`Getting reference source node from network`)
  const referenceSourceNode = await getReferenceSourceNode(event)
  if (!referenceSourceNode) {
    throw Error(`Could not get reference node to network ${event.network.name}`)
  }

  console.log(`ReferenceSourceNode found: ${JSON.stringify(referenceSourceNode)}`)

  return referenceSourceNode
}

export const handler = async (event) => {
  const ssmClient = new SSMClient({ region: event.aws.region })
  const referenceSourceNode = await getReferenceSourceNodeFromNetwork(event)
  const metagraphId = event.metagraph.id

  const currentMetagraphRestart = await getMetagraphRestartOrCreateNew(metagraphId)
  const restartProgress = await getMetagraphRestartProgress(
    ssmClient,
    event,
    currentMetagraphRestart,
    referenceSourceNode
  )

  if (restartProgress.restartState !== DYNAMO_RESTART_STATE.NEW) {
    return {
      statusCode: 200,
      body: restartProgress.body,
    }
  }

  if (restartProgress.restartState === DYNAMO_RESTART_STATE.READY) {
    await validateIfAllNodesAreReady(event)
    await checkIfNewSnapshotsAreProducedAfterRestart(event)

    return {
      statusCode: 200,
      body: JSON.stringify('Metagraph healthy, after restart'),
    }
  }

  try {
    const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)
    const metagraphRestartType = await getMetagraphRestartType(event, lastSnapshotTimestamp)
    if (metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.NOT_RESTART) {
      return {
        statusCode: 200,
        body: JSON.stringify('Metagraph healthy, ignoring restart!'),
      }
    }

    const logsNames = getLogsNames()

    if (metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER) {
      await startMetagraphRollback(ssmClient, event, logsNames.l0LogName, referenceSourceNode)
      const metagraphRestart = await upsertMetagraphRestart(
        metagraphId,
        DYNAMO_RESTART_STATE.ROLLBACK_IN_PROGRESS,
        DYNAMO_RESTART_TYPES.FULL_CLUSTER,
        metagraphRestartType.reason,
        event.aws.ec2.instances.genesis.ip
      )

      await createMetagraphRestartStartedAlert(ssmClient, event, metagraphRestart)
      return {
        statusCode: 200,
        body: JSON.stringify(RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS),
      }

    }

    if (metagraphRestartType.restartType === DYNAMO_RESTART_TYPES.INDIVIDUAL_NODES) {
      const unhealthyNodes = [...metagraphRestartType.unhealthyNodes.unhealthyMetagraphL0]
      if (
        metagraphRestartType.unhealthyNodes.unhealthyCurrencyL1 &&
        metagraphRestartType.unhealthyNodes.unhealthyCurrencyL1.length === 3
      ) {
        await restartIndividualCluster(ssmClient, event, logsNames.cl1LogName, LAYERS.CURRENCY_L1, referenceSourceNode)
      } else {
        unhealthyNodes.push(...metagraphRestartType.unhealthyNodes.unhealthyCurrencyL1)
      }

      if (
        metagraphRestartType.unhealthyNodes.unhealthyDataL1 &&
        metagraphRestartType.unhealthyNodes.unhealthyDataL1.length === 3
      ) {
        await restartIndividualCluster(ssmClient, event, logsNames.dl1LogName, LAYERS.DATA_L1, referenceSourceNode)
      } else {
        unhealthyNodes.push(...metagraphRestartType.unhealthyNodes.unhealthyDataL1)
      }

      for (const node of unhealthyNodes) {
        const logName = node.layer === LAYERS.L0 ? logsNames.l0LogName : node.layer === LAYERS.CURRENCY_L1 ? logsNames.cl1LogName : logsNames.dl1LogName
        await restartIndividualNode(ssmClient, event, logName, node, referenceSourceNode)
      }

      const nodesIpsWithPorts = unhealthyNodes.map(node => `${node.ip}:${node.port}`)
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
        statusCode: 200,
        body: JSON.stringify(RESTART_REASONS.UNHEALTHY_CLUSTER),
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify('Finished cluster restart'),
    }

  } catch (e) {
    await createMetagraphRestartFailureAlert(ssmClient, event, e.message, 'Unknow reason')
    throw e
  }
}
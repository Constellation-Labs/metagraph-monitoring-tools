import { SSMClient } from '@aws-sdk/client-ssm'
import moment from 'moment'
import {
  getLastMetagraphInfo,
  killCurrentProcesses,
  printSeparatorWithMessage,
  checkIfAllNodesAreReady,
  sleep,
  getAllEC2NodesInstances,
  deleteSnapshotNotSyncToGL0,
  getUnhealthyClusters
} from './src/shared/index.js'
import { restartL0Nodes } from './src/metagraph-l0/index.js'
import { restartCurrencyL1Nodes } from './src/currency-l1/index.js'
import { restartDataL1Nodes } from './src/data-l1/index.js'
import { createMetagraphRestartSuccessfullyAlert, createMetagraphRestartFailureAlert } from './src/services/opsgenie_service.js'
import { LAYERS, VALID_NETWORKS, RESTART_REASONS } from './src/utils/types.js'

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

const restartNodes = async (ssmClient, event, { l0LogName, cl1LogName, dl1LogName }) => {
  const allEC2NodesIntances = getAllEC2NodesInstances(event)

  printSeparatorWithMessage('Killing current processes on nodes')
  await killCurrentProcesses(ssmClient, event, allEC2NodesIntances)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('Deleting snapshots not sent to GL0 on Metagraph')
  await deleteSnapshotNotSyncToGL0(ssmClient, event, allEC2NodesIntances)
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('METAGRAPH L0')
  const nodeId = await restartL0Nodes(ssmClient, event, l0LogName)
  printSeparatorWithMessage('Finished')

  if (event.metagraph.include_currency_l1_layer) {
    printSeparatorWithMessage('CURRENCY L1')
    await restartCurrencyL1Nodes(ssmClient, event, nodeId, cl1LogName)
    printSeparatorWithMessage('Finished')
  }

  if (event.metagraph.include_data_l1_layer) {
    printSeparatorWithMessage('DATA L1')
    await restartDataL1Nodes(ssmClient, event, nodeId, dl1LogName)
    printSeparatorWithMessage('Finished')
  }
}

const validateIfAllNodesAreReady = async (event) => {
  const promises = []
  promises.push(checkIfAllNodesAreReady(event, LAYERS.L0))

  if (event.include_currency_l1_layer) {
    promises.push(checkIfAllNodesAreReady(event, LAYERS.CURRENCY_L1))
  }

  if (event.include_data_l1_layer) {
    promises.push(checkIfAllNodesAreReady(event, LAYERS.DATA_L1))
  }

  await Promise.all(promises)
}

const checkIfNewSnapshotsAreProducedAfterRestart = async (event) => {
  printSeparatorWithMessage("CHECKING IF NEW SNAPSHOTS WERE PRODUCED")
  console.log("Waiting 30s ...")
  await sleep(30000)
  const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)

  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff > 4) {
    throw Error("Snapshots keep not being produced even after restarting, take a look at the instances")
  }

  printSeparatorWithMessage("New snapshots were produced")
}

const shouldRestartMetagraph = async (event, lastSnapshotTimestamp) => {
  if (event.force_metagraph_restart) {
    console.log('Force metagraph restart provided, restarting')
    return {
      should_restart: true,
      reason: RESTART_REASONS.FORCE_METAGRAPH_RESTART
    }
  }

  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff > 4) {
    return {
      should_restart: true,
      reason: RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS
    };
  }

  const unhealthyClusters = await getUnhealthyClusters(event)
  if (unhealthyClusters.length > 0) {
    console.log(`Unhealthy clusters: ${unhealthyClusters}`)
    return {
      should_restart: true,
      reason: RESTART_REASONS.UNHEALTHY_CLUSTER
    }
  }

  return {
    should_restart: false,
    reason: ''
  }
}

export const handler = async (event) => {
  const ssmClient = new SSMClient({ region: event.aws.region });

  if (!VALID_NETWORKS.includes(event.network.name)) {
    throw Error(`Network should be one of the following: ${JSON.stringify(VALID_NETWORKS)}`)
  }

  let shouldRestart = null
  try {
    const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)

    shouldRestart = await shouldRestartMetagraph(event, lastSnapshotTimestamp)
    if (!shouldRestart.should_restart) {
      return {
        statusCode: 200,
        body: JSON.stringify('Metagraph healthy, ignoring restart!'),
      };
    }

    printSeparatorWithMessage('STARTING THE RESTART')

    const logsNames = getLogsNames();

    // await restartNodes(ssmClient, event, logsNames)

    // await validateIfAllNodesAreReady(event)

    // await checkIfNewSnapshotsAreProducedAfterRestart(event)

    await createMetagraphRestartSuccessfullyAlert(ssmClient, event, logsNames, `Metagraph need to be restarted: ${shouldRestart.reason}`)

    printSeparatorWithMessage('FINISHED THE RESTART')

    return {
      statusCode: 200,
      body: JSON.stringify('Finished cluster restart'),
    };

  } catch (e) {
    await createMetagraphRestartFailureAlert(ssmClient, event, e.message, shouldRestart ? shouldRestart.reason : 'Unknow reason')
    throw e
  }
};
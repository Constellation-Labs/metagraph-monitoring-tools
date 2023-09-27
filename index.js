import { SSMClient } from '@aws-sdk/client-ssm'
import moment from 'moment'
import { getDiffBetweenLastMetagraphSnapshotAndNow, killCurrentProcesses, printSeparatorWithMessage, checkIfAllNodesAreReady, sleep } from './src/shared/index.js'
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

const restartNodes = async (ssmClient, event, logsNames) => {
  printSeparatorWithMessage('Killing current processes on nodes')
  console.log('Killing current processes on nodes')
  await killCurrentProcesses(ssmClient, event, [
    event.ec2_instance_1_id,
    event.ec2_instance_2_id,
    event.ec2_instance_3_id
  ])
  printSeparatorWithMessage('Finished')

  printSeparatorWithMessage('METAGRAPH L0')

  const nodeId = await restartL0Nodes(ssmClient, event, logsNames.l0LogName)
  printSeparatorWithMessage('Finished')

  if (event.include_currency_l1_layer) {
    printSeparatorWithMessage('CURRENCY L1')
    await restartCurrencyL1Nodes(ssmClient, event, nodeId, logsNames.cl1LogName)
    printSeparatorWithMessage('Finished')
  }

  if (event.include_data_l1_layer) {
    printSeparatorWithMessage('DATA L1')
    await restartDataL1Nodes(ssmClient, event, nodeId, logsNames.dl1LogName)
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
  console.log("Waiting 60s ...")
  await sleep(60000)
  const diffBetweenLastMetagraphSnapshotAndNowAfterRestart = getDiffBetweenLastMetagraphSnapshotAndNow(event.network, event.metagraph_id)

  if (diffBetweenLastMetagraphSnapshotAndNowAfterRestart > 4) {
    throw Error("Snapshots keep not being produced even after restarting, take a look at the instances")
  }

  printSeparatorWithMessage("New snapshots were produced")
}

export const handler = async (event) => {
  const ssmClient = new SSMClient({ region: event.region });

  try {
    const { network, metagraph_id } = event
    if (!network || !metagraph_id) {
      throw Error("network and metagraph_id are required.")
    }

    if (!VALID_NETWORKS.includes(network)) {
      throw Error(`Network should be one of the following: ${JSON.stringify(VALID_NETWORKS)}`)
    }

    const { ec2_instance_1_ip, ec2_instance_2_ip, ec2_instance_3_ip } = event;
    if (!ec2_instance_1_ip || !ec2_instance_2_ip || !ec2_instance_3_ip) {
      throw Error("All 3 ec2 instances IPs are required")
    }

    const { ec2_instance_1_id, ec2_instance_2_id, ec2_instance_3_id } = event;
    if (!ec2_instance_1_id || !ec2_instance_2_id || !ec2_instance_3_id) {
      throw Error("All 3 ec2 instances IDs are required")
    }

    const diffBetweenLastMetagraphSnapshotAndNow = await getDiffBetweenLastMetagraphSnapshotAndNow(network, metagraph_id)
    if (diffBetweenLastMetagraphSnapshotAndNow < 4) {
      return {
        statusCode: 200,
        body: JSON.stringify('Metagraph producing snapshots correctly, skipping.'),
      };
    }

    printSeparatorWithMessage('STARTING THE RESTART')

    const logsNames = getLogsNames();

    await restartNodes(ssmClient, event, logsNames)

    await validateIfAllNodesAreReady(event)

    await checkIfNewSnapshotsAreProducedAfterRestart(event)

    await createMetagraphRestartSuccessfullyAlert(ssmClient, event, logsNames, RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS)

    printSeparatorWithMessage('FINISHED THE RESTART')

    return {
      statusCode: 200,
      body: JSON.stringify('Finished cluster restart'),
    };

  } catch (e) {
    await createMetagraphRestartFailureAlert(ssmClient, event, e.message, RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS)
    throw e
  }
};
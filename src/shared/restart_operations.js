import moment from 'moment'
import { LAYERS, NUMBER_OF_SNAPSHOTS_TO_MOVE_SINCE_LAST_ON_BE } from '../utils/types.js'
import { sendCommand } from '../external/aws/ssm.js'
import { sleep } from './shared.js'
import { getLastMetagraphInfo } from './get_metagraph_info.js'

const _movingSnapshotsNotSyncToGL0 = async (ssmClient, event, ec2InstancesIds) => {
  const { file_system } = event.metagraph
  const { lastSnapshotOrdinal } = await getLastMetagraphInfo(event)
  const initialSnapshotToRemove = lastSnapshotOrdinal
  const finalSnapshotToRemove = initialSnapshotToRemove + NUMBER_OF_SNAPSHOTS_TO_MOVE_SINCE_LAST_ON_BE

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

  console.log(`Moving incremental snapshots on data/incremental_snapshot to data/${bkpDirectoryName} between: ${initialSnapshotToRemove} - ${finalSnapshotToRemove}`)
  const commands = [
    `cd ${file_system.base_metagraph_l0_directory}`,
    `./mv_snapshots.sh ${initialSnapshotToRemove} ${finalSnapshotToRemove}`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)
  console.log(`Finishing moving the snapshots`)
}

const killCurrentExecution = async (ssmClient, event, layer, ec2InstancesIds) => {
  const {
    metagraph_l0_public_port,
    currency_l1_public_port,
    data_l1_public_port,
  } = event.metagraph.ports

  console.log(`Stopping ${layer} on ${JSON.stringify(ec2InstancesIds)}`)
  
  if (layer === LAYERS.L0) {
    const commands = [`fuser -k ${metagraph_l0_public_port}/tcp`]
    await sendCommand(ssmClient, commands, ec2InstancesIds)
    await _movingSnapshotsNotSyncToGL0(ssmClient, event, ec2InstancesIds)
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

const joinNodeToCluster = async (ssmClient, event, layer, nodeInformation, ec2InstancesIds) => {
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

const saveLogs = async (ssmClient, event, logName, layer, ec2InstancesIds) => {
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
    `zip -r ${logName} logs/app.log`,
    `mv ${logName} ../restart_logs`,
    `rm -r logs`
  ]

  await sendCommand(ssmClient, commands, ec2InstancesIds)

  console.log('Waiting 10s to finish the compression...')
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

const groupBy = function (xs, key) {
  return xs.reduce(function (rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
};

export {
  killCurrentExecution,
  joinNodeToCluster,
  saveLogs,
  getLogsNames,
  groupBy
}
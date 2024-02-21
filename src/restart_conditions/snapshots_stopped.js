import moment from "moment"
import { getLastMetagraphInfo } from "../shared/get_metagraph_info.js"
import { DYNAMO_RESTART_TYPES, MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS, RESTART_REASONS } from "../utils/types.js"

const checkIfSnapshotsStopped = async (
  event
) => {
  const { lastSnapshotTimestamp } = await getLastMetagraphInfo(event)
  const lastSnapshotTimestampDiff = moment.utc().diff(lastSnapshotTimestamp, 'minutes')
  if (lastSnapshotTimestampDiff <= MAX_MINUTES_WITHOUT_NEW_SNAPSHOTS) {
    return null
  }

  return {
    restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
    reason: RESTART_REASONS.STOP_PRODUCING_SNAPSHOTS,
    unhealthyNodes: {}
  }
}

export {
  checkIfSnapshotsStopped
}
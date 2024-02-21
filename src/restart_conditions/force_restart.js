import { DYNAMO_RESTART_TYPES, RESTART_REASONS } from "../utils/types.js"

const checkIfForceRestartIsProvided = async (
  event
) => {
  if (!event.force_metagraph_restart) {
    return null
  }

  return {
    restartType: DYNAMO_RESTART_TYPES.FULL_CLUSTER,
    reason: RESTART_REASONS.FORCE_METAGRAPH_RESTART,
    unhealthyNodes: {}
  }
}

export {
  checkIfForceRestartIsProvided
}
import { getInformationToJoinNode } from "../shared/get_metagraph_info.js"
import { LAYERS } from "../utils/types.js"
import { startCurrencyL1Nodes, startDataL1Nodes } from "./full_cluster.js"

const restartIndividualCluster = async (
  ssmClient,
  event,
  logName,
  layer,
  referenceSourceNode
) => {
  const { nodeId } = await getInformationToJoinNode(event, LAYERS.L0)

  if (layer === LAYERS.CURRENCY_L1) {
    await startCurrencyL1Nodes(ssmClient, event, logName, nodeId, referenceSourceNode)
  }
  if (layer === LAYERS.DATA_L1) {
    await startDataL1Nodes(ssmClient, event, logName, nodeId, referenceSourceNode)
  }
}

export {
  restartIndividualCluster
}
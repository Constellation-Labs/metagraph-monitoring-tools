import AWS from 'aws-sdk'
import moment from 'moment'
import {
  DATE_FORMAT,
  DYNAMO_RESTART_STATE,
  DYNAMO_DB_TABLE_AUTO_RESTART
} from '../../utils/types.js'

const dynamodb = new AWS.DynamoDB()

const upsertMetagraphRestart = async (metagraphId, state, restartType, restartReason, referenceNodeIp, individualNodesIpsWithPorts) => {
  const item = {
    TableName: DYNAMO_DB_TABLE_AUTO_RESTART,
    Item: {
      id: { S: metagraphId },
      state: { S: state },
      type: { S: 'metagraph' },
      restart_type: { S: restartType || '' },
      restart_reason: { S: restartReason || ''},
      reference_node_ip: { S: referenceNodeIp || '' },
      individual_nodes_ips_with_ports: { S: individualNodesIpsWithPorts || '' },
      updated_at: { S: moment.utc().format(DATE_FORMAT) },
    },
  }

  const metagraphRestart = await dynamodb.putItem(item).promise()
  const { error } = metagraphRestart.$response
  if (error) {
    throw error
  }

  return await getMetagraphRestartOrCreateNew(metagraphId)
}

const getMetagraphRestartOrCreateNew = async (metagraphId) => {
  console.log(`Starting to get metagraph restart or create new`)
  const params = {
    TableName: DYNAMO_DB_TABLE_AUTO_RESTART,
    Key: {
      id: { S: `${metagraphId}` },
    },
  }


  const metagraphRestart = await dynamodb.getItem(params).promise()
  const { error, data } = metagraphRestart.$response

  if (error) {
    console.error(`Error when trying to get information from dynamo: ${err}`)
    throw error
  }

  const { Item } = data
  if (!Item) {
    console.log("Could not get metagraph restart, creating new restart of metagraph...")
    const updatedAt = moment.utc().format(DATE_FORMAT)

    return upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATE.NEW, updatedAt)
  }

  const state = Item.state.S
  const updatedAt = Item.updated_at?.S
  const restartType = Item.restart_type?.S
  const restartReason = Item.restart_reason?.S
  const referenceNodeIp = Item.reference_node_ip?.S
  const individualNodesIpsWithPorts = Item.individual_nodes_ips_with_ports?.S

  const body = {
    state,
    updatedAt,
    restartType,
    restartReason,
    referenceNodeIp,
    individualNodesIpsWithPorts
  }

  console.log(`Metagraph restart on Dynamo: ${JSON.stringify(body)}`)

  return body
}

const deleteMetagraphRestart = async (metagraphId) => {
  const params = {
    TableName: DYNAMO_DB_TABLE_AUTO_RESTART,
    Key: {
      id: { S: `${metagraphId}` },
    },
  }


  const response = await dynamodb.deleteItem(params).promise()
  const { error, data } = response.$response

  if (error) {
    console.error('Error deleting item: ', error)
    throw err
  } else {
    console.log('Item deleted successfully: ', data)
  }

}

export {
  getMetagraphRestartOrCreateNew,
  upsertMetagraphRestart,
  deleteMetagraphRestart
}
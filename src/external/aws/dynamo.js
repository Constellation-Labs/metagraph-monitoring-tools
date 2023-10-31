import AWS from 'aws-sdk';
import moment from 'moment';
import {
  DATE_FORMAT,
  DYNAMO_RESTART_STATUS,
  DYNAMO_DB_TABLE_METAGRAPH_AUTO_RESTART
} from '../../utils/types.js'

const dynamodb = new AWS.DynamoDB();

const upsertMetagraphRestart = async (metagraphId, status, updatedAt) => {
  const item = {
    TableName: DYNAMO_DB_TABLE_METAGRAPH_AUTO_RESTART,
    Item: {
      id: { S: metagraphId },
      status: { S: status },
      updated_at: { S: updatedAt || moment.utc().format(DATE_FORMAT) },
    },
  };

  const metagraphRestart = await dynamodb.putItem(item).promise();
  const { error } = metagraphRestart.$response
  if (error) {
    throw error
  }

  return await getMetagraphRestartOrCreateNew(metagraphId)
}

const getMetagraphRestartOrCreateNew = async (metagraphId) => {
  const params = {
    TableName: DYNAMO_DB_TABLE_METAGRAPH_AUTO_RESTART,
    Key: {
      id: { S: `${metagraphId}` },
    },
  };


  const metagraphRestart = await dynamodb.getItem(params).promise();
  const { error, data } = metagraphRestart.$response;

  if (error) {
    console.error(`Error when trying to get information from dynamo: ${err}`)
    throw error
  }

  const { Item } = data
  if (!Item) {
    console.log("Could not get status, creating new restart of metagraph...")
    const updatedAt = moment.utc().format(DATE_FORMAT)

    return upsertMetagraphRestart(metagraphId, DYNAMO_RESTART_STATUS.NEW, updatedAt)
  }

  const status = Item.status.S
  const updatedAt = Item.updated_at.S
  return {
    status,
    updatedAt
  }

}

const deleteMetagraphRestart = async (metagraphId) => {
  const params = {
    TableName: DYNAMO_DB_TABLE_METAGRAPH_AUTO_RESTART,
    Key: {
      id: { S: `${metagraphId}` },
    },
  };


  const response = await dynamodb.deleteItem(params).promise();
  const { error, data } = response.$response

  if (error) {
    console.error('Error deleting item: ', error);
    throw err
  } else {
    console.log('Item deleted successfully: ', data);
  }

}

export {
  getMetagraphRestartOrCreateNew,
  upsertMetagraphRestart,
  deleteMetagraphRestart
}
import { SSMClient } from '@aws-sdk/client-ssm'
import { getDiffBetweenLastMetagraphSnapshotAndNow, killCurrentProcesses, printSeparator } from './shared.js'
import { restartL0Nodes } from './metagraph-l0.js'
import { restartCurrencyL1Nodes } from './currency-l1.js'
import { restartDataL1Nodes } from './data-l1.js'

const VALID_NETWORKS = ['mainnet', 'integrationnet', 'testnet']

/** This is one lambda function used to monitor a metagraph and restart if we stop
 * producing snapshots. It could be improved in other cases where a restart is needed.
 * To run this function you should call providing the parameters described in: event.json.
 * Some parameters are required and should be populated as SSM Parameters (on Parameters Store).
 * We have one script in `scripts/create-ssm-params.sh` that shows how to create the needed parameters.
 * Remember to create a new ROLE for the lambda function. This role should contain the following policies: 
 * AmazonEventBridgeFullAccess, AWSLambda_FullAccess, AWSLambdaBasicExecutionRole, and we need to create a custom policy with the following permissions:
 *  {
 *    "Version": "2012-10-17",
 *    "Statement": [
 *        {
 *            "Sid": "VisualEditor0",
 *            "Effect": "Allow",
 *            "Action": [
 *                "ssm:SendCommand",
 *                "ssm:CreateAssociation",
 *                "ssm:GetParameter"
 *            ],
 *            "Resource": "*"
 *        }
 *    ]
 *  }

 * We also access the instances using SSM, so be sure that your instances have the SSM client setup
*/
export const handler = async (event) => {
  const { network, metagraph_id, region } = event
  if (!network || !metagraph_id || !region) {
    throw Error("region, network and metagraph_id are required.")
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

  const ssmClient = new SSMClient({ region });
  console.log("\n\n############### STARTING THE RESTART ###################\n\n")
  
  printSeparator()
  console.log('Killing current processes on nodes')
  await killCurrentProcesses(ssmClient, event, [
    ec2_instance_1_id,
    ec2_instance_2_id,
    ec2_instance_3_id
  ])
  console.log('Killing current processes on nodes finished')
  printSeparator()

  console.log("################ METAGRAPH L0 ##################")
  const nodeId = await restartL0Nodes(ssmClient, event)
  console.log("################ FINISHED METAGRAPH L0 ##################\n\n\n\n")

  console.log("################ CURRENCY L1 ##################")
  await restartCurrencyL1Nodes(ssmClient, event, nodeId)
  console.log("################ FINISHED CURRENCY L1 ################## \n\n\n\n")

  console.log("################ DATA L1 ##################")
  await restartDataL1Nodes(ssmClient, event, nodeId)
  console.log("################ FINISHED DATA L1 ################## \n\n\n\n")

  const response = {
    statusCode: 200,
    body: JSON.stringify('Finished cluster restart'),
  };

  return response;
};
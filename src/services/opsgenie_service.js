import axios from 'axios';
import { getSSMParameter, printSeparatorWithMessage } from '../shared/index.js'

const OPSGENIE_ALERT_URL = "https://api.opsgenie.com/v2/alerts"

const buildSuccessfullyRestartAlertBody = (event, logNames, restartReason) => {
  return {
    message: `${event.metagraph_name} Metagraph Restarted`,
    description: `
    The ${event.metagraph_name} Metagraph restarted succesfully on ${event.network}.
    Restart reason: ${restartReason}
    
    You can check the metagraph nodes on these URLs:
    ML0 - 1: http://${event.ec2_instance_1_ip}:${event.metagraph_l0_public_port}/node/info
    ML0 - 2: http://${event.ec2_instance_2_ip}:${event.metagraph_l0_public_port}/node/info
    ML0 - 3: http://${event.ec2_instance_3_ip}:${event.metagraph_l0_public_port}/node/info

    ${event.include_currency_l1_layer ?
      `
    CL1 - 1: http://${event.ec2_instance_1_ip}:${event.currency_l1_public_port}/node/info
    CL1 - 2: http://${event.ec2_instance_2_ip}:${event.currency_l1_public_port}/node/info
    CL1 - 3: http://${event.ec2_instance_3_ip}:${event.currency_l1_public_port}/node/info
    `: ''
      }

    ${event.include_data_l1_layer ?
      `
    DL1 - 1: http://${event.ec2_instance_1_ip}:${event.data_l1_public_port}/node/info
    DL1 - 2: http://${event.ec2_instance_2_ip}:${event.data_l1_public_port}/node/info
    DL1 - 3: http://${event.ec2_instance_3_ip}:${event.data_l1_public_port}/node/info
    `: ''
      }

    The following logs were stored in the following directories on EC2 instances:
    /home/ubuntu/code/restart_logs/${logNames.l0LogName}
    ${event.include_currency_l1_layer ? `/home/ubuntu/code/restart_logs/${logNames.cl1LogName}`: ''}
    ${event.include_data_l1_layer ? `/home/ubuntu/code/restart_logs/${logNames.dl1LogName}`: ''}
    
    EC2 instances:
    Instance 1 ID: ${event.ec2_instance_1_id}
    Instance 1 IP: ${event.ec2_instance_1_ip}

    Instance 2 ID: ${event.ec2_instance_2_id}
    Instance 2 IP: ${event.ec2_instance_2_ip}

    Instance 3 ID: ${event.ec2_instance_3_id}
    Instance 3 IP: ${event.ec2_instance_3_ip}
    `,
    actions: ["Metagraph", "Restart"],
    tags: ["Metagraph", "Restart", "Successfully"],
    details: {
      metagraphId: event.metagraph_id,
      network: event.network,
      metagraphName: event.metagraph_name
    },
    entity: "Metagraph",
    priority: "P3"
  }
}

const buildFailureRestartAlertBody = (event, errorMessage, restartReason) => {
  return {
    message: `${event.metagraph_name} Metagraph Failed To Restarted`,
    description: `
    The ${event.metagraph_name} Metagraph failed to restarted on ${event.network}.
    Restart reason: ${restartReason}
    Error message returned: ${errorMessage}
    
    You can check the metagraph nodes on these URLs:
    ML0 - 1: http://${event.ec2_instance_1_ip}:${event.metagraph_l0_public_port}/node/info
    ML0 - 2: http://${event.ec2_instance_2_ip}:${event.metagraph_l0_public_port}/node/info
    ML0 - 3: http://${event.ec2_instance_3_ip}:${event.metagraph_l0_public_port}/node/info

    ${event.include_currency_l1_layer ?
      `
    CL1 - 1: http://${event.ec2_instance_1_ip}:${event.currency_l1_public_port}/node/info
    CL1 - 2: http://${event.ec2_instance_2_ip}:${event.currency_l1_public_port}/node/info
    CL1 - 3: http://${event.ec2_instance_3_ip}:${event.currency_l1_public_port}/node/info
    `: ''
      }

    ${event.include_data_l1_layer ?
      `
    DL1 - 1: http://${event.ec2_instance_1_ip}:${event.data_l1_public_port}/node/info
    DL1 - 2: http://${event.ec2_instance_2_ip}:${event.data_l1_public_port}/node/info
    DL1 - 3: http://${event.ec2_instance_3_ip}:${event.data_l1_public_port}/node/info
    `: ''
      }
    
    EC2 instances:
    Instance 1 ID: ${event.ec2_instance_1_id}
    Instance 1 IP: ${event.ec2_instance_1_ip}

    Instance 2 ID: ${event.ec2_instance_2_id}
    Instance 2 IP: ${event.ec2_instance_2_ip}

    Instance 3 ID: ${event.ec2_instance_3_id}
    Instance 3 IP: ${event.ec2_instance_3_ip}
    `,
    actions: ["Metagraph", "Restart"],
    tags: ["Metagraph", "Restart", "Failure"],
    details: {
      metagraphId: event.metagraph_id,
      network: event.network,
      metagraphName: event.metagraph_name
    },
    entity: "Metagraph",
    priority: "P1"
  }
}

const createRemoteAlert = async (body, opsgenieApiKey) => {
  try {
    await axios.post(OPSGENIE_ALERT_URL, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `GenieKey ${opsgenieApiKey}`
      }
    })
  } catch (e) {
    throw new Error(`Failing when creating remote alert: ${e}`)
  }
}

const createMetagraphRestartSuccessfullyAlert = async (ssmClient, event, logNames, restartReason) => {
  printSeparatorWithMessage("CREATING SUCCESSFULY RESTART ALERT ON OPSGENIE")
  const opsgenieApiKey = await getSSMParameter(ssmClient, '/metagraph-nodes/opsgenie-api-key')
  const alertBody = buildSuccessfullyRestartAlertBody(event, logNames, restartReason)

  await createRemoteAlert(alertBody, opsgenieApiKey)
  printSeparatorWithMessage("Finished")
}

const createMetagraphRestartFailureAlert = async (ssmClient, event, errorMessage, restartReason) => {
  printSeparatorWithMessage("CREATING FAILURE RESTART ALERT ON OPSGENIE")
  const opsgenieApiKey = await getSSMParameter(ssmClient, '/metagraph-nodes/opsgenie-api-key')
  const alertBody = buildFailureRestartAlertBody(event, errorMessage, restartReason)

  await createRemoteAlert(alertBody, opsgenieApiKey)
  printSeparatorWithMessage("Finished")
}

export {
  createMetagraphRestartSuccessfullyAlert,
  createMetagraphRestartFailureAlert
}
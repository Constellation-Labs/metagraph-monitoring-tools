import axios from 'axios';
import { getSSMParameter, printSeparatorWithMessage } from '../shared/index.js'

const OPSGENIE_ALERT_URL = "https://api.opsgenie.com/v2/alerts"

const buildValidatorsLogsURLs = (validators, prefix, port) => {
  const messages = []
  for (const [idx, validator] of validators) {
    messages.push(`${prefix} - ${idx + 1}: http://${validator.ip}:${port}/node/info`)
  }

  return messages.join('\n')
}

const buildValidatorsLogsInstances = (validators) => {
  const messages = []
  for (const [idx, validator] of validators) {
    messages.push(`Instance ${idx + 1} (Validator) ID: ${validator.id}`)
    messages.push(`Instance ${idx + 1} (Validator) IP: ${validator.ip}`)
  }

  return messages.join('\n')
}

const buildSuccessfullyRestartAlertBody = (event, logNames, restartReason) => {
  const { name: metagraphName, id, ports, include_currency_l1_layer, include_data_l1_layer } = event.metagraph
  const { name: networkName } = event.network
  const { genesis, validators } = event.aws.ec2.instances

  return {
    message: `${metagraphName} Metagraph Restarted`,
    description: `
    The ${metagraphName} Metagraph restarted succesfully on ${networkName}.
    Restart reason: ${restartReason}
    
    You can check the metagraph nodes on these URLs:
    ML0 - Genesis: http://${genesis.ip}:${ports.metagraph_l0_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'ML0', ports.metagraph_l0_public_port)}

    ${include_currency_l1_layer ?
        `
    CL1 - Genesis: http://${genesis.ip}:${ports.currency_l1_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'CL1', ports.currency_l1_public_port)}
    `: ''
      }

    ${include_data_l1_layer ?
        `
    DL1 - Genesis: http://${genesis.ip}:${ports.data_l1_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'DL1', ports.data_l1_public_port)}
    `: ''
      }

    The following logs were stored in the following directories on EC2 instances:
    /home/ubuntu/code/restart_logs/${logNames.l0LogName}
    ${include_currency_l1_layer ? `/home/ubuntu/code/restart_logs/${logNames.cl1LogName}` : ''}
    ${include_data_l1_layer ? `/home/ubuntu/code/restart_logs/${logNames.dl1LogName}` : ''}
    
    EC2 instances:
    Instance 1 (Genesis) ID: ${genesis.id}
    Instance 1 (Genesis) IP: ${genesis.ip}
    ${buildValidatorsLogsInstances(validators)}
    `,
    alias: `${id}_successfully_restarted`,
    actions: ["Metagraph", "Restart"],
    tags: ["Metagraph", "Restart", "Successfully"],
    details: {
      metagraphId: id,
      network: networkName,
      metagraphName: metagraphName
    },
    entity: "Metagraph",
    priority: "P3"
  }
}

const buildFailureRestartAlertBody = (event, errorMessage, restartReason) => {
  const { name: metagraphName, id, ports, include_currency_l1_layer, include_data_l1_layer } = event.metagraph
  const { name: networkName } = event.network
  const { genesis, validators } = event.aws.ec2.instances

  return {
    message: `${metagraphName} Metagraph Failed To Restarted`,
    description: `
    The ${metagraphName} Metagraph failed to restarted on ${networkName}.
    Restart reason: ${restartReason}
    Error message returned: ${errorMessage}
    
    You can check the metagraph nodes on these URLs:
    ML0 - Genesis: http://${genesis.ip}:${ports.metagraph_l0_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'ML0', ports.metagraph_l0_public_port)}

    ${include_currency_l1_layer ?
        `
    CL1 - Genesis: http://${genesis.ip}:${ports.currency_l1_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'CL1', ports.currency_l1_public_port)}
    `: ''
      }

    ${include_data_l1_layer ?
        `
    DL1 - Genesis: http://${genesis.ip}:${ports.data_l1_public_port}/node/info
    ${buildValidatorsLogsURLs(validators, 'DL1', ports.data_l1_public_port)}
    `: ''
      }
    
    EC2 instances:
    Instance 1 (Genesis) ID: ${genesis.id}
    Instance 1 (Genesis) IP: ${genesis.ip}
    ${buildValidatorsLogsInstances(validators)}
    `,
    actions: ["Metagraph", "Restart"],
    alias: `${id}_failure_restarted`,
    tags: ["Metagraph", "Restart", "Failure"],
    details: {
      metagraphId: id,
      network: networkName,
      metagraphName: metagraphName
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
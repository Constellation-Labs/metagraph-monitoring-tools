import axios from 'axios'
import { getSSMParameter } from '../../external/aws/ssm.js'
import { OPSGENIE_API_KEY_PATH, VALID_NETWORKS_TAGS_OPSGENIE, DYNAMO_RESTART_TYPES } from '../../utils/types.js'

const OPSGENIE_ALERT_URL = "https://api.opsgenie.com/v2/alerts"

const _buildValidatorsLogsURLs = (
  validators,
  prefix,
  port
) => {
  const messages = []
  for (const validator of validators) {
    messages.push(`${prefix} - ${validator.ip}: http://${validator.ip}:${port}/node/info`)
  }

  return messages.join('\n')
}

const _buildValidatorsLogsInstances = (
  validators
) => {
  const messages = []
  for (const validator of validators) {
    messages.push(`Instance ${validator.ip} (Validator) ID: ${validator.id}`)
    messages.push(`Instance ${validator.ip} (Validator) IP: ${validator.ip}`)
  }

  return messages.join('\n')
}

const _buildStartedRestartAlertBody = (
  event,
  metagraphRestart
) => {
  const { name: metagraphName, id, ports, include_currency_l1_layer, include_data_l1_layer } = event.metagraph
  const { name: networkName } = event.network
  const { genesis, validators } = event.aws.ec2.instances

  return {
    message: `${metagraphName} Metagraph Started a Restart`,
    description: `
    The ${metagraphName} Metagraph started a restart on ${networkName}.
    Restart Type: ${metagraphRestart.restartType}
    Restart reason: ${metagraphRestart.restartReason}
    ${metagraphRestart.restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER ? `Referece Node IP: ${metagraphRestart.referenceNodeIp}` : `Nodes Ips: ${metagraphRestart.individualNodesIpsWithPorts}`}
    
    You can check the metagraph nodes on these URLs:
    ML0 - Genesis: http://${genesis.ip}:${ports.metagraph_l0_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'ML0', ports.metagraph_l0_public_port)}

    ${include_currency_l1_layer ?
        `
    CL1 - Genesis: http://${genesis.ip}:${ports.currency_l1_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'CL1', ports.currency_l1_public_port)}
    `: ''
      }

    ${include_data_l1_layer ?
        `
    DL1 - Genesis: http://${genesis.ip}:${ports.data_l1_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'DL1', ports.data_l1_public_port)}
    `: ''
      }
    
    EC2 instances:
    Instance 1 (Genesis) ID: ${genesis.id}
    Instance 1 (Genesis) IP: ${genesis.ip}
    ${_buildValidatorsLogsInstances(validators)}
    `,
    alias: `${id}_restart`,
    actions: ["Metagraph", "Restart"],
    tags: [VALID_NETWORKS_TAGS_OPSGENIE[networkName]],
    details: {
      metagraphId: id,
      network: networkName,
      metagraphName: metagraphName
    },
    entity: "Metagraph",
    priority: "P3"
  }
}

const _buildFailureRestartAlertBody = (
  event,
  errorMessage,
  metagraphRestart
) => {
  const { name: metagraphName, id, ports, include_currency_l1_layer, include_data_l1_layer } = event.metagraph
  const { name: networkName } = event.network
  const { genesis, validators } = event.aws.ec2.instances

  return {
    message: `${metagraphName} Metagraph Failed to Restart`,
    description: `
    The ${metagraphName} Metagraph failed to restart on ${networkName}.
    Restart Type: ${metagraphRestart.restartType}
    Restart Reason: ${metagraphRestart.restartReason}
    ${metagraphRestart.restartType === DYNAMO_RESTART_TYPES.FULL_CLUSTER ? `Referece Node IP: ${metagraphRestart.referenceNodeIp}` : `Nodes Ips: ${metagraphRestart.individualNodesIpsWithPorts}`}
    Error message returned: ${errorMessage}
    
    You can check the metagraph nodes on these URLs:
    ML0 - Genesis: http://${genesis.ip}:${ports.metagraph_l0_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'ML0', ports.metagraph_l0_public_port)}

    ${include_currency_l1_layer ?
        `
    CL1 - Genesis: http://${genesis.ip}:${ports.currency_l1_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'CL1', ports.currency_l1_public_port)}
    `: ''
      }

    ${include_data_l1_layer ?
        `
    DL1 - Genesis: http://${genesis.ip}:${ports.data_l1_public_port}/node/info
    ${_buildValidatorsLogsURLs(validators, 'DL1', ports.data_l1_public_port)}
    `: ''
      }
    
    EC2 instances:
    Instance 1 (Genesis) ID: ${genesis.id}
    Instance 1 (Genesis) IP: ${genesis.ip}
    ${_buildValidatorsLogsInstances(validators)}
    `,
    actions: ["Metagraph", "Restart"],
    alias: `${id}_failure_restarted`,
    tags: [VALID_NETWORKS_TAGS_OPSGENIE[networkName]],
    details: {
      metagraphId: id,
      network: networkName,
      metagraphName: metagraphName
    },
    entity: "Metagraph",
    priority: "P1"
  }
}

const _createRemoteAlert = async (
  body,
  opsgenieApiKey
) => {
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

const _closeRemoteAlert = async (
  alias,
  opsgenieApiKey
) => {
  const body = {
    "user": "Monitoring Script",
    "source": "AWS Lambda",
    "note": "Action executed via Alert API"
  }
  try {
    await axios.post(`${OPSGENIE_ALERT_URL}/${alias}/close?identifierType=alias`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `GenieKey ${opsgenieApiKey}`
      }
    })
  } catch (e) {
    throw Error(`Failing when creating remote alert: ${e}`)
  }
}

const createMetagraphRestartStartedAlert = async (
  ssmClient,
  event,
  metagraphRestart
) => {
  if (!event.enable_opsgenie_alerts) {
    console.log('Opsgenie not enabled')
    return
  }

  console.log(`Creating Metagraph Restart Started Alert`)
  const opsgenieApiKey = await getSSMParameter(ssmClient, OPSGENIE_API_KEY_PATH)
  const alertBody = _buildStartedRestartAlertBody(event, metagraphRestart)

  await _createRemoteAlert(alertBody, opsgenieApiKey)
  console.log(`Alert created`)
}

const closeCurrentMetagraphRestartAlert = async (
  ssmClient,
  event
) => {
  if (!event.enable_opsgenie_alerts) {
    console.log('Opsgenie not enabled')
    return
  }
  console.log(`Closing metagraph restart alert`)
  const opsgenieApiKey = await getSSMParameter(ssmClient, OPSGENIE_API_KEY_PATH)
  const alias = `${event.metagraph.id}_restart`

  await _closeRemoteAlert(alias, opsgenieApiKey)
  console.log(`Alert close`)
}

const closeFailedMetagraphRestartAlert = async (
  ssmClient,
  event
) => {
  if (!event.enable_opsgenie_alerts) {
    console.log('Opsgenie not enabled')
    return
  }
  console.log(`Closing failed metagraph restart alert`)
  const opsgenieApiKey = await getSSMParameter(ssmClient, OPSGENIE_API_KEY_PATH)
  const alias = `${event.metagraph.id}_failure_restarted`

  await _closeRemoteAlert(alias, opsgenieApiKey)
  console.log(`Alert close`)
}

const createMetagraphRestartFailureAlert = async (
  ssmClient,
  event,
  errorMessage,
  metagraphRestart
) => {
  if (!event.enable_opsgenie_alerts) {
    console.log('Opsgenie not enabled')
    return
  }
  console.log(`Creating Metagraph Restart Failure Alert`)
  const opsgenieApiKey = await getSSMParameter(ssmClient, OPSGENIE_API_KEY_PATH)
  const alertBody = _buildFailureRestartAlertBody(event, errorMessage, metagraphRestart)

  await _createRemoteAlert(alertBody, opsgenieApiKey)
  console.log(`Alert created`)
}

export {
  createMetagraphRestartStartedAlert,
  createMetagraphRestartFailureAlert,
  closeCurrentMetagraphRestartAlert,
  closeFailedMetagraphRestartAlert
}
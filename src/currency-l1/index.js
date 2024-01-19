import { getKeys, sendCommand } from '../external/aws/ssm.js'
import { saveLogs, killCurrentExecution } from '../shared/index.js'
import { buildSeedlistInformation } from '../utils/build_seedlist_url.js'
import { KEY_LAYERS, LAYERS, SEEDLIST_LAYERS } from '../utils/types.js'

const startInitialValidatorNodeCurrencyL1 = async (ssmClient, event, logName, mL0NodeId, rollbackNode, referenceSourceNode, shouldKillCurrentExecution = true) => {
  if (shouldKillCurrentExecution) {
    await killCurrentExecution(ssmClient, event, LAYERS.CURRENCY_L1, [rollbackNode.id])
  }

  await saveLogs(ssmClient, event, logName, LAYERS.CURRENCY_L1, [rollbackNode.id])
  const cl1Keys = await getKeys(ssmClient, rollbackNode.id, KEY_LAYERS.CURRENCY_L1)

  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_currency_l1_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${cl1Keys.keyStore}"`,
    `export CL_KEYALIAS="${cl1Keys.keyAlias}"`,
    `export CL_PASSWORD="${cl1Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${ports.currency_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.currency_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.currency_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.aws.ec2.instances.genesis.ip}`,
    `export CL_L0_PEER_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`
  ]

  for (const variable of additional_currency_l1_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const { url, file_name } = buildSeedlistInformation(event, SEEDLIST_LAYERS.CL1)
  const commands = [
    ...envVariables,
    `cd ${file_system.base_currency_l1_directory}`,
    `${url ? `wget -O ${file_name} ${url}` : ''}`,
    `${url ?
      `nohup java -jar currency-l1.jar run-initial-validator --ip ${rollbackNode.ip} --seedlist ${file_name} > node-l1.log 2>&1 &` :
      `nohup java -jar currency-l1.jar run-initial-validator --ip ${rollbackNode.ip} > node-l1.log 2>&1 &`
    }`
  ]

  await sendCommand(ssmClient, commands, [rollbackNode.id])
}

const startValidatorNodeCurrencyL1 = async (ssmClient, event, logName, mL0NodeId, validator, referenceSourceNode, shouldKillCurrentExecution = true) => {
  if (shouldKillCurrentExecution) {
    await killCurrentExecution(ssmClient, event, LAYERS.CURRENCY_L1, [validator.id])
  }

  await saveLogs(ssmClient, event, logName, LAYERS.CURRENCY_L1, [validator.id])
  const validatorKeys = await getKeys(ssmClient, validator.id, KEY_LAYERS.CURRENCY_L1)

  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_currency_l1_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${validatorKeys.keyStore}"`,
    `export CL_KEYALIAS="${validatorKeys.keyAlias}"`,
    `export CL_PASSWORD="${validatorKeys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${ports.currency_l1_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.currency_l1_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.currency_l1_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,

    `export CL_L0_PEER_HTTP_HOST=${event.aws.ec2.instances.genesis.ip}`,
    `export CL_L0_PEER_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_L0_PEER_ID=${mL0NodeId}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_currency_l1_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const { url, file_name } = buildSeedlistInformation(event, SEEDLIST_LAYERS.CL1)
  const commands = [
    ...envVariables,
    `cd ${file_system.base_currency_l1_directory}`,
    `${url ? `wget -O ${file_name} ${url}` : ''}`,
    `${url ?
      `nohup java -jar currency-l1.jar run-validator --ip ${validator.ip} --seedlist ${file_name} > node-l1.log 2>&1 &` :
      `nohup java -jar currency-l1.jar run-validator --ip ${validator.ip} > node-l1.log 2>&1 &`
    }`
  ]

  await sendCommand(ssmClient, commands, [validator.id])
}

export { startInitialValidatorNodeCurrencyL1, startValidatorNodeCurrencyL1 }
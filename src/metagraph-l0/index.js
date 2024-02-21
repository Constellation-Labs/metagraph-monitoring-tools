import { getKeys, sendCommand } from '../external/aws/ssm.js'
import { killCurrentExecution, saveLogs } from '../shared/restart_operations.js'
import { buildSeedlistInformation } from '../utils/build_seedlist_url.js'
import { KEY_LAYERS, LAYERS, SEEDLIST_LAYERS } from '../utils/types.js'

const startRollbackNodeL0 = async (
  ssmClient,
  event,
  rollbackNode,
  referenceSourceNode,
  logName,
  shouldKillCurrentExecution = true
) => {
  if (shouldKillCurrentExecution) {
    await killCurrentExecution(ssmClient, event, LAYERS.L0, [rollbackNode.id])
  }

  await saveLogs(ssmClient, event, logName, LAYERS.L0, [rollbackNode.id])
  const l0Keys = await getKeys(ssmClient, rollbackNode.id, KEY_LAYERS.L0)

  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_metagraph_l0_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${l0Keys.keyStore}"`,
    `export CL_KEYALIAS="${l0Keys.keyAlias}"`,
    `export CL_PASSWORD="${l0Keys.password}"`,

    `export CL_PUBLIC_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.metagraph_l0_cli_port}`,

    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,

    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_metagraph_l0_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const { url, file_name } = buildSeedlistInformation(event, SEEDLIST_LAYERS.ML0)
  const commands = [
    ...envVariables,
    `cd ${file_system.base_metagraph_l0_directory}`,
    `${url ? `wget -O ${file_name} ${url}` : ''}`,
    `${url ?
      `nohup java -jar metagraph-l0.jar run-rollback --ip ${event.aws.ec2.instances.genesis.ip} --seedlist ${file_name} > node-l0.log 2>&1 &` :
      `nohup java -jar metagraph-l0.jar run-rollback --ip ${event.aws.ec2.instances.genesis.ip} > node-l0.log 2>&1 &`
    }`
  ]

  await sendCommand(ssmClient, commands, [rollbackNode.id])
}

const startValidatorNodeL0 = async (
  ssmClient,
  event,
  logName,
  validator,
  referenceSourceNode,
  shouldKillCurrentExecution = true
) => {
  if (shouldKillCurrentExecution) {
    await killCurrentExecution(ssmClient, event, LAYERS.L0, [validator.id])
  }

  await saveLogs(ssmClient, event, logName, LAYERS.L0, [validator.id])
  const validatorKeys = await getKeys(ssmClient, validator.id, KEY_LAYERS.L0)

  const { ports } = event.metagraph
  const {
    id,
    required_env_variables,
    additional_metagraph_l0_env_variables,
    file_system
  } = event.metagraph

  const envVariables = [
    `export CL_KEYSTORE="${validatorKeys.keyStore}"`,
    `export CL_KEYALIAS="${validatorKeys.keyAlias}"`,
    `export CL_PASSWORD="${validatorKeys.password}"`,
    `export CL_PUBLIC_HTTP_PORT=${ports.metagraph_l0_public_port}`,
    `export CL_P2P_HTTP_PORT=${ports.metagraph_l0_p2p_port}`,
    `export CL_CLI_HTTP_PORT=${ports.metagraph_l0_cli_port}`,
    `export CL_GLOBAL_L0_PEER_HTTP_HOST=${referenceSourceNode.ip}`,
    `export CL_GLOBAL_L0_PEER_HTTP_PORT=${referenceSourceNode.port}`,
    `export CL_GLOBAL_L0_PEER_ID=${referenceSourceNode.id}`,
    `export CL_L0_TOKEN_IDENTIFIER=${id}`,
    `export CL_APP_ENV=${required_env_variables.cl_app_env}`,
    `export CL_COLLATERAL=${required_env_variables.cl_collateral}`,
  ]

  for (const variable of additional_metagraph_l0_env_variables || []) {
    envVariables.push(`export ${variable}`)
  }

  const { url, file_name } = buildSeedlistInformation(event, SEEDLIST_LAYERS.ML0)
  const commands = [
    ...envVariables,
    `cd ${file_system.base_metagraph_l0_directory}`,
    `${url ? `wget -O ${file_name} ${url}` : ''}`,
    `${url ?
      `nohup java -jar metagraph-l0.jar run-validator --ip ${validator.ip} --seedlist ${file_name} > node-l0.log 2>&1 &` :
      `nohup java -jar metagraph-l0.jar run-validator --ip ${validator.ip} > node-l0.log 2>&1 &`
    }`
  ]

  await sendCommand(ssmClient, commands, [validator.id])
}

export {
  startRollbackNodeL0,
  startValidatorNodeL0
}
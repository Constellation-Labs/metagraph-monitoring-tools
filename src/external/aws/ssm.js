import { SendCommandCommand, GetParameterCommand } from '@aws-sdk/client-ssm'

const sendCommand = async (
  ssmClient,
  commands,
  ec2InstancesIds
) => {
  const params = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: ec2InstancesIds,
    Parameters: {
      commands
    },
  }

  try {
    const commandResponse = await ssmClient.send(new SendCommandCommand(params))
    console.log("Command sent successfully. Command ID:", commandResponse.Command.CommandId)
  } catch (error) {
    console.error("Error sending command:", error)
  }
}

const getSSMParameter = async (
  ssmClient,
  parameterName
) => {
  console.log(`Starting to get parameter: ${parameterName} on SSM (Parameter Store)`)
  const getParameterCommand = new GetParameterCommand({
    Name: parameterName,
  })

  const parameter = await ssmClient.send(getParameterCommand)
  return parameter.Parameter.Value
}

const getKeys = async (
  ssmClient,
  instanceId,
  layer
) => {
  const keyStore = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/keystore`)
  const keyAlias = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/keyalias`)
  const password = await getSSMParameter(ssmClient, `/metagraph-nodes/${instanceId}/${layer}/password`)

  return { keyStore, keyAlias, password }
}

export {
  sendCommand,
  getSSMParameter,
  getKeys
}
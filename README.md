Metagraph Monitoring Tools
========================

This project has been developed to monitor metagraphs and initiate a restart if necessary. We have a Lambda function dedicated to monitoring a metagraph. This monitoring can trigger two types of restarts: **FULL_CLUSTER** or **INDIVIDUAL_NODES**.

### Full Cluster Restart

This restart will involve restarting all the nodes and layers. In other words, it will completely restart the metagraph (3ml0, 3cl1, and 3dl1). We always aim to avoid a complete restart of the metagraph, but there are certain conditions that can trigger this type of restart, such as:

-   Snapshots no longer being produced.
-   Snapshots not reaching the global networks (MainNet, IntegrationNet).
-   All nodes from layer 0 down (which would cause the snapshots to stop being created).
-   All nodes from all layers down.

### Individual Nodes Restart

This restart will involve restarting nodes individually. This means that we won't need to restart the full cluster but only specific nodes in certain layers. For example, if node 2 in layer cl1 is down, we can restart only the process of node 2 in layer cl1 instead of the entire cluster or node. The conditions that can trigger this type of restart are:

-   Unhealthy node in layer ml0
-   Unhealthy node in layer cl1
-   Unhealthy node in layer dl1

## Guide

We are using **Node.js 16** to package this Lambda function. You can manage Node.js versions using [nvm](https://github.com/nvm-sh/nvm).

For local execution, we are utilizing the [node-lambda](https://www.npmjs.com/package/node-lambda) library. To run it locally, install node-lambda by executing the following command:
`npm install -g node-lambda`

**This repository was made to run using AWS Cloud.**

On AWS we will need to use some services:

- IAM (Policies)
- Lambda
- Event Bridge
- Systems Manager
- Dynamo
- Cloud Watch

### IAM
When creating a Lambda function, a corresponding role must be provided. This Lambda function will require access to other services such as DynamoDB and Systems Manager (SSM). To establish this role, access to AWS Identity and Access Management (IAM) is required.

The initial step involves creating a new policy on AWS, named `MetagraphMonitor`. This policy should include the following JSON configuration:

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": [
                "ssm:SendCommand",
                "ssm:CreateAssociation",
                "ssm:GetParameter"
            ],
            "Resource": "*"
        }
    ]
}
```

Upon policy creation, the subsequent step is to establish the role. This role should also be named `MetagraphMonitor`. Attach the following policies to this role:

1.  MetagraphMonitor (previously created)
2.  AmazonDynamoDBFullAccess (AWS default policy)
3.  AmazonEventBridgeFullAccess (AWS default policy)
4.  AWSLambdaBasicExecutionRole (AWS default policy)

These policies ensure access to the required services.

### Lambda
This codebase represents a Lambda function designed for deployment on AWS. To deploy the Lambda function, execute the following script:
`npm run package` 

Running this command will generate a file named `my_deployment_package.zip`. Upload this file to your Lambda function on AWS.

To run the lambda function, you should provide the parameters described in `event.json`. Some parameters are mandatory and need to be populated as SSM Parameters in the Parameter Store.

Ensure that you set the Lambda concurrency to only `1` and the timeout to `15 minutes`.

### Event Bridge
This service is responsible for scheduling the Lambda function to be triggered. Currently, we recommend creating a schedule to run every 5 minutes to check the health of the metagraph. The service should provide the Lambda payload, which includes information about **metagraph**, **network**, **aws**, **force_metagraph_restart**, and **enable_opsgenie_alerts**.

-   **metagraph**: This section contains information about the metagraph, such as metagraphID, metagraphName, layers to be monitored besides ml0, ports, file_system, additional environment variables, required environment variables, and seed lists (if necessary).
-   **network**: This section contains information about the network on which the metagraph will run. It could be Integrationnet or Mainnet.
-   **aws**: This section includes information about the AWS region where we are running our instances and details about the instances, such as **ids** and **ips**.
- **force_metagraph_restart**: This will initiate a restart, even if one is already in progress. Further details about restarts in progress will be discussed in the **Dynamo** section.
- **enable_opsgenie_alerts**: Additionally, we offer support for creating alerts on Opsgenie. Set this to `true` if you want to enable this integration.
 
The template for this payload can be found in the file `event.json` in the root directory of this repository. 
**Ensure that you fill in this payload correctly, as it is crucial for the proper execution of the Lambda function.**

### Systems Manager

This service plays a crucial role in two key aspects of our monitoring system: enabling commands to be sent to instances (without the need for `ssh`) and securely storing the sensitive parameters required for the proper execution of the Lambda function.

It is imperative to ensure SSM access is enabled for your EC2 instances running the metagraph. Refer to the official documentation on how to enable SSM on EC2 instances [here](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-install-ssm-agent.html).
 **This is critically important; without SSM on EC2 instances, the script will not function, as we rely on it to send instructions to the instances.**

Additionally, we rely on Systems Manager to store sensitive parameters, such as `p12` key information for the metagraph. These parameters are stored in the `Systems Manager -> Parameters Store` with the following pattern:

-   `/metagraph-nodes/{instance_id}/{layer}/keyalias`
-   `/metagraph-nodes/{instance_id}/{layer}/keystore`
-   `/metagraph-nodes/{instance_id}/{layer}/password`

The layers include: `l0`, `cl1`, and `dl1`.
The instance IDs correspond to the IDs from **EC2**.
Considering we have **3 instances** and **3 layers**, we should have a total of **9 parameters** for each instance (3 for ml0, 3 for cl1, and 3 for dl1). Therefore, **27 parameters** in total should be stored in the end.

**Note: The example above assumes all 3 layers; this value may vary based on the number of instances.**

As mentioned earlier, we support **Opsgenie** integration. However, to enable this integration, you need the **Opsgenie API-KEY**. Therefore, an additional parameter is required for this integration:

-   `/metagraph-nodes/opsgenie-api-key`

**Note: The integration will not work if you enable Opsgenie integration in the payload but forget to provide the API-KEY.**

### Dynamo

To prevent multiple restarts in parallel, we utilize **Dynamo** to store the restart state. Currently, the possible states for restarts are: `NEW`, `ROLLBACK_IN_PROGRESS`, `READY_TO_JOIN`, `JOINING`, and `READY`.

-   **NEW**: This is the initial state, and all restarts begin with this state. Even if the metagraph is healthy, we initiate the script with this status.
-   **ROLLBACK_IN_PROGRESS**: This state indicates that we've started a restart, but the node is still in the process of starting and is not ready to join the metagraph yet.
-   **READY_TO_JOIN**: As the name suggests, it signifies that the node is ready to join the metagraph.
-   **JOINING**: This state indicates that the node is currently joining the metagraph.
-   **READY**: This is the expected final state, signaling that the restart has successfully concluded.

After a successful execution, the row will be removed from **Dynamo**. You can check the current state by accessing the table directly on the AWS console.

To create the table on **Dynamo**, you can run the script `src/utils/scripts/create_dynamo_table.sh`.

**Note: Ensure that you set all environment variables pointing to the correct AWS account (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION) before running the script.**

### Cloud Watch
  
This service is responsible for storing the logs of our Lambda execution. You can search by Lambda name and review the logs of both the current and past executions.

## Additional Informations
This repository is designed to aid in monitoring the health of the metagraph and initiate a restart if needed. In the file `src/utils/types.js`, you will find a variable named `ROLLBACK_IN_PROGRESS_TIMEOUT_IN_MINUTES`. This variable determines the timeout for the current execution. If this timeout is exceeded, a new restart will be triggered, and the process will be retried.

After deploying the Lambda, monitor the initial executions to ensure everything is functioning correctly and that no parameters are missing or provided incorrectly.

In the `.github` directory, you will find examples of actions to automate the deployment of the Lambda function to AWS. You can use these examples as a reference for automating your deploys.

Seedlists are not required. You can leave the `seedlists` field as an empty object in the `event.json` file.
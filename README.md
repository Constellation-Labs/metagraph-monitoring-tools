
Network Monitoring Tools
========================

This project has been developed for monitoring metagraphs and initiating a restart if necessary.

We have a lambda function dedicated to monitoring a metagraph and restarting it if the snapshot production stops. It can be enhanced to handle other scenarios requiring a restart.

To run the lambda function, you should provide the parameters described in `event.json`. Some parameters are mandatory and need to be populated as SSM Parameters in the Parameter Store.

Please remember to create a new role for the lambda function, which should include the following policies: AmazonEventBridgeFullAccess, AWSLambda_FullAccess, AWSLambdaBasicExecutionRole. Additionally, we need to create a custom policy with the following permissions:

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

We also access instances using SSM, so ensure that your instances have the SSM client set up.

To deploy the function, simply package the changes using `zip -r my_deployment_package.zip .` and then deploy the ZIP file to your function.

Dependencies
------------

This project is designed to run as a lambda function and monitor EC2 instances. Therefore, we require the following:

-   3 EC2 instances with an authorized SSM agent and zip installed (use `sudo apt install zip` to install zip for compressing logs).

Inside each instance, we should follow a specific directory structure. To run this lambda function, your instance should contain the following directories and files:

-   `/home/ubuntu/code/metagraph-l0`

    -   `genesis.csv`
    -   `metagraph-l0.jar`
-   `/home/ubuntu/code/currency-l1`

    -   `currency-l1.jar`
-   `/home/ubuntu/code/data-l1`

    -   `data-l1.jar`

We need to create variables in the SSM Parameter Store, following this pattern:

```
/metagraph-nodes/:ec2_instance_id/l0/keystore
/metagraph-nodes/:ec2_instance_id/l0/keyalias
/metagraph-nodes/:ec2_instance_id/l0/password

/metagraph-nodes/:ec2_instance_id/cl1/keystore
/metagraph-nodes/:ec2_instance_id/cl1/keyalias
/metagraph-nodes/:ec2_instance_id/cl1/password

/metagraph-nodes/:ec2_instance_id/dl1/keystore
/metagraph-nodes/:ec2_instance_id/dl1/keyalias
/metagraph-nodes/:ec2_instance_id/dl1/password
```

You should repeat the above parameters for your 3 instances. Additionally, there is a parameter in the SSM Parameter Store for Opsgenie integration, so you need to create the following parameter:

`/metagraph-nodes/opsgenie-api-key`
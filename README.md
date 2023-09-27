

#   Network monitoring tools


This project was made to monitor some metagraphs and do a restart if needed.

We have one lambda function used to monitor a metagraph and restart if we stop
producing snapshots. It could be improved in other cases where a restart is needed.

To run the lambda function you should provide the parameters described in: event.json.

Some parameters are required and should be populated as SSM Parameters (on Parameters Store).
We have one script in `scripts/create-ssm-params.sh` that shows how to create the needed parameters.

Remember to create a new ROLE for the lambda function. This role should contain the following policies:
AmazonEventBridgeFullAccess, AWSLambda_FullAccess, AWSLambdaBasicExecutionRole, and we need to create a custom policy with the following permissions:

``` 
{

"Version":  "2012-10-17",

"Statement": [

{

"Sid":  "VisualEditor0",

"Effect":  "Allow",

"Action": [

"ssm:SendCommand",

"ssm:CreateAssociation",

"ssm:GetParameter"

],

"Resource":  "*"

}

]

}
```

  
We also access the instances using SSM, so be sure that your instances have the SSM client setup.

To deploy the function, just pack the changed `zip -r my_deployment_package.zip .` and then deploy the ZIP to your function.

This lambda assumes that you're using a proper directory architecture and names. To run this lambda your instance should contain the following directories:
* code/metagraph-l0
  * genesis.csv
  * metagraph-l0.jar
* code/currency-l1
  * currency-l1.jar
* code/data-l1
  * data-l1.jar
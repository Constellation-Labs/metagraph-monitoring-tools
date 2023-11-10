const main = () => {
  const instanceId = `i-0a29153b8b04ab7c1`
  const layers = ['l0', 'cl1', 'dl1']
  const parameters = ['keyalias', 'keystore', 'password']
  const values = ['dor_metagraph_mainnet_3', 'dor_metagraph_mainnet_3.p12', 'i8HKOLe0b3b6']

  for (let idx = 0; idx < 3; idx++) {
    for (let j = 0; j < 3; j++) {
      console.log(`aws ssm put-parameter --region "us-west-1" --name "/metagraph-nodes/${instanceId}/${layers[j]}/${parameters[idx]}" --value "${values[idx]}" --type String --overwrite`)
    }
  }
}

main()
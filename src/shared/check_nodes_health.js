import axios from 'axios'
import { CHECK_NODE_HEALTHY_LIMIT, LAYERS } from '../utils/types.js'
import { sleep } from './shared.js'

const checkIfNodeIsReady = async (
  nodeIp,
  nodePort
) => {
  try {
    const url = `http://${nodeIp}:${nodePort}/node/info`

    const response = await axios.get(url)
    const nodeState = response.data.state
    console.log(`Current state of node ${nodeIp}:${nodePort}: ${nodeState}`)
    if (nodeState === 'Ready') {
      return { nodeIsReady: true, successCheck: true }
    }

    return { nodeIsReady: false, successCheck: true }
  } catch (e) {
    console.log(`Could not get response of node: ${nodeIp}`)
    return { nodeIsReady: false, successCheck: false }
  }
}

const checkIfValidatorsStarted = async (
  event,
  layer
) => {
  const { ports } = event.metagraph
  var layerPorts = {
    [LAYERS.L0]: ports.metagraph_l0_public_port,
    [LAYERS.CURRENCY_L1]: ports.currency_l1_public_port,
    [LAYERS.DATA_L1]: ports.data_l1_public_port
  }

  const validatorsUrls = event.aws.ec2.instances.validators.map(validator => {
    return `http://${validator.ip}:${layerPorts[layer]}/node/info`
  })

  for (const url of validatorsUrls) {
    console.log(`Checking validator at URL: ${url}`)
    for (let idx = 0; idx < CHECK_NODE_HEALTHY_LIMIT; idx++) {
      try {
        await axios.get(url)
        console.log(`Node started and healthy`)
        return
      } catch (e) {
        if (idx === CHECK_NODE_HEALTHY_LIMIT) {
          throw Error(`Could not get information of node in URL: ${url}`)
        }
        console.log(`Node is possibly not READY yet, waiting for 1s to try again (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
        await sleep(1 * 1000)
      }
    }
  }
}

const checkIfNodeStarted = async (
  url
) => {
  for (let idx = 0; idx < CHECK_NODE_HEALTHY_LIMIT; idx++) {
    try {
      await axios.get(url)
      console.log(`Node started`)
      console.log(`Waiting 10 seconds before continuing...`)
      await sleep(10 * 1000)
      return
    } catch (e) {
      if (idx === CHECK_NODE_HEALTHY_LIMIT) {
        throw Error(`Could not get information of node in URL: ${url}`)
      }
      console.log(`Node possibly not started yet, waiting for 1s to try again (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
      await sleep(1 * 1000)
    }

  }
}

const checkIfAllNodesAreReady = async (
  event,
  layer
) => {
  const { ports } = event.metagraph
  var layerPorts = {
    [LAYERS.L0]: ports.metagraph_l0_public_port,
    [LAYERS.CURRENCY_L1]: ports.currency_l1_public_port,
    [LAYERS.DATA_L1]: ports.data_l1_public_port
  }

  const validatorsUrls = layer === LAYERS.L0 ? [] : event.aws.ec2.instances.validators.map(validator => {
    return `http://${validator.ip}:${layerPorts[layer]}/node/info`
  })

  let urls = [`http://${event.aws.ec2.instances.genesis.ip}:${layerPorts[layer]}/node/info`, ...validatorsUrls]
  for (let idx = 0; idx < CHECK_NODE_HEALTHY_LIMIT; idx++) {
    try {
      const readyNodesUrls = []
      for (const url of urls) {
        const response = await axios.get(url)
        const nodeState = response.data.state
        if (nodeState === 'Ready') {
          readyNodesUrls.push(url)
        }
      }
      if (readyNodesUrls.length > 0) {
        console.log(`[${layer}] The following nodes are already ready: ${JSON.stringify(readyNodesUrls)}`)
        urls = urls.filter(url => !readyNodesUrls.includes(url))
      }

      if (urls.length === 0) {
        console.log(`[${layer}] All nodes are on ready state`)
        return
      } else {
        console.log(`[${layer}] The following nodes are not ready yet: ${JSON.stringify(urls)}`)
        console.log(`[${layer}] Not all nodes are on Ready state, trying again in 1s (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
        await sleep(1 * 1000)
      }
    } catch (e) {
      if (idx === 19) {
        throw new Error(`[${layer}] Failing when restarting nodes. All nodes should be on READY state`)
      }

      console.log(`[${layer}] Not all nodes are on Ready state, trying again in 1s (${idx + 1}/${CHECK_NODE_HEALTHY_LIMIT})`)
      await sleep(1 * 1000)
    }
  }

}

export {
  checkIfNodeIsReady,
  checkIfValidatorsStarted,
  checkIfNodeStarted,
  checkIfAllNodesAreReady
}
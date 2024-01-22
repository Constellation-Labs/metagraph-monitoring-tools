import { SEEDLIST_EXTERNAL_STORAGE } from "./types.js"

const buildGithubSeedlistInformation = (metagraph, layer) => {
  const seedlistInformation = metagraph.seedlists[layer]
  if (!seedlistInformation || Object.keys(seedlistInformation).length === 0) {
    throw Error(`Could not get information of seedlist at layer ${layer}`)
  }

  const { version } = metagraph
  const { base_url, file_name } = seedlistInformation

  const seedlistUrl = `${base_url}/${version}/${file_name}`
  console.log(`Seedlist URL for layer ${layer}: ${seedlistUrl}`)

  return {
    url: seedlistUrl,
    file_name
  }
}

const buildSeedlistInformation = (event, layer) => {
  const { metagraph } = event
  if (Object.keys(metagraph.seedlists).length === 0) {
    console.log(`Seedlists not set for metagraph ${metagraph.name}`)
    return {
      url: null,
      file_name: null
    }
  }

  if (metagraph.seedlists.location === SEEDLIST_EXTERNAL_STORAGE.GITHUB) {
    return buildGithubSeedlistInformation(metagraph, layer)
  }

  throw Error("Invalid seedlist location type")
}

export {
  buildSeedlistInformation
}
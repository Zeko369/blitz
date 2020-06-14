import File from 'vinyl'
import slash from 'slash'
import {relative} from 'path'
import {Stage, transform} from '@blitzjs/file-pipeline'
import {getConfig} from '@blitzjs/config'

import {absolutePathTransform} from '../utils'

/**
 * Returns a Stage that manages generating the internal RPC commands and handlers
 */
export const createStageRpc: Stage = function configure({config: {src}}) {
  const fileTransformer = absolutePathTransform(src)

  const getRpcPath = fileTransformer(rpcPath)
  const getRpcHandlerPath = fileTransformer(handlerPath)

  const {target}: {target?: string} = getConfig()

  const stream = transform.file((file, {next, push}) => {
    if (!isRpcPath(file.path)) {
      return file
    }

    const importPath = rpcPath(resolutionPath(src, file.path))
    const {resolverType, resolverName} = extractTemplateVars(importPath)

    // Original function -> _rpc path
    push(
      new File({
        path: getRpcPath(file.path),
        contents: file.contents,
        hash: file.hash + ':1',
      }),
    )

    // File API route handler
    push(
      new File({
        path: getRpcHandlerPath(file.path),
        contents: Buffer.from(rpcHandlerTemplate(importPath, resolverType, resolverName)),
        hash: file.hash + ':2',
      }),
    )

    // Isomorphic RPC client
    const rpcFile = file.clone()
    rpcFile.contents = Buffer.from(isomorphicRpcTemplate(importPath, target?.includes('serverless') || false))
    push(rpcFile)

    return next()
  })

  return {stream}
}

export function isRpcPath(filePath: string) {
  return /(?:app[\\/])(?!_rpc).*(?:queries|mutations)[\\/].+/.exec(filePath)
}

const isomorphicRpcTemplate = (resolverPath: string, warm: boolean) => `
import {getIsomorphicRpcHandler} from '@blitzjs/core'
import resolver from '${resolverPath}'
export default getIsomorphicRpcHandler(resolver, '${resolverPath}', ${warm}) as typeof resolver
`

// Clarification: try/catch around db is to prevent query errors when not using blitz's inbuilt database (See #572)
const rpcHandlerTemplate = (resolverPath: string, resolverType: string, resolverName: string) => `
import {rpcHandler} from '@blitzjs/server'
import resolver from '${resolverPath}'
let db
try {
  db = require('db').default
}catch(err){}
export default rpcHandler('${resolverType}', '${resolverName}', resolver, () => db && db.connect())
`

function removeExt(filePath: string) {
  return filePath.replace(/[.][^./\s]+$/, '')
}

function resolutionPath(srcPath: string, filePath: string) {
  return removeExt(slash(relative(srcPath, filePath)))
}

function extractTemplateVars(importPath: string) {
  const [, resolverTypePlural, resolverName] = /(queries|mutations)\/(.*)$/.exec(importPath) || []

  return {
    importPath,
    resolverType: resolverTypePlural === 'mutations' ? 'mutation' : 'query',
    resolverName,
  }
}

function rpcPath(path: string) {
  return path.replace(/^app/, 'app/_rpc')
}

function handlerPath(path: string) {
  return path.replace(/^app/, 'pages/api')
}

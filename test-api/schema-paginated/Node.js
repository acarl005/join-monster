import { nodeDefinitions, fromGlobalId } from 'graphql-relay'

import joinMonster from '../../src/index'
const options = {
  minify: process.env.MINIFY == 1
}
const { PAGINATE } = process.env
if (knex.client.config.client === 'mysql' || knex.client.config.client === 'mysql2') {
  options.dialect = PAGINATE ? 'mysql8' : 'mysql'
} else if (knex.client.config.client === 'pg') {
  options.dialect = 'pg'
} else if (knex.client.config.client === 'oracledb') {
  options.dialect = 'oracle'
}

import dbCall from '../data/fetch'
import knex from './database'

const { nodeInterface, nodeField } = nodeDefinitions(
  (globalId, context, resolveInfo) => {
    const { type, id } = fromGlobalId(globalId)
    return joinMonster.getNode(
      type,
      resolveInfo,
      context,
      parseInt(id),
      sql => dbCall(sql, knex, context),
      options
    )
  },
  obj => obj.__type__
)

export { nodeInterface, nodeField }

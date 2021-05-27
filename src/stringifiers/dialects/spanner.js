import {
  keysetPagingSelect,
  offsetPagingSelect,
  interpretForOffsetPaging,
  interpretForKeysetPaging,
  orderColumnsToString
} from '../shared'

import { filter } from 'lodash'


function quote(str) {
  return `\`${str}\``
}

function joinUnions(unions, as) {
  return `FROM (
${unions.join('\nUNION\n')}
) AS ${quote(as)}`
}

function paginatedSelect(table, as, whereConditions, order, limit, offset, opts = {}) {
  const { extraJoin, withTotal } = opts
  as = quote(as)
  return `\
  (SELECT ${as}.*${withTotal ? ', count(*) OVER () AS `$total`' : ''}
  FROM ${table} ${as}
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${quote(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereConditions}
  ORDER BY ${orderColumnsToString(order.columns, quote, order.table)}
  LIMIT ${limit}${offset ? ' OFFSET ' + offset : ''})`
}

const dialect = module.exports = {
  ...require('./mixins/pagination-not-supported'),

  name: 'spanner',

  quote,

  compositeKey(parent, keys) {
    keys = keys.map(key => `${quote(parent)}.${quote(key)}`)
    return `CONCAT(${keys.join(', ')})`
  },

  handlePaginationAtRoot: async function(parent, node, context, tables) {
    const pagingWhereConditions = []
    if (node.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect)
      pagingWhereConditions.push(whereAddendum)
      if (node.where) {
        pagingWhereConditions.push(
          await node.where(`${quote(node.as)}`, node.args || {}, context, node)
        )
      }
      tables.push(
        keysetPagingSelect(node.name, pagingWhereConditions, order, limit, node.as, { q: quote })
      )
    } else if (node.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect)
      if (node.where) {
        pagingWhereConditions.push(
          await node.where(`${quote(node.as)}`, node.args || {}, context, node)
        )
      }
      tables.push(
        offsetPagingSelect(node.name, pagingWhereConditions, order, limit, offset, node.as, { q: quote })
      )
    }
  },

  handleBatchedOneToManyPaginated: async function(parent, node, context, tables, batchScope) {
    const pagingWhereConditions = []
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`${quote(node.as)}`, node.args || {}, context, node)
      )
    }
    if (node.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect)
      pagingWhereConditions.push(whereAddendum)
      const unions = batchScope.map(val => {
        let whereConditions = [ ...pagingWhereConditions, `${quote(node.as)}.${quote(node.sqlBatch.thisKey.name)} = ${val}` ]
        whereConditions = filter(whereConditions).join(' AND ') || '1'
        return paginatedSelect(node.name, node.as, whereConditions, order, limit, null)
      })
      tables.push(joinUnions(unions, node.as))
    } else if (node.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect)
      const unions = batchScope.map(val => {
        let whereConditions = [ ...pagingWhereConditions, `${quote(node.as)}.${quote(node.sqlBatch.thisKey.name)} = ${val}` ]
        whereConditions = filter(whereConditions).join(' AND ') || '1'
        return paginatedSelect(node.name, node.as, whereConditions, order, limit, offset)
      })
      tables.push(joinUnions(unions, node.as))
    }
  },

  handleBatchedManyToManyPaginated: async function(parent, node, context, tables, batchScope, joinCondition) {
    const pagingWhereConditions = []
    if (node.junction.where) {
      pagingWhereConditions.push(
        await node.junction.where(`${quote(node.junction.as)}`, node.args || {}, context, node)
      )
    }
    if (node.where) {
      pagingWhereConditions.push(
        await node.where(`${quote(node.as)}`, node.args || {}, context, node)
      )
    }

    if (node.where || node.orderBy) {
      var extraJoin = {
        name: node.name,
        as: node.as,
        condition: joinCondition
      }
    }
    if (node.sortKey || node.junction.sortKey) {
      const { limit, order, whereCondition: whereAddendum } = interpretForKeysetPaging(node, dialect)
      pagingWhereConditions.push(whereAddendum)
      const unions = batchScope.map(val => {
        let whereConditions = [
          ...pagingWhereConditions,
          `${quote(node.junction.as)}.${quote(node.junction.sqlBatch.thisKey.name)} = ${val}`
        ]
        whereConditions = filter(whereConditions).join(' AND ') || '1'
        return paginatedSelect(node.junction.sqlTable, node.junction.as, whereConditions, order, limit, null, { extraJoin })
      })
      tables.push(joinUnions(unions, node.junction.as))
    } else if (node.orderBy || node.junction.orderBy) {
      const { limit, offset, order } = interpretForOffsetPaging(node, dialect)
      const unions = batchScope.map(val => {
        let whereConditions = [
          ...pagingWhereConditions,
          `${quote(node.junction.as)}.${quote(node.junction.sqlBatch.thisKey.name)} = ${val}`
        ]
        whereConditions = filter(whereConditions).join(' AND ') || '1'
        return paginatedSelect(node.junction.sqlTable, node.junction.as, whereConditions, order, limit, offset, {
          extraJoin
        })
      })
      tables.push(joinUnions(unions, node.junction.as))
    }
    tables.push(`LEFT JOIN ${node.name} AS ${quote(node.as)} ON ${joinCondition}`)
  }
}

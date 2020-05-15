import { filter } from 'lodash'
import { cursorToOffset } from 'graphql-relay'
import { wrap, cursorToObj, maybeQuote } from '../util'
import idx from 'idx'

export function joinPrefix(prefix) {
  return prefix.slice(1).map(name => name + '__').join('')
}


export function generateCastExpressionFromValueType(key, val) {
  const castTypes = {
    string: 'TEXT'
  }
  const type = castTypes[typeof val] || null

  if (type) {
    return `CAST(${key} AS ${type})`
  }
  return key
}

function doubleQuote(str) {
  return `"${str}"`
}

export function thisIsNotTheEndOfThisBatch(node, parent) {
  return (!node.sqlBatch && !(idx(node, _ => _.junction.sqlBatch))) || !parent
}

export function whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch(node, parent) {
  return !node.paginate && (!(node.sqlBatch || (idx(node, _ => _.junction.sqlBatch))) || !parent)
}

export function keysetPagingSelect(table, whereCondition, order, limit, as, options = {}) {
  let { joinCondition, joinType, extraJoin, q } = options
  q = q || doubleQuote
  whereCondition = filter(whereCondition).join(' AND ') || 'TRUE'
  if (joinCondition) {
    return `\
${joinType || ''} JOIN LATERAL (
  SELECT ${q(as)}.*
  FROM ${table} ${q(as)}
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  LIMIT ${limit}
) ${q(as)} ON ${joinCondition}`
  }
  return `\
FROM (
  SELECT ${q(as)}.*
  FROM ${table} ${q(as)}
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  LIMIT ${limit}
) ${q(as)}`
}

export function offsetPagingSelect(table, pagingWhereConditions, order, limit, offset, as, options = {}) {
  let { joinCondition, joinType, extraJoin, q } = options
  q = q || doubleQuote
  const whereCondition = filter(pagingWhereConditions).join(' AND ') || 'TRUE'
  if (joinCondition) {
    return `\
${joinType || ''} JOIN LATERAL (
  SELECT ${q(as)}.*, count(*) OVER () AS ${q('$total')}
  FROM ${table} ${q(as)}
  ${extraJoin ? `LEFT JOIN ${extraJoin.name} ${q(extraJoin.as)}
    ON ${extraJoin.condition}` : ''}
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  LIMIT ${limit} OFFSET ${offset}
) ${q(as)} ON ${joinCondition}`
  }
  return `\
FROM (
  SELECT ${q(as)}.*, count(*) OVER () AS ${q('$total')}
  FROM ${table} ${q(as)}
  WHERE ${whereCondition}
  ORDER BY ${orderColumnsToString(order.columns, q, order.table)}
  LIMIT ${limit} OFFSET ${offset}
) ${q(as)}`
}

export function orderColumnsToString(orderColumns, q, as) {
  const conditions = []
  for (let column in orderColumns) {
    conditions.push(`${as ? q(as) + '.' : ''}${q(column)} ${orderColumns[column]}`)
  }
  return conditions.join(', ')
}

// find out what the limit, offset, order by parts should be from the relay connection args if we're paginating
export function interpretForOffsetPaging(node, dialect) {
  const { name } = dialect
  if (idx(node, _ => _.args.last)) {
    throw new Error('Backward pagination not supported with offsets. Consider using keyset pagination instead')
  }

  const order = {}
  if (node.orderBy) {
    order.table = node.as
    order.columns = node.orderBy
  } else {
    order.table = node.junction.as
    order.columns = node.junction.orderBy
  }

  let limit = [ 'mariadb', 'mysql', 'oracle' ].includes(name) ? '18446744073709551615' : 'ALL'
  let offset = node.offset || 0
  if (idx(node, _ => _.args.first)) {
    limit = parseInt(node.args.first, 10)
    // we'll get one extra item (hence the +1). this is to determine if there is a next page or not
    if (node.paginate) {
      limit++
    }
    if (node.args.after) {
      offset = cursorToOffset(node.args.after) + 1
    }
  }
  return { limit, offset, order }
}

export function interpretForKeysetPaging(node, dialect) {
  const { name } = dialect

  let sortTable
  let sortKey
  let descending
  const order = { columns: {} }
  if (node.sortKey) {
    sortKey = node.sortKey
    descending = sortKey.order.toUpperCase() === 'DESC'
    sortTable = node.as
    // flip the sort order if doing backwards paging
    if (idx(node, _ => _.args.last)) {
      descending = !descending
    }
    for (let column of wrap(sortKey.key)) {
      order.columns[column] = descending ? 'DESC' : 'ASC'
    }
    order.table = node.as
  } else {
    sortKey = node.junction.sortKey
    descending = sortKey.order.toUpperCase() === 'DESC'
    sortTable = node.junction.as
    // flip the sort order if doing backwards paging
    if (idx(node, _ => _.args.last)) {
      descending = !descending
    }
    for (let column of wrap(sortKey.key)) {
      order.columns[column] = descending ? 'DESC' : 'ASC'
    }
    order.table = node.junction.as
  }

  let limit = [ 'mariadb', 'mysql', 'oracle' ].includes(name) ? '18446744073709551615' : 'ALL'
  let whereCondition = ''
  if (idx(node, _ => _.args.first)) {
    limit = parseInt(node.args.first, 10) + 1
    if (node.args.after) {
      const cursorObj = cursorToObj(node.args.after)
      validateCursor(cursorObj, wrap(sortKey.key))
      whereCondition = sortKeyToWhereCondition(cursorObj, descending, sortTable, dialect)
    }
    if (node.args.before) {
      throw new Error('Using "before" with "first" is nonsensical.')
    }
  } else if (idx(node, _ => _.args.last)) {
    limit = parseInt(node.args.last, 10) + 1
    if (node.args.before) {
      const cursorObj = cursorToObj(node.args.before)
      validateCursor(cursorObj, wrap(sortKey.key))
      whereCondition = sortKeyToWhereCondition(cursorObj, descending, sortTable, dialect)
    }
    if (node.args.after) {
      throw new Error('Using "after" with "last" is nonsensical.')
    }
  }

  return { limit, order, whereCondition }
}

// the cursor contains the sort keys. it needs to match the keys specified in the `sortKey` on this field in the schema
export function validateCursor(cursorObj, expectedKeys) {
  const actualKeys = Object.keys(cursorObj)
  const expectedKeySet = new Set(expectedKeys)
  const actualKeySet = new Set(actualKeys)
  for (let key of actualKeys) {
    if (!expectedKeySet.has(key)) {
      throw new Error(`Invalid cursor. The column "${key}" is not in the sort key.`)
    }
  }
  for (let key of expectedKeys) {
    if (!actualKeySet.has(key)) {
      throw new Error(`Invalid cursor. The column "${key}" is not in the cursor.`)
    }
  }
}

// take the sort key and translate that for the where clause
function sortKeyToWhereCondition(keyObj, descending, sortTable, dialect) {
  const { name, quote: q } = dialect
  const sortColumns = []
  const sortValues = []
  for (let key in keyObj) {
    sortColumns.push(`${q(sortTable)}.${q(key)}`)
    sortValues.push(maybeQuote(keyObj[key], name))
  }
  const operator = descending ? '<' : '>'
  return name === 'oracle'
    ? recursiveWhereJoin(sortColumns, sortValues, operator)
    : `(${sortColumns.join(', ')}) ${operator} (${sortValues.join(', ')})`
}

function recursiveWhereJoin(columns, values, op) {
  const condition = `${columns.pop()} ${op} ${values.pop()}`
  return _recursiveWhereJoin(columns, values, op, condition)
}

function _recursiveWhereJoin(columns, values, op, condition) {
  if (!columns.length) {
    return condition
  }
  const column = columns.pop()
  const value = values.pop()
  condition = `(${column} ${op} ${value} OR (${column} = ${value} AND ${condition}))`
  return _recursiveWhereJoin(columns, values, op, condition)
}

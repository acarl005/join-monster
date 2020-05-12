import assert from 'assert'
import { filter } from 'lodash'
import idx from 'idx'

import { validateSqlAST, inspect, wrap } from '../util'
import {
  joinPrefix,
  thisIsNotTheEndOfThisBatch,
  whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch
} from './shared'

export default async function stringifySqlAST(topNode, context, options) {
  validateSqlAST(topNode)

  let dialect = options.dialectModule

  if (!dialect && options.dialect) {
    dialect = require('./dialects/' + options.dialect)
  }

  // recursively figure out all the selections, joins, and where conditions that we need
  let { selections, tables, wheres, orders } = await _stringifySqlAST(
    null, topNode, [],
    context, [], [],
    [], [], options.batchScope,
    dialect
  )

  // make sure these are unique by converting to a set and then back to an array
  // e.g. we want to get rid of things like `SELECT user.id as id, user.id as id, ...`
  // GraphQL does not prevent queries with duplicate fields
  selections = [ ...new Set(selections) ]

  // bail out if they made no selections
  if (!selections.length) return ''

  // put together the SQL query
  let sql = 'SELECT\n  '
    + selections.join(',\n  ') + '\n'
    + tables.join('\n')

  wheres = filter(wheres)
  if (wheres.length) {
    sql += '\nWHERE ' + wheres.join(' AND ')
  }

  if (orders.length) {
    sql += '\nORDER BY ' + stringifyOuterOrder(orders, dialect.quote)
  }

  return sql
}

async function _stringifySqlAST(parent, node, prefix, context, selections, tables, wheres, orders, batchScope, dialect) {
  const { quote: q } = dialect
  const parentTable = node.fromOtherTable || (parent && parent.as)
  switch (node.type) {
  case 'table':
    await handleTable(parent, node, prefix, context, selections, tables, wheres, orders, batchScope, dialect)

    // recurse thru nodes
    if (thisIsNotTheEndOfThisBatch(node, parent)) {
      for (let child of node.children) {
        await _stringifySqlAST(
          node, child, [ ...prefix, node.as ],
          context, selections, tables,
          wheres, orders, null,
          dialect
        )
      }
    }

    break
  case 'union':
    await handleTable(parent, node, prefix, context, selections, tables, wheres, orders, batchScope, dialect)

    // recurse thru nodes
    if (thisIsNotTheEndOfThisBatch(node, parent)) {
      for (let typeName in node.typedChildren) {
        for (let child of node.typedChildren[typeName]) {
          await _stringifySqlAST(
            node, child, [ ...prefix, node.as ],
            context, selections, tables,
            wheres, orders, null,
            dialect
          )
        }
      }
      for (let child of node.children) {
        await _stringifySqlAST(
          node, child, [ ...prefix, node.as ],
          context, selections, tables,
          wheres, orders, null,
          dialect
        )
      }
    }

    break
  case 'column':
    selections.push(
      `${q(parentTable)}.${q(node.name)} AS ${q(joinPrefix(prefix) + node.as)}`
    )
    break
  case 'columnDeps':
    // grab the dependant columns
    for (let name in node.names) {
      selections.push(
        `${q(parentTable)}.${q(name)} AS ${q(joinPrefix(prefix) + node.names[name])}`
      )
    }
    break
  case 'composite':
    selections.push(
      `${dialect.compositeKey(parentTable, node.name)} AS ${q(joinPrefix(prefix) + node.as)}`
    )
    break
  case 'expression':
    const expr = await node.sqlExpr(`${q(parentTable)}`, node.args || {}, context, node)
    selections.push(
      `${expr} AS ${q(joinPrefix(prefix) + node.as)}`
    )
    break
  case 'noop':
    // we hit this with fields that don't need anything from SQL, they resolve independently
    return
  default:
    throw new Error('unexpected/unknown node type reached: ' + inspect(node))
  }
  return { selections, tables, wheres, orders }
}

async function handleTable(parent, node, prefix, context, selections, tables, wheres, orders, batchScope, dialect) {
  const { quote: q } = dialect
  // generate the "where" condition, if applicable
  if (whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch(node, parent)) {
    if (idx(node, _ => _.junction.where)) {
      wheres.push(await node.junction.where(`${q(node.junction.as)}`, node.args || {}, context, node))
    }
    if (node.where) {
      wheres.push(await node.where(`${q(node.as)}`, node.args || {}, context, node))
    }
  }

  if (thisIsNotTheEndOfThisBatch(node, parent)) {
    if (idx(node, _ => _.junction.orderBy)) {
      orders.push({
        table: node.junction.as,
        columns: node.junction.orderBy
      })
    }
    if (node.orderBy) {
      orders.push({
        table: node.as,
        columns: node.orderBy
      })
    }
    if (idx(node, _ => _.junction.sortKey)) {
      orders.push({
        table: node.junction.as,
        columns: sortKeyToOrderColumns(node.junction.sortKey, node.args)
      })
    }
    if (node.sortKey) {
      orders.push({
        table: node.as,
        columns: sortKeyToOrderColumns(node.sortKey, node.args)
      })
    }
  }

  // one-to-many using JOIN
  if (node.sqlJoin) {
    const joinCondition = await node.sqlJoin(`${q(parent.as)}`, q(node.as), node.args || {}, context, node)

    // do we need to paginate? if so this will be a lateral join
    if (node.paginate) {
      await dialect.handleJoinedOneToManyPaginated(parent, node, context, tables, joinCondition)

    // limit has a highly similar approach to paginating
    } else if (node.limit && dialect.handleJoinedOneToManyPaginated) {
      node.args.first = node.limit
      await dialect.handleJoinedOneToManyPaginated(parent, node, context, tables, joinCondition)
    // otherwite, just a regular left join on the table
    } else {
      tables.push(
        `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`
      )
    }

  // many-to-many using batching
  } else if (idx(node, _ => _.junction.sqlBatch)) {
    if (parent) {
      selections.push(
        `${q(parent.as)}.${q(node.junction.sqlBatch.parentKey.name)} AS ${q(joinPrefix(prefix) + node.junction.sqlBatch.parentKey.as)}`
      )
    } else {
      const joinCondition = await node.junction.sqlBatch.sqlJoin(
        `${q(node.junction.as)}`, q(node.as), node.args || {}, context, node
      )
      if (node.paginate) {
        await dialect.handleBatchedManyToManyPaginated(parent, node, context, tables, batchScope, joinCondition)
      } else if (node.limit) {
        node.args.first = node.limit
        await dialect.handleBatchedManyToManyPaginated(parent, node, context, tables, batchScope, joinCondition)
      } else {
        tables.push(
          `FROM ${node.junction.sqlTable} ${q(node.junction.as)}`,
          `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`
        )
        // ensures only the correct records are fetched using the value of the parent key
        wheres.push(`${q(node.junction.as)}.${q(node.junction.sqlBatch.thisKey.name)} IN (${batchScope.join(',')})`)
      }
    }

  // many-to-many using JOINs
  } else if (idx(node, _ => _.junction.sqlTable)) {
    const joinCondition1 = await node.junction
      .sqlJoins[0](`${q(parent.as)}`, q(node.junction.as), node.args || {}, context, node)
    const joinCondition2 = await node.junction
      .sqlJoins[1](`${q(node.junction.as)}`, q(node.as), node.args || {}, context, node)

    if (node.paginate) {
      await dialect.handleJoinedManyToManyPaginated(parent, node, context, tables, joinCondition1, joinCondition2)
    } else if (node.limit) {
      node.args.first = node.limit
      await dialect.handleJoinedManyToManyPaginated(parent, node, context, tables, joinCondition1, joinCondition2)
    } else {
      tables.push(
        `LEFT JOIN ${node.junction.sqlTable} ${q(node.junction.as)} ON ${joinCondition1}`
      )
    }
    tables.push(
      `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition2}`
    )

  // one-to-many with batching
  } else if (node.sqlBatch) {
    if (parent) {
      selections.push(
        `${q(parent.as)}.${q(node.sqlBatch.parentKey.name)} AS ${q(joinPrefix(prefix) + node.sqlBatch.parentKey.as)}`
      )
    } else if (node.paginate) {
      await dialect.handleBatchedOneToManyPaginated(parent, node, context, tables, batchScope)
    } else if (node.limit) {
      node.args.first = node.limit
      await dialect.handleBatchedOneToManyPaginated(parent, node, context, tables, batchScope)
      // otherwite, just a regular left join on the table
    } else {
      tables.push(
        `FROM ${node.name} ${q(node.as)}`
      )
      wheres.push(`${q(node.as)}.${q(node.sqlBatch.thisKey.name)} IN (${batchScope.join(',')})`)
    }
  // otherwise, we aren't joining, so we are at the "root", and this is the start of the FROM clause
  } else if (node.paginate) {
    await dialect.handlePaginationAtRoot(parent, node, context, tables)
  } else if (node.limit) {
    node.args.first = node.limit
    await dialect.handlePaginationAtRoot(parent, node, context, tables)
  } else {
    assert(!parent, `Object type for "${node.fieldName}" table must have a "sqlJoin" or "sqlBatch"`)
    tables.push(
      `FROM ${node.name} ${q(node.as)}`
    )
  }
}


// we need one ORDER BY clause on at the very end to make sure everything comes back in the correct order
// ordering inner(sub) queries DOES NOT guarantee the order of those results in the outer query
function stringifyOuterOrder(orders, q) {
  const conditions = []
  for (let condition of orders) {
    for (let column in condition.columns) {
      const direction = condition.columns[column]
      conditions.push(`${q(condition.table)}.${q(column)} ${direction}`)
    }
  }
  return conditions.join(', ')
}

function sortKeyToOrderColumns(sortKey, args) {
  let descending = sortKey.order.toUpperCase() === 'DESC'
  if (args && args.last) {
    descending = !descending
  }
  const orderColumns = {}
  for (let column of wrap(sortKey.key)) {
    orderColumns[column] = descending ? 'DESC' : 'ASC'
  }
  return orderColumns
}

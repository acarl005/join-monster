import assert from 'assert'
import { filter } from 'lodash'
import idx from 'idx'

import { validateSqlAST, inspect, wrap } from '../util'
import {
  joinPrefix,
  thisIsNotTheEndOfThisBatch,
  sortKeyToOrderings,
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
    null,
    topNode,
    [],
    context,
    [],
    [],
    [],
    [],
    options.batchScope,
    dialect
  )

  // make sure these are unique by converting to a set and then back to an array
  // e.g. we want to get rid of things like `SELECT user.id as id, user.id as id, ...`
  // GraphQL does not prevent queries with duplicate fields
  selections = [...new Set(selections)]

  // bail out if they made no selections
  if (!selections.length) return ''

  // put together the SQL query
  let sql = 'SELECT\n  ' + selections.join(',\n  ') + '\n' + tables.join('\n')

  wheres = filter(wheres)
  if (wheres.length) {
    sql += '\nWHERE ' + wheres.join(' AND ')
  }

  if (orders.length) {
    sql += '\nORDER BY ' + stringifyOuterOrder(orders, dialect.quote)
  }

  return sql
}

async function _stringifySqlAST(
  parent,
  node,
  prefix,
  context,
  selections,
  tables,
  wheres,
  orders,
  batchScope,
  dialect
) {
  const { quote: q } = dialect
  const parentTable = node.fromOtherTable || (parent && parent.as)
  switch (node.type) {
    case 'table':
      await handleTable(
        parent,
        node,
        prefix,
        context,
        selections,
        tables,
        wheres,
        orders,
        batchScope,
        dialect
      )

      // recurse thru nodes
      if (thisIsNotTheEndOfThisBatch(node, parent)) {
        for (let child of node.children) {
          await _stringifySqlAST(
            node,
            child,
            [...prefix, node.as],
            context,
            selections,
            tables,
            wheres,
            orders,
            null,
            dialect
          )
        }
      }

      break
    case 'union':
      await handleTable(
        parent,
        node,
        prefix,
        context,
        selections,
        tables,
        wheres,
        orders,
        batchScope,
        dialect
      )

      // recurse thru nodes
      if (thisIsNotTheEndOfThisBatch(node, parent)) {
        for (let typeName in node.typedChildren) {
          for (let child of node.typedChildren[typeName]) {
            await _stringifySqlAST(
              node,
              child,
              [...prefix, node.as],
              context,
              selections,
              tables,
              wheres,
              orders,
              null,
              dialect
            )
          }
        }
        for (let child of node.children) {
          await _stringifySqlAST(
            node,
            child,
            [...prefix, node.as],
            context,
            selections,
            tables,
            wheres,
            orders,
            null,
            dialect
          )
        }
      }

      break
    case 'column':
      selections.push(
        `${q(parentTable)}.${q(node.name)} AS ${q(
          joinPrefix(prefix) + node.as
        )}`
      )
      break
    case 'columnDeps':
      // grab the dependant columns
      for (let name in node.names) {
        selections.push(
          `${q(parentTable)}.${q(name)} AS ${q(
            joinPrefix(prefix) + node.names[name]
          )}`
        )
      }
      break
    case 'composite':
      selections.push(
        `${dialect.compositeKey(parentTable, node.name)} AS ${q(
          joinPrefix(prefix) + node.as
        )}`
      )
      break
    case 'expression':
      const expr = await node.sqlExpr(
        `${q(parentTable)}`,
        node.args || {},
        context,
        node
      )
      selections.push(`${expr} AS ${q(joinPrefix(prefix) + node.as)}`)
      break
    case 'noop':
      // we hit this with fields that don't need anything from SQL, they resolve independently
      return
    default:
      throw new Error('unexpected/unknown node type reached: ' + inspect(node))
  }
  return { selections, tables, wheres, orders }
}

function assembleFilterConditions(node, joinAst, q, joinMode) {
  const { filter } = node.args
  assert(filter, 'No filter!?')

  if (filter.OR) {
    return _assembleFilterConditions(
      filter.OR,
      'OR',
      joinAst,
      node.as,
      q,
      '',
      joinMode
    )
  } else if (filter.AND) {
    return _assembleFilterConditions(
      filter.AND,
      'AND',
      joinAst,
      node.as,
      q,
      '',
      joinMode
    )
  } else if (filter.compare) {
    return _assembleFilterConditions(
      filter,
      '',
      joinAst,
      node.as,
      q,
      '',
      joinMode
    )
  } else {
    throw new Error(
      `Wrong filter option. Available are 'AND', 'OR' and 'compare'. Check the filter on the "${node.as}" field`
    )
  }
}

function _assembleFilterConditions(
  filterArr,
  chainOperator,
  joinAst,
  joinTableAlias,
  q,
  sql,
  joinMode
) {
  let and = []
  let or = []
  let direct = []

  // Could be just a single `compare` object. To iterate, wrap it
  filterArr = wrap(filterArr)

  // Iterate through the array
  filterArr.forEach(obj => {
    if (obj.compare) {
      direct.push(
        buildComparison(obj.compare, joinAst, joinTableAlias, q, joinMode)
      )
    } else if (obj.AND) {
      and.push(obj.AND)
    } else if (obj.OR) {
      or.push(obj.OR)
    }
  })

  sql += ` ${direct.join(` ${chainOperator} `)} `

  and.forEach(andObj => {
    sql += `\n\t ${chainOperator} ( ${_assembleFilterConditions(
      andObj,
      'AND',
      joinAst,
      joinTableAlias,
      q,
      '',
      joinMode
    )} ) `
  })

  or.forEach(orObj => {
    sql += `\n\t ${chainOperator} ( ${_assembleFilterConditions(
      orObj,
      'OR',
      joinAst,
      joinTableAlias,
      q,
      '',
      joinMode
    )} ) `
  })

  return sql
}

function buildComparison(compareObj, joinAst, tableAlias, q, joinMode) {
  const { key, operator, value } = compareObj

  let currentNode = { ...joinAst }
  let renameParts = []
  key.split('.').forEach(part => {
    currentNode = currentNode.children.find(child => child.fieldName === part)

    renameParts.push(currentNode.as)
  })

  // Since we have access to the joined table and do not have to rely on
  // the selections we can access the field directly. Thusly we change the
  // table's alias and use only the actual column name, so we can remove all
  // indexes that we needed before
  if (joinMode === 'where') {
    renameParts = renameParts.slice(-1)
    tableAlias = currentNode.parent.as
  }

  const renamedKey = renameParts.join('__')

  switch (operator) {
    case 'seq':
      return `${q(tableAlias)}.${q(renamedKey)} = '${value}'`

    case 'sneq':
      return `${q(tableAlias)}.${q(renamedKey)} != '${value}'`

    case 'sct':
      return `${q(tableAlias)}.${q(renamedKey)} LIKE '%${value}%'`

    case 'snct':
      return `${q(tableAlias)}.${q(renamedKey)} NOT LIKE '%${value}%'`

    case 'gt':
      return `${q(tableAlias)}.${q(renamedKey)} > ${value}`

    case 'gte':
      return `${q(tableAlias)}.${q(renamedKey)} >= ${value}`

    case 'lt':
      return `${q(tableAlias)}.${q(renamedKey)} < ${value}`

    case 'lte':
      return `${q(tableAlias)}.${q(renamedKey)} <= ${value}`

    case '==':
      return `${q(tableAlias)}.${q(renamedKey)} = ${value}`

    case 'ssw':
      return `${q(tableAlias)}.${q(renamedKey)} LIKE '${value}%'`

    case 'sew':
      return `${q(tableAlias)}.${q(renamedKey)} LIKE '%${value}'`

    default:
      throw new Error(
        `Comparison operator '${operator}' for filter field '${key}' inside '${tableAlias}' is not valid`
      )
  }
}

async function handleFilteredWhere(
  selections,
  tables,
  wheres,
  node,
  q,
  args,
  context
) {
  const joinAst = node.filteredWhereMap

  const { selections: additionalSelections, joinTables } = getSelectionsAndJoinedTablesFromJoinAst(
    joinAst,
    q,
    args,
    context
  )

  const filterConditions = assembleFilterConditions(node, joinAst, q, 'where')

  selections.push(...additionalSelections)

  joinTables.forEach(joinObj => {
    tables.push(joinObj.sql)
  })

  wheres.push(filterConditions)
}

async function handleFilteredJoin(
  node,
  q,
  args,
  context,
  standardJoinCondition
) {
  const joinAst = node.join
  const { selections, joinTables } = getSelectionsAndJoinedTablesFromJoinAst(joinAst, q, args, context)
  const joins = []
  joinTables.forEach(joinTable => {
    joins.push(joinTable.sql)
  })

  const filterConditions = assembleFilterConditions(node, joinAst, q, 'join')

  const str = 
  `  LEFT JOIN (
      SELECT
        ${q(node.as)}.*${selections.length > 0 ? ',' : ''}
        ${selections.length > 0 ? selections.join(',\n') : ''}
      FROM ${node.name} ${q(node.as)}
        ${joins.join('\n')}
      ) AS ${q(node.as)}
        ON ${standardJoinCondition}
        AND ( ${filterConditions} )`

  return str
}

function getSelectionsAndJoinedTablesFromJoinAst(joinAst, q, args, context) {
  const { selections, joinTables } = _getSelectionsAndJoinedTablesFromJoinAst(
    joinAst,
    [joinAst.as], // prefix (start with the prefix of the root table's alias)
    [], // selections
    [], // joins,
    q,
    args,
    context
  )

  return {
    selections: selections,
    joinTables: joinTables
  }
}

function _getSelectionsAndJoinedTablesFromJoinAst(
  joinAstNode,
  prefix,
  selections,
  joins,
  q,
  args,
  context
) {
  joinAstNode.children.forEach(child => {
    // The child is a column and is NOT a child of the root node
    if (child.type === 'column' && joinAstNode.parent) {
      selections.push(
        `${q(joinAstNode.as)}.${q(child.as)} AS ${q(
          joinPrefix(prefix) + child.as
        )}`
      )
    } else if (child.type === 'table' && child.children.length > 0) {
      if (child.sqlJoin) {
        const joinCondition = child.sqlJoin(
          joinAstNode.as,
          child.as,
          args,
          context,
          child
        )

        joins.push({
          as: child,
          sql: `   LEFT JOIN ${child.name} ${q(child.as)} ON ${joinCondition}`
        })
      } else if (idx(child,_ => _.junction.sqlTable) && idx(child, _ => _.junction.sqlJoins)) {
        const joinCondition1 = child.junction.sqlJoins[0](
          q(joinAstNode.as),
          q(child.junction.as),
          args || {},
          context,
          child
        )

        const joinCondition2 = child.junction.sqlJoins[1](
          q(child.junction.as),
          q(child.as),
          {},
          context,
          child
        )

        joins.push(
          {
            as: child.junction.as,
            sql: `  LEFT JOIN ${child.junction.sqlTable} ${q(
              child.junction.as
            )} ON ${joinCondition1}`
          },
          {
            as: child.as,
            sql: `  LEFT JOIN ${child.name} ${q(child.as)} ON ${joinCondition2}`
          }
        )
      }

      _getSelectionsAndJoinedTablesFromJoinAst(
        child,
        [...prefix, child.as],
        selections,
        joins,
        q,
        args,
        context
      )
    }
  })

  return {
    selections: selections,
    joinTables: joins
  }
}

async function handleTable(
  parent,
  node,
  prefix,
  context,
  selections,
  tables,
  wheres,
  orders,
  batchScope,
  dialect
) {
  const { quote: q } = dialect
  // generate the "where" condition, if applicable
  if (whereConditionIsntSupposedToGoInsideSubqueryOrOnNextBatch(node, parent)) {
    if (idx(node, _ => _.junction.where)) {
      wheres.push(
        await node.junction.where(
          `${q(node.junction.as)}`,
          node.args || {},
          context,
          node
        )
      )
    }
    if (node.where) {
      wheres.push(
        await node.where(`${q(node.as)}`, node.args || {}, context, node)
      )
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
        columns: sortKeyToOrderings(node.junction.sortKey, node.args)
      })
    }
    if (node.sortKey) {
      orders.push({
        table: node.as,
        columns: sortKeyToOrderings(node.sortKey, node.args)
      })
    }
  }

  // one-to-many using JOIN
  if (node.sqlJoin) {
    const joinCondition = await node.sqlJoin(
      `${q(parent.as)}`,
      q(node.as),
      node.args || {},
      context,
      node
    )

    // do we need to paginate? if so this will be a lateral join
    if (node.paginate) {
      await dialect.handleJoinedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition
      )

      // limit has a highly similar approach to paginating
    } else if (node.limit) {
      node.args.first = node.limit
      await dialect.handleJoinedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition
      )
      // otherwise, just a regular left join on the table
    } else if (node.filteredOneToManyJoin) {
      const filteredJoin = await handleFilteredJoin(
        node,
        q,
        node.args || {},
        context,
        joinCondition
      )

      tables.push(filteredJoin)
    } else {
      tables.push(`    LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`)
    }

    // many-to-many using batching
  } else if (idx(node, _ => _.junction.sqlBatch)) {
    if (parent) {
      selections.push(
        `${q(parent.as)}.${q(node.junction.sqlBatch.parentKey.name)} AS ${q(
          joinPrefix(prefix) + node.junction.sqlBatch.parentKey.as
        )}`
      )
    } else {
      const joinCondition = await node.junction.sqlBatch.sqlJoin(
        `${q(node.junction.as)}`,
        q(node.as),
        node.args || {},
        context,
        node
      )
      if (node.paginate) {
        await dialect.handleBatchedManyToManyPaginated(
          parent,
          node,
          context,
          tables,
          batchScope,
          joinCondition
        )
      } else if (node.limit) {
        node.args.first = node.limit
        await dialect.handleBatchedManyToManyPaginated(
          parent,
          node,
          context,
          tables,
          batchScope,
          joinCondition
        )
      } else {
        tables.push(
          `FROM ${node.junction.sqlTable} ${q(node.junction.as)}`,
          `LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition}`
        )
        // ensures only the correct records are fetched using the value of the parent key
        wheres.push(
          `${q(node.junction.as)}.${q(
            node.junction.sqlBatch.thisKey.name
          )} IN (${batchScope.join(',')})`
        )
      }
    }

    // many-to-many using JOINs
  } else if (idx(node, _ => _.junction.sqlTable)) {
    const joinCondition1 = await node.junction.sqlJoins[0](
      `${q(parent.as)}`,
      q(node.junction.as),
      node.args || {},
      context,
      node
    )
    const joinCondition2 = await node.junction.sqlJoins[1](
      `${q(node.junction.as)}`,
      q(node.as),
      node.args || {},
      context,
      node
    )

    if (node.paginate) {
      await dialect.handleJoinedManyToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition1,
        joinCondition2
      )
    } else if (node.limit) {
      node.args.first = node.limit
      await dialect.handleJoinedManyToManyPaginated(
        parent,
        node,
        context,
        tables,
        joinCondition1,
        joinCondition2
      )
    } else {
      tables.push(
        `LEFT JOIN ${node.junction.sqlTable} ${q(
          node.junction.as
        )} ON ${joinCondition1}`
      )
    }

    if (node.filteredManyToManyJoin) {
      const filteredJoin = await handleFilteredJoin(
        node,
        q,
        node.args || {},
        context,
        joinCondition2
      )

      tables.push(filteredJoin)
    } else {
      tables.push(`LEFT JOIN ${node.name} ${q(node.as)} ON ${joinCondition2}`)
    }

    // one-to-many with batching
  } else if (node.sqlBatch) {
    if (parent) {
      selections.push(
        `${q(parent.as)}.${q(node.sqlBatch.parentKey.name)} AS ${q(
          joinPrefix(prefix) + node.sqlBatch.parentKey.as
        )}`
      )
    } else if (node.paginate) {
      await dialect.handleBatchedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        batchScope
      )
    } else if (node.limit) {
      node.args.first = node.limit
      await dialect.handleBatchedOneToManyPaginated(
        parent,
        node,
        context,
        tables,
        batchScope
      )
      // otherwite, just a regular left join on the table
    } else {
      tables.push(`FROM ${node.name} ${q(node.as)}`)
      wheres.push(
        `${q(node.as)}.${q(node.sqlBatch.thisKey.name)} IN (${batchScope.join(
          ','
        )})`
      )
    }
    // otherwise, we aren't joining, so we are at the "root", and this is the start of the FROM clause
  } else if (node.paginate) {
    await dialect.handlePaginationAtRoot(parent, node, context, tables)
  } else if (node.limit) {
    node.args.first = node.limit
    await dialect.handlePaginationAtRoot(parent, node, context, tables)
  } else {
    assert(
      !parent,
      `Object type for "${node.fieldName}" table must have a "sqlJoin" or "sqlBatch"`
    )

    tables.push(`FROM ${node.name} ${q(node.as)}`)

    if (node.filteredWhere) {
      
      handleFilteredWhere(
        selections,
        tables,
        wheres,
        node,
        q,
        node.args || {},
        context
      )
    }
  }
}

// we need one ORDER BY clause on at the very end to make sure everything comes back in the correct order
// ordering inner(sub) queries DOES NOT guarantee the order of those results in the outer query
function stringifyOuterOrder(orders, q) {
  const conditions = []
  for (const condition of orders) {
    for (const ordering of condition.columns) {
      conditions.push(
        `${q(condition.table)}.${q(ordering.column)} ${ordering.direction}`
      )
    }
  }
  return conditions.join(', ')
}

import assert from 'assert'
import { flatMap } from 'lodash'
import deprecate from 'deprecate'
import { getArgumentValues } from 'graphql/execution/values'
import idx from 'idx'

import AliasNamespace from '../alias-namespace'
import { wrap, ensure, unthunk, inspect } from '../util'

class SQLASTNode {
  constructor(parentNode, props) {
    Object.defineProperty(this, 'parent', {
      enumerable: false,
      value: parentNode
    })

    for (let prop in props) {
      this[prop] = props[prop]
    }
  }
}

// an enumeration of all the types that can map to SQL tables
const TABLE_TYPES = [ 'GraphQLObjectType', 'GraphQLUnionType', 'GraphQLInterfaceType' ]


function mergeAll(fieldNodes) {
  const newFieldNodes = [ ...fieldNodes ]
  while (newFieldNodes.length > 1) {
    newFieldNodes.push(merge(newFieldNodes.pop(), newFieldNodes.pop()))
  }
  return newFieldNodes
}

function merge(dest, src) {
  return {
    ...dest,
    selectionSet: {
      ...dest.selectionSet,
      selections: [ ...dest.selectionSet.selections, ...src.selectionSet.selections ]
    }
  }
}

export function queryASTToSqlAST(resolveInfo, options, context) {
  // this is responsible for all the logic regarding creating SQL aliases
  // we need varying degrees of uniqueness and readability
  // force oracle to minify, because it has this 30-character limit on column identifiers
  const namespace = new AliasNamespace(options.dialect === 'oracle' ? true : options.minify)

  // we'll build up the AST representing the SQL recursively
  const sqlAST = {}

  // v0.8 changed the "fieldASTs" property to "fieldNodes". we want to support both
  let fieldNodes = resolveInfo.fieldNodes || resolveInfo.fieldASTs

  // fieldNodes is usually an array of 1 GraphQL node. If a field is requested twice *without* aliases, both nodes will be in this array
  // we need to merge it into one
  fieldNodes = mergeAll(fieldNodes)
  assert.equal(fieldNodes.length, 1, 'We thought this would always have a length of 1. FIX ME!!')

  // this represents the parsed query
  const queryAST = fieldNodes[0]
  // resolveInfo.parentType is from the schema, its the GraphQLObjectType that is parent to the current field
  // this allows us to get the field definition of the current field so we can grab that extra metadata
  // e.g. sqlColumn or sqlJoin, etc.
  const parentType = resolveInfo.parentType
  populateASTNode.call(resolveInfo, queryAST, parentType, sqlAST, namespace, 0, options, context)

  // make sure they started this party on a table, interface or union.
  assert.ok(
    [ 'table', 'union' ].indexOf(sqlAST.type) > -1,
    'Must call joinMonster in a resolver on a field where the type is decorated with "sqlTable".'
  )

  // make sure each "sqlDep" is only specified once at each level. also assign it an alias
  pruneDuplicateSqlDeps(sqlAST, namespace)

  return sqlAST
}

export function populateASTNode(queryASTNode, parentTypeNode, sqlASTNode, namespace, depth, options, context) {
  // first, get the name of the field being queried
  const fieldName = queryASTNode.name.value

  // if this is an internal field (say, for introspection "__typename"), lets ignore it
  if (/^__/.test(fieldName)) {
    sqlASTNode.type = 'noop'
    return
  }

  // then, get the field from the schema definition
  let field = parentTypeNode._fields[fieldName]
  if (!field) {
    throw new Error(`The field "${fieldName}" is not in the ${parentTypeNode.name} type.`)
  }

  let fieldIncludes
  if (idx(sqlASTNode, _ => _.parent.junction.include[fieldName])) {
    fieldIncludes = sqlASTNode.parent.junction.include[fieldName]
    field = {
      ...field,
      ...fieldIncludes
    }
    sqlASTNode.fromOtherTable = sqlASTNode.parent.junction.as
  }

  // allow for explicit ignoring of fields
  if (field.jmIgnoreAll) {
    sqlASTNode.type = 'noop'
    return
  }

  // this flag will keep track of whether multiple rows are needed
  let grabMany = false
  // the actual type might be wrapped in a GraphQLNonNull type
  let gqlType = stripNonNullType(field.type)

  sqlASTNode.args = getArgumentValues(field, queryASTNode, this.variableValues)

  // if list then mark flag true & get the type inside the GraphQLList container type
  if (gqlType.constructor.name === 'GraphQLList') {
    gqlType = stripNonNullType(gqlType.ofType)
    grabMany = true
  }

  // if its a relay connection, there are several things we need to do
  if (gqlType.constructor.name === 'GraphQLObjectType' && gqlType._fields.edges && gqlType._fields.pageInfo) {
    grabMany = true
    // grab the types and fields inside the connection
    const stripped = stripRelayConnection(gqlType, queryASTNode, this.fragments)
    // reassign those
    gqlType = stripNonNullType(stripped.gqlType)
    queryASTNode = stripped.queryASTNode
    // we'll set a flag for pagination.
    if (field.sqlPaginate) {
      sqlASTNode.paginate = true
    }
  } else if (field.sqlPaginate) {
    throw new Error(
      `To paginate the ${gqlType.name} type, it must be a GraphQLObjectType that fulfills the relay spec.
      The type must have a "pageInfo" and "edges" field. https://facebook.github.io/relay/graphql/connections.htm`
    )
  }
  // the typeConfig has all the keyes from the GraphQLObjectType definition
  const config = gqlType._typeConfig


  // is this a table in SQL?
  if (
    !field.jmIgnoreTable
    && TABLE_TYPES.includes(gqlType.constructor.name)
    && config.sqlTable
  ) {
    if (depth >= 1) {
      assert(!field.junctionTable, '"junctionTable" has been replaced with a new API.')
      assert(
        field.sqlJoin || field.sqlBatch || field.junction,
        `If an Object type maps to a SQL table and has a child which is another Object type that also maps to a SQL table,
        you must define "sqlJoin", "sqlBatch", or "junction" on that field to tell joinMonster how to fetch it.
        Or you can ignore it with "jmIgnoreTable". Check the "${fieldName}" field on the "${parentTypeNode.name}" type.`
      )
    }
    handleTable.call(this, sqlASTNode, queryASTNode, field, gqlType, namespace, grabMany, depth, options, context)
  // is this a computed column from a raw expression?
  } else if (field.sqlExpr) {
    sqlASTNode.type = 'expression'
    sqlASTNode.sqlExpr = field.sqlExpr
    let aliasFrom = sqlASTNode.fieldName = field.name
    if (sqlASTNode.defferedFrom) {
      aliasFrom += '@' + parentTypeNode.name
    }
    sqlASTNode.as = namespace.generate('column', aliasFrom)
  // Is it a foreign column with a foreign table (1-to-1 join)?
  } else if ((field.sqlForeignColumn || !field.resolve) && field.sqlForeignTable) {
    assert(options.dialect === 'pg', 'Foreign column is only supported for Postgres as it utilizes a LATERAL join.')
    sqlASTNode.type = 'foreign_column'
    sqlASTNode.sqlForeignTable = field.sqlForeignTable
    sqlASTNode.name = field.sqlForeignColumn || field.name
    let aliasFrom = sqlASTNode.fieldName = field.name
    if (sqlASTNode.defferedFrom) {
      aliasFrom += '@' + parentTypeNode.name
    }
    sqlASTNode.as = namespace.generate('column', aliasFrom)
  // is it just a column? if they specified a sqlColumn or they didn't define a resolver, yeah
  } else if (field.sqlColumn || !field.resolve) {
    sqlASTNode.type = 'column'
    sqlASTNode.name = field.sqlColumn || field.name
    let aliasFrom = sqlASTNode.fieldName = field.name
    if (sqlASTNode.defferedFrom) {
      aliasFrom += '@' + parentTypeNode.name
    }
    sqlASTNode.as = namespace.generate('column', aliasFrom)
  // or maybe it just depends on some SQL columns
  } else if (field.sqlDeps) {
    sqlASTNode.type = 'columnDeps'
    sqlASTNode.names = field.sqlDeps
  // maybe this node wants no business with your SQL, because it has its own resolver
  } else {
    sqlASTNode.type = 'noop'
  }
}

function handleTable(sqlASTNode, queryASTNode, field, gqlType, namespace, grabMany, depth, options, context) {
  const config = gqlType._typeConfig

  sqlASTNode.type = 'table'
  const sqlTable = unthunk(config.sqlTable, sqlASTNode.args || {}, context)
  sqlASTNode.name = sqlTable

  // the graphQL field name will be the default alias for the table
  // if thats taken, this function will just add an underscore to the end to make it unique
  sqlASTNode.as = namespace.generate('table', field.name)

  if (field.orderBy && !sqlASTNode.orderBy) {
    sqlASTNode.orderBy = handleOrderBy(unthunk(field.orderBy, sqlASTNode.args || {}, context))
  }

  // tables have child fields, lets push them to an array
  const children = sqlASTNode.children = sqlASTNode.children || []

  sqlASTNode.fieldName = field.name
  sqlASTNode.grabMany = grabMany

  if (field.where) {
    sqlASTNode.where = field.where
  }

  /*
   * figure out if they are doing one-to-many/many-to-many or join/batch
   * and collect the relevant info
   */

  // are they doing a one-to-many sql join?
  if (field.sqlJoin) {
    sqlASTNode.sqlJoin = field.sqlJoin
  // or a many-to-many?
  } else if (field.junction) {
    const junctionTable = unthunk(ensure(field.junction, 'sqlTable'), sqlASTNode.args || {}, context)
    const junction = sqlASTNode.junction = {
      sqlTable: junctionTable,
      as: namespace.generate('table', junctionTable)
    }
    if (field.junction.include) {
      junction.include = unthunk(field.junction.include, sqlASTNode.args || {}, context)
    }

    if (field.junction.orderBy) {
      junction.orderBy = handleOrderBy(unthunk(field.junction.orderBy, sqlASTNode.args || {}, context))
    }

    if (field.junction.where) {
      junction.where = field.junction.where
    }
    // are they joining or batching?
    if (field.junction.sqlJoins) {
      junction.sqlJoins = field.junction.sqlJoins
    } else if (field.junction.sqlBatch) {
      children.push({
        ...keyToASTChild(ensure(field.junction, 'uniqueKey'), namespace),
        fromOtherTable: junction.as
      })
      junction.sqlBatch = {
        sqlJoin: ensure(field.junction.sqlBatch, 'sqlJoin'),
        thisKey: {
          ...columnToASTChild(ensure(field.junction.sqlBatch, 'thisKey'), namespace),
          fromOtherTable: junction.as
        },
        parentKey: columnToASTChild(ensure(field.junction.sqlBatch, 'parentKey'), namespace)
      }
    } else {
      throw new Error('junction requires either a `sqlJoins` or `sqlBatch`')
    }
  // or are they doing a one-to-many with batching
  } else if (field.sqlBatch) {
    sqlASTNode.sqlBatch = {
      thisKey: columnToASTChild(ensure(field.sqlBatch, 'thisKey'), namespace),
      parentKey: columnToASTChild(ensure(field.sqlBatch, 'parentKey'), namespace)
    }
  }

  if (field.limit) {
    assert(field.orderBy, '`orderBy` is required with `limit`')
    sqlASTNode.limit = unthunk(field.limit, sqlASTNode.args || {}, context)
  }

  if (sqlASTNode.paginate) {
    getSortColumns(field, sqlASTNode, context)
  }

  /*
   * figure out the necessary children. this includes the columns join monster needs, the ones the user needs,
   * and finding out how to map those to the field names
   */

  // the NestHydrationJS library only treats the first column as the unique identifier, therefore we
  // need whichever column that the schema specifies as the unique one to be the first child
  children.push(keyToASTChild(ensure(config, 'uniqueKey'), namespace))

  if (config.alwaysFetch) {
    for (let column of wrap(config.alwaysFetch)) {
      children.push(columnToASTChild(unthunk(column, sqlASTNode.as, sqlASTNode.args || {}, context, sqlASTNode), namespace))
    }
  }

  // this was created for helping resolve types in union types
  // its been generalized to `alwaysFetch`, as its a useful feature for more than just unions
  if (config.typeHint && [ 'GraphQLUnionType', 'GraphQLInterfaceType' ].includes(gqlType.constructor.name)) {
    deprecate('`typeHint` is deprecated. Use `alwaysFetch` instead.')
    children.push(columnToASTChild(config.typeHint, namespace))
  }

  // go handle the pagination information
  if (sqlASTNode.paginate) {
    handleColumnsRequiredForPagination(sqlASTNode, namespace)
  }

  if (queryASTNode.selectionSet) {
    if (gqlType.constructor.name === 'GraphQLUnionType' || gqlType.constructor.name === 'GraphQLInterfaceType') {
      // union types have special rules for the child fields in join monster
      sqlASTNode.type = 'union'
      sqlASTNode.typedChildren = {}
      handleUnionSelections.call(
        this, sqlASTNode, children,
        queryASTNode.selectionSet.selections, gqlType, namespace,
        depth, options, context
      )
    } else {
      handleSelections.call(
        this, sqlASTNode, children,
        queryASTNode.selectionSet.selections, gqlType, namespace,
        depth, options, context
      )
    }
  }
}

// we need to collect all fields from all the fragments requested in the union type and ask for them in SQL
function handleUnionSelections(
  sqlASTNode,
  children,
  selections,
  gqlType,
  namespace,
  depth,
  options,
  context,
  internalOptions = {}
) {
  for (let selection of selections) {
    // we need to figure out what kind of selection this is
    switch (selection.kind) {
    case 'Field':
      // has this field been requested once already? GraphQL does not protect against duplicates so we have to check for it
      const existingNode = children.find(child => child.fieldName === selection.name.value && child.type === 'table')
      let newNode = new SQLASTNode(sqlASTNode)
      if (existingNode) {
        newNode = existingNode
      } else {
        children.push(newNode)
      }
      if (internalOptions.defferedFrom) {
        newNode.defferedFrom = internalOptions.defferedFrom
      }
      populateASTNode.call(this, selection, gqlType, newNode, namespace, depth + 1, options, context)
      break
    // if its an inline fragment, it has some fields and we gotta recurse thru all them
    case 'InlineFragment':
      {
        const selectionNameOfType = selection.typeCondition.name.value
        // normally, we would scan for the extra join-monster data on the current gqlType.
        // but the gqlType is the Union. The data isn't there, its on each of the types that make up the union
        // lets find that type and handle the selections based on THAT type instead
        const deferredType = this.schema._typeMap[selectionNameOfType]
        const deferToObjectType = deferredType.constructor.name === 'GraphQLObjectType'
        const handler = deferToObjectType ? handleSelections : handleUnionSelections
        if (deferToObjectType) {
          const typedChildren = sqlASTNode.typedChildren
          children = typedChildren[deferredType.name] = typedChildren[deferredType.name] || []
          internalOptions.defferedFrom = gqlType
        }
        handler.call(
          this, sqlASTNode, children,
          selection.selectionSet.selections, deferredType, namespace,
          depth, options, context,
          internalOptions
        )
      }
      break
    // if its a named fragment, we need to grab the fragment definition by its name and recurse over those fields
    case 'FragmentSpread':
      {
        const fragmentName = selection.name.value
        const fragment = this.fragments[fragmentName]
        const fragmentNameOfType = fragment.typeCondition.name.value
        const deferredType = this.schema._typeMap[fragmentNameOfType]
        const deferToObjectType = deferredType.constructor.name === 'GraphQLObjectType'
        const handler = deferToObjectType ? handleSelections : handleUnionSelections
        if (deferToObjectType) {
          const typedChildren = sqlASTNode.typedChildren
          children = typedChildren[deferredType.name] = typedChildren[deferredType.name] || []
          internalOptions.defferedFrom = gqlType
        }
        handler.call(
          this, sqlASTNode, children,
          fragment.selectionSet.selections, deferredType, namespace,
          depth, options, context,
          internalOptions
        )
      }
      break
    /* istanbul ignore next */
    default:
      throw new Error('Unknown selection kind: ' + selection.kind)
    }
  }
}

// the selections could be several types, recursively handle each type here
function handleSelections(
  sqlASTNode,
  children,
  selections,
  gqlType,
  namespace,
  depth,
  options,
  context,
  internalOptions = {},
) {
  for (let selection of selections) {
    // we need to figure out what kind of selection this is
    switch (selection.kind) {
    // if its another field, recurse through that
    case 'Field':
      // has this field been requested once already? GraphQL does not protect against duplicates so we have to check for it
      const existingNode = children.find(child => child.fieldName === selection.name.value && child.type === 'table')
      let newNode = new SQLASTNode(sqlASTNode)
      if (existingNode) {
        newNode = existingNode
      } else {
        children.push(newNode)
      }
      if (internalOptions.defferedFrom) {
        newNode.defferedFrom = internalOptions.defferedFrom
      }
      populateASTNode.call(this, selection, gqlType, newNode, namespace, depth + 1, options, context)
      break
    // if its an inline fragment, it has some fields and we gotta recurse thru all them
    case 'InlineFragment':
      {
        // check to make sure the type of this fragment (or one of the interfaces it implements) matches the type being queried
        const selectionNameOfType = selection.typeCondition.name.value
        const sameType = selectionNameOfType === gqlType.name
        const interfaceType = (gqlType._interfaces || []).map(iface => iface.name).includes(selectionNameOfType)
        if (sameType || interfaceType) {
          handleSelections.call(
            this, sqlASTNode, children,
            selection.selectionSet.selections, gqlType, namespace,
            depth, options, context,
            internalOptions
          )
        }
      }
      break
    // if its a named fragment, we need to grab the fragment definition by its name and recurse over those fields
    case 'FragmentSpread':
      {
        const fragmentName = selection.name.value
        const fragment = this.fragments[fragmentName]
        // make sure fragment type (or one of the interfaces it implements) matches the type being queried
        const fragmentNameOfType = fragment.typeCondition.name.value
        const sameType = fragmentNameOfType === gqlType.name
        const interfaceType = gqlType._interfaces.map(iface => iface.name).indexOf(fragmentNameOfType) >= 0
        if (sameType || interfaceType) {
          handleSelections.call(
            this, sqlASTNode, children,
            fragment.selectionSet.selections, gqlType, namespace,
            depth, options, context,
            internalOptions
          )
        }
      }
      break
    /* istanbul ignore next */
    default:
      throw new Error('Unknown selection kind: ' + selection.kind)
    }
  }
}


// tell the AST we need a column that perhaps the user didnt ask for, but may be necessary for join monster to ID
// objects or associate ones across batches
function columnToASTChild(columnName, namespace) {
  return {
    type: 'column',
    name: columnName,
    fieldName: columnName,
    as: namespace.generate('column', columnName)
  }
}

// generate a name for a composite key based on the individual column names smashed together
// slice them to help prevent exceeding oracle's 30-char identifier limit
function toClumsyName(keyArr) {
  return keyArr.map(name => name.slice(0, 3)).join('#')
}

// keys are necessary for deduplication during the hydration process
// this will handle singular or composite keys
function keyToASTChild(key, namespace) {
  if (typeof key === 'string') {
    return columnToASTChild(key, namespace)
  }
  if (Array.isArray(key)) {
    const clumsyName = toClumsyName(key)
    return {
      type: 'composite',
      name: key,
      fieldName: clumsyName,
      as: namespace.generate('column', clumsyName)
    }
  }
}

function handleColumnsRequiredForPagination(sqlASTNode, namespace) {
  if (sqlASTNode.sortKey || idx(sqlASTNode, _ => _.junction.sortKey)) {
    const sortKey = sqlASTNode.sortKey || sqlASTNode.junction.sortKey
    assert(sortKey.order, '"sortKey" must have "order"')
    // this type of paging uses the "sort key(s)". we need to get this in order to generate the cursor
    for (let column of wrap(ensure(sortKey, 'key'))) {
      const newChild = columnToASTChild(column, namespace)
      // if this joining on a "through-table", the sort key is on the threw table instead of this node's parent table
      if (!sqlASTNode.sortKey) {
        newChild.fromOtherTable = sqlASTNode.junction.as
      }
      sqlASTNode.children.push(newChild)
    }
  } else if (sqlASTNode.orderBy || idx(sqlASTNode, _ => _.junction.orderBy)) {
    // this type of paging can visit arbitrary pages, so lets provide the total number of items
    // on this special "$total" column which we will compute in the query
    const newChild = columnToASTChild('$total', namespace)
    if (sqlASTNode.junction) {
      newChild.fromOtherTable = sqlASTNode.junction.as
    }
    sqlASTNode.children.push(newChild)
  }
}

// if its a connection type, we need to look up the Node type inside their to find the relevant SQL info
function stripRelayConnection(gqlType, queryASTNode, fragments) {
  // get the GraphQL Type inside the list of edges inside the Node from the schema definition
  const edgeType = stripNonNullType(gqlType._fields.edges.type)
  const strippedType = stripNonNullType(stripNonNullType(edgeType.ofType)._fields.node.type)
  // let's remember those arguments on the connection
  const args = queryASTNode.arguments
  // and then find the fields being selected on the underlying type, also buried within edges and Node
  const edges = spreadFragments(queryASTNode.selectionSet.selections, fragments, gqlType.name)
    .find(selection => selection.name.value === 'edges')
  if (edges) {
    queryASTNode = spreadFragments(edges.selectionSet.selections, fragments, gqlType.name)
      .find(selection => selection.name.value === 'node') || {}
  } else {
    queryASTNode = {}
  }
  // place the arguments on this inner field, so our SQL AST picks it up later
  queryASTNode.arguments = args
  return { gqlType: strippedType, queryASTNode }
}

function stripNonNullType(type) {
  return type.constructor.name === 'GraphQLNonNull' ? type.ofType : type
}

// go through and make sure se only ask for each sqlDep once per table
export function pruneDuplicateSqlDeps(sqlAST, namespace) {
  const childrenToLoopOver = []
  if (sqlAST.children) {
    childrenToLoopOver.push(sqlAST.children)
  }
  if (sqlAST.typedChildren) {
    childrenToLoopOver.push(...Object.values(sqlAST.typedChildren))
  }

  for (let children of childrenToLoopOver) {
    // keep track of all the dependent columns at this depth in a Set
    // use one Set per table. usually the table is the same. but sometimes they are pulling in data from
    // a junction table.
    const depsByTable = {}

    // loop thru each child which has "columnDeps", remove it from the tree, and add it to the set
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child.type === 'columnDeps') {
        const keyName = child.fromOtherTable || ''
        child.names.forEach(name => {
          if (!depsByTable[keyName]) {
            depsByTable[keyName] = new Set()
          }
          depsByTable[keyName].add(name)
        })
        children.splice(i, 1)
      // or if its another table, recurse on it
      } else if (child.type === 'table' || child.type === 'union') {
        pruneDuplicateSqlDeps(child, namespace)
      }
    }

    // now that we collected the "columnDeps", add them all to one node
    // the "names" property will put all the column names in an object as keys
    // the values of this object will be the SQL alias
    for (let table in depsByTable) {
      const newNode = new SQLASTNode(sqlAST, {
        type: 'columnDeps',
        names: {},
        fromOtherTable: table || null
      })
      depsByTable[table].forEach(name => {
        newNode.names[name] = namespace.generate('column', name)
      })
      children.push(newNode)
    }
  }
}


function getSortColumns(field, sqlASTNode, context) {
  if (field.sortKey) {
    sqlASTNode.sortKey = unthunk(field.sortKey, sqlASTNode.args || {}, context)
  }
  if (field.orderBy) {
    sqlASTNode.orderBy = handleOrderBy(unthunk(field.orderBy, sqlASTNode.args || {}, context))
  }
  if (field.junction) {
    if (field.junction.sortKey) {
      sqlASTNode.junction.sortKey = unthunk(field.junction.sortKey, sqlASTNode.args || {}, context)
    }
    if (field.junction.orderBy) {
      sqlASTNode.junction.orderBy = handleOrderBy(unthunk(field.junction.orderBy, sqlASTNode.args || {}, context))
    }
  }
  if (!sqlASTNode.sortKey && !sqlASTNode.orderBy) {
    if (sqlASTNode.junction) {
      if (!sqlASTNode.junction.sortKey && !sqlASTNode.junction.orderBy) {
        throw new Error('"sortKey" or "orderBy" required if "sqlPaginate" is true')
      }
    } else {
      throw new Error('"sortKey" or "orderBy" required if "sqlPaginate" is true')
    }
  }
  if (sqlASTNode.sortKey && idx(sqlASTNode, _ => _.junction.sortKey)) {
    throw new Error('"sortKey" must be on junction or main table, not both')
  }
  if (sqlASTNode.orderBy && idx(sqlASTNode, _ => _.junction.orderBy)) {
    throw new Error('"orderBy" must be on junction or main table, not both')
  }
}


// instead of fields, selections can be fragments, which is another group of selections
// fragments can be arbitrarily nested
// this function recurses through and gets the relevant fields
function spreadFragments(selections, fragments, typeName) {
  return flatMap(selections, selection => {
    switch (selection.kind) {
    case 'FragmentSpread':
      const fragmentName = selection.name.value
      const fragment = fragments[fragmentName]
      return spreadFragments(fragment.selectionSet.selections, fragments, typeName)
    case 'InlineFragment':
      if (selection.typeCondition.name.value === typeName) {
        return spreadFragments(selection.selectionSet.selections, fragments, typeName)
      }
      return []

    default:
      return selection
    }
  })
}

export function handleOrderBy(orderBy) {
  if (!orderBy) return undefined
  const orderColumns = {}
  if (typeof orderBy === 'object') {
    for (let column in orderBy) {
      let direction = orderBy[column].toUpperCase()
      if (direction !== 'ASC' && direction !== 'DESC') {
        throw new Error(direction + ' is not a valid sorting direction')
      }
      orderColumns[column] = direction
    }
  } else if (typeof orderBy === 'string') {
    orderColumns[orderBy] = 'ASC'
  } else {
    throw new Error('"orderBy" is invalid type: ' + inspect(orderBy))
  }
  return orderColumns
}

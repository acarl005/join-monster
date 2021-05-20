### v3.0.2 (April 4, 2021)

#### Fixed

- Fix apollo-server null issue due to missing columns [#444](https://github.com/join-monster/join-monster/pull/444)

### v3.0.0

**Breaking changes:**

- Update GraphQL requirement to version 15, which supports a new `extensions` property where join-monster config lives. The config keys and values are largely unchanged, but now they must be nested under an `extensions: { joinMonster: ... }}` property on the GraphQLObjectTypes and fields using join-monster. To upgrade, you must move any non-standard keys off of your `GraphQLObjectType`s or field configs into the `extensions` of the same field. So, something like this:

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  sqlTable: 'users',
  uniqueKey: 'id',
  fields: () => ({
    id: {
      type: GraphQLInt
    },
    email: {
      type: GraphQLString,
      sqlColumn: 'email_address'
    },
  })
}
```

becomes this:

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: 'users',
      uniqueKey: 'id'
    }
  },
  fields: () => ({
    id: {
      type: GraphQLInt
    },
    email: {
      type: GraphQLString,
      extensions: {
        joinMonster: {
          sqlColumn: 'email_address'
        }
      }
    }
  })
}
```

The resulting code is sadly more verbose, but the only supported way of layering in extra information to a GraphQL schema going forward, and safer in the presence of other GraphQL schema extensions.

**Note**: There are two configuration keys which have changed beyond just becoming nested in the `extensions` property:

- `jmIgnoreAll` has been renamed to `ignoreAll`
- `jmIgnoreTable` has been renamed to `ignoreTable`

The old names for these configuration options will no longer work so please be sure to update.

**New features:**

- Add support for explicit `orderBy` column orderings by passing an array of `{ column, direction }` objects. Useful for dynamically generating `orderBy`s without relying on object insertion order. Example:

```javascript
const User = new GraphQLObjectType({
  fields: () => ({
    comments: {
      type: new GraphQLList(Comment),
      extensions: {
        joinMonster: {
          // order these alphabetically, then by "id" if the comment body is the same
          orderBy: [
            { column: 'body', direction: 'asc' },
            { column: 'id', direction: 'desc' }
          ],
          sqlJoin: (userTable, commentTable, args) =>
            `${userTable}.id = ${commentTable}.author_id`
        }
      }
    }
  })
})
```

- Similarly, add support for explicit `sortKey` column orderings by passing an array of `{ column, direction }` objects. Useful for dynamically generating `sortKey`s for connection pagination without relying on object insertion order. Example:

```javascript
const User = new GraphQLObjectType({
  fields: () => ({
    posts: {
      description: 'A list of Posts the user has written',
      type: PostConnection,
      args: connectionArgs,
      extensions: {
        joinMonster: {
          sqlPaginate: true,
          sortKey: [
            { column: 'created_at', direction: 'desc' },
            { column: 'id', order: 'desc' }
          ],
          sqlJoin: (userTable, postTable) =>
            `${userTable}.id = ${postTable}.author_id`
        }
      }
    }
  })
})
```

The old `sortKey` synax (as an object looking like `{key, order}`) continues to work but is no longer recommended. The new syntax allows for reliable sortKey ordering as well as independent directions per sort key, with all the complicated SQL generation handled for you.

- Add support for resolving GraphQL scalars backed by `sqlTable`s. Usually, scalars point to table columns, but this allows them to use the same `extensions` property to declare that the scalar is a whole table. This is often paired with a `resolve` function that takes what `join-monster` returns and turns it into a valid value for the scalar. An example would be a tags field that outputs a list of strings, but where each tag is actually stored as it's own row in a different table in the database, or backing a `JSONScalar` by a table to get around GraphQL's type strictness.

```javascript
export const Tag = new GraphQLScalarType({
  name: 'Tag',
  extensions: {
    joinMonster: {
      sqlTable: 'tags',
      uniqueKey: 'id',
      alwaysFetch: ['id', 'tag', 'tag_order']
    }
  },
  parseValue: String,
  serialize: String,
  parseLiteral(ast) {
    // ...
  }
})
```

### v2.1.2 (May 25, 2020)

#### Fixed

- Connections inside union fragments [#407](https://github.com/join-monster/join-monster/pull/407)

### v2.1.1 (Nov. 21, 2019)

#### Fixed

- Updated vulnerable version of lodash (`eed0264`)

### v2.1.0 (Aug. 25, 2018)

- Numerous bug fixes
- TypeScript type definitions
- New 'mysql8' dialect which supports some pagination

### v2.0.13 (Sep. 4, 2017)

- Don't write to debug module unless it's actually enabled.

### v2.0.9 (Aug. 23, 2017)

- Properly format instances of Buffer.

### v2.0.8 (Aug. 16, 2017)

- Support duplicate fields without aliases off the query root type.

### v2.0.6 (Aug. 11, 2017)

- Add SQL AST node to sqlJoin callback signature.

### v2.0.5 (Aug. 11, 2017)

- Remove the use of `Proxy` to improve compatibility.

### v2.0.4 (Aug. 8, 2017)

- Add option for custom dialect modules.
- Various bug fixes.

### v2.0.0 (Jun. 25, 2017)

**New features:**

- `LIMIT` functionality, supported on all fields.
- Fetch columns from junction tables.
- For fields with junctions, you can now specify `WHERE` and `ORDER BY` clauses on the junction table or the main table, including paginated fields.
- Ability to dynamically choose pagination implementation per-request.
- Better ability to write `where` functions that depend on args and info from the parent/ancestors.

**Breaking changes:**

- Fields with junctions have a new interface in order to support the new features.
- Any `where`, `orderBy`, and `sortKey` on many-to-many paginated fields used to be applied to the junction table. This has changed, and will be applied to the main table instead in order to be consistent with non-paginated junctions. If the old behavior is desired, you can nest those properties inside the `junction` object, which is part of the new API.
- Change 4th parameter of `where` and `sqlExpr` to the field's SQL AST Node, which is a lot more useful.

```js
// this...
{
  type: new GraphQLList(User),
  junctionTable: 'relationships',
  sqlJoins: [
    (followers, relations) => `${followers}.id = ${relations}.follower_id`,
    (relations, followees) => `${relations}.followee_id = ${followees}.id`
  ]
}

// is now this...
{
  type: new GraphQLList(User),
  junction: {
    sqlTable: 'relationships',
    sqlJoins: [
      (followers, relations) => `${followers}.id = ${relations}.follower_id`,
      (relations, followees) => `${relations}.followee_id = ${followees}.id`
    ]
  }
}
```

```js
// this...
{
  type: new GraphQLList(User),
  junctionTable: 'relationships',
  junctionTableKey: [ 'follower_id', 'followee_id' ],
  junctionBatch: {
    thisKey: 'follower_id',
    parentKey: 'id',
    sqlJoin: (relations, followees) => `${relations}.followee_id = ${followees}.id`
  }
}

// is now this...
{
  type: new GraphQLList(User),
  junction: {
    sqlTable: 'relationships',
    uniqueKey: [ 'follower_id', 'followee_id' ],
    sqlBatch: {
      thisKey: 'follower_id',
      parentKey: 'id',
      sqlJoin: (relations, followees) => `${relations}.followee_id = ${followees}.id`
    }
  }
}
```

```js
// this...
{
  type: UserConnection,
  args: forwardConnectionArgs,
  sqlPaginate: true,
  orderBy: {
    created_at: 'DESC',
    followee_id: 'ASC'
  },
  junctionTable: 'relationships',
  sqlJoins: [
    (followers, relations) => `${followers}.id = ${relations}.follower_id`,
    (relations, followees) => `${relations}.followee_id = ${followees}.id`
  ]
}

// is now this...
{
  type: UserConnection,
  args: forwardConnectionArgs,
  sqlPaginate: true,
  junction: {
    sqlTable: 'relationships',
    sqlJoins: [
      (followers, relations) => `${followers}.id = ${relations}.follower_id`,
      (relations, followees) => `${relations}.followee_id = ${followees}.id`
    ],
    // the order now goes inside the `junction` if you want to sort on the junction table
    orderBy: {
      created_at: 'DESC',
      followee_id: 'ASC'
    }
  }
  // or you could apply the order on the user table by putting it out here
  //orderBy: {
  //  created_at: 'DESC',
  //  id: 'ASC'
  //}

  // you could also place a `where` at either
}
```

### v1.2.1 (Mar. 28, 2017)

- Add `jmIgnoreAll` and `jmIgnoreTable`.
- Make `sqlTable` a thunk.
- Bug fix with recursively nested union and interface type fragments.
- Bug fix with for batch on a single-type parent.

### v1.2.0 (Mar. 16, 2017)

- Add an API for GraphQLInterfaceType

### v1.1.1 (Mar. 13, 2017)

- Add an API for GraphQLUnionType

### v1.1.0 (Mar. 11, 2017)

- Add Oracle as supported dialect.

### v1.0.1 (Mar. 8, 2017)

- Add `ORDER BY` support for non-paginated fields.

### v1.0.0 (Feb. 28, 2017)

- Batching capabilities added.
- MariaDB can do pagination on batches.
- `sqlExpr` can now be asynchronous.
- Remove unecessary "AS" from table alias in generated SQL.

**Breaking changes:**

- `getSQL` method removed. No longer makes sense in he new multiple-query paradigm.
- Offset pagination adds the `total` to the connection object instead of the `pageInfo`.

**Deprecated:**

- `joinTable` is deprecated. It was renamed to `junctionTable` to avoid over-use of the word "join".
- `'standard'` dialect is deprecated because nothing really implements the standard. The new default is `'sqlite3'`.

### v0.9.10 (Feb. 16, 2017)

- Bug fixes with recursive fragments and argument parsing.

### v0.9.9 (Feb. 3, 2017)

- Add `context` to the `sqlJoin` parameters.
- Support async in `sqlJoin`.

### v0.9.8 (Feb. 2, 2017)

- Expose parent table aliases to `where` function.

### v0.9.5 (Jan. 24, 2017)

- Fix bug for Postgres where `CONCAT` returns `''` instead of `NULL`.

### v0.9.4 (Jan. 22, 2017)

- Expose GraphQL args to `sqlJoin` function.

### v0.9.3 (Jan. 14, 2017)

- Add support for fragments on interface types.

### v0.9.2 (Jan. 5, 2017)

- Fix bug when composite keys contain timestamps or dates in PG dialect.
- Patch SQL injection risk.

### v0.9.0 (Jan. 4, 2017)

- More automatic fetching using `getNode` implemented.

### v0.8.0 (Dec. 19, 2016)

- Expose the `getSQL` method for getting only the converted SQL.

### v0.7.0 (Dec. 16, 2016)

- Introducing raw SQL expressions for computed columns.

### v0.6.0 (Dec. 2, 2016)

- Support asynchronicity in the `where` function.

### v0.5.8 (Dec. 1, 2016)

- Add null check to node interface handler.

### v0.5.7 (Nov. 29, 2016)

- Fix bug with `WHERE` conditions on paginated fields.

### v0.5.6 (Nov. 14, 2016)

- Fix bug with query variables on the Node interface.

### v0.5.5 (Nov. 13, 2016)

- Add support for dynamic sort keys on paginated fields. Sort keys can now be functions that receive the GraphQL arguments.

### v0.5.4 (Nov. 10, 2016)

- Add support for query variables.

### v0.5.2 (Nov. 6, 2016)

- Relay connection type names are no longer required to end with "Connection".

### v0.5.1 (Nov. 5, 2016)

- Fix problem with introspection queries.

### v0.5.0 (Nov. 4, 2016)

- Add dialect for MySQL/MariaDB.

### v0.4.1 (Oct 21, 2016)

- Fix bug with de-duplication of objects.

### v0.4.0 (Oct 20, 2016)

- Add Postgres dialect option.
- Support SQL pagination based on integer offsets.
- Support SQL pagination based on a sort key(s).

### v0.3.7 (Oct 16, 2016)

- Fix bug with nested fragments.

### v0.3.6 (Oct 13, 2016)

- Option to minify the raw data column names.

### v0.3.5 (Oct 9, 2016)

- Add test coverage tools.

### v0.3.4 (Oct 6, 2016)

- Add helper method for getting data for Relay's Node type.
- Fix bug with Union and Interface types.

### v0.3.2 (Oct 5, 2016)

- Add support for specifying schema names for your SQL tables.

### v0.3.1 (Oct 4, 2016)

- Detect Relay connection type and fetch data for it.

### v0.3.0 (Oct 3, 2016)

- Unique keys required for every table. Necessary for achieving good performance during object shaping/nesting.
- Composite keys supported for the unique key.

## Specify the SQL Table and Its Unique Key

We'll add a couple of properties to the `GraphQLObjectType` definition on `User`. Our users data lives in the `accounts` table, so we'll set the ([thunked](/API/#thunk)) `sqlTable` property to `'accounts'`.

We also need a unique identifier so it's unambiguous which objects are distinct entities and which were duplicated due to a join. Our `accounts` table has a primary key, the `'id'`, so we'll set that as the `uniqueKey` property. The `uniqueKey` does not need to have any constraints in the actual database. It's up to you to make sure no duplicate values exist in whichever column you indicate as being unique.

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: 'accounts', // the SQL table for this object type is called "accounts"
      uniqueKey: 'id' // id is different for every row
    }
  },
  fields: () => ({
    /*...*/
  })
})
```

## Table Name Details

If your table is on a SQL schema that is not the default, e.g. `public`, you can specify it in `sqlTable` with a dot separator. You must escape any characters that need to be escaped for your particular SQL database. For example, in SQLite3 or PostgreSQL, names that include characters other than **a-z**, **#**, and **$** (for example capital letters) must be wrapped in double quotes. In MySQL/MariaDB, you would use backticks.

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: 'public."Accounts"', // the SQL table is on the schema "public" called "Accounts"
      uniqueKey: 'id'
    }
  },
  fields: () => ({
    /*...*/
  })
})
```

The `sqlTable` can generalize to any **table expression**. Instead of a physical table, it could be a VIEW or a *derived table*.

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: '(SELECT * FROM accounts WHERE active = 1)', // this can be an expression that generates a TABLE
      uniqueKey: 'id'
    }
  },
  fields: () => ({
    /*...*/
  })
})
```

This can be a useful technique if you data *isn't actually modelled like Join Monster expects*.
Placing VIEWs on top of your SQL tables is a good way to achieve logical data independence.

The `sqlTable` can also be a function, i.e. a *thunk*.

## Composite Keys

If no single column in your table is unique, that's okay. Perhaps you have a **composite key**, where the combined value of multiple column is unique for each row.

| generation | first_name | last_name |
| ---------- | ---------- | --------- |
| 1          | erlich     | bachman   |
| 1          | andrew     | bachman   |
| 2          | erlich     | bachman   |
| 2          | matt       | bachman   |
| 1          | matt       | daemon    |

Just make `uniqueKey` an array of string instead of a string. Join Monster will use the SQL `||` operator or the `CONCAT` function to concatenate the values of those columns and identify the row based on the combination.

```javascript
const User = new GraphQLObjectType({
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: 'accounts',
      uniqueKey: ['generation', 'first_name', 'last_name']
    }
  },
  fields: () => ({
    /*...*/
  })
})
```

## Using scalars instead of objects

Rarely, you may have a value in your GraphQL API that's best represented as a scalar value instead of an object with fields, like a special string or a JSON scalar. `GraphQLScalar`s can also be extended such that `join-monster` will retrieve them using SQL joins or batches.

As an example, we could set up a `Post` object, powered by a `posts` table, that has a `tags` field which is powered by a whole other `tags` table. The `Tag` scalar might be a custom `GraphQLScalar` like so:

```javascript
const Tag = new GraphQLScalarType({
  name: 'Tag',
  extensions: {
    joinMonster: {
      sqlTable: 'tags',
      uniqueKey: 'id',
      alwaysFetch: ['id', 'tag_name']
    }
  },
  parseValue: String,
  serialize: String,
  parseLiteral(ast) {
    // ...
  }
})
```

which configures `join-monster` to fetch tags from the `tags` table, and to always fetch the `tag_name` column.

The `Post` object can then join `Tag`s just like any other `join-monster` powered object, using either a connection or a plain `GraphQLList`. See the section on [joins](/start-joins) for more details.

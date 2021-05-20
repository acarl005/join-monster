import { GraphQLInt, GraphQLScalarType, Kind } from 'graphql'
import { q } from '../shared'
import { connectionDefinitions } from 'graphql-relay'
const { PAGINATE, DB } = process.env

// This is to test Scalars being extended with join-monster properties and is not a great way to actually model tags
export const Tag = new GraphQLScalarType({
  name: 'Tag',
  description: 'Custom scalar representing a tag',
  extensions: {
    joinMonster: {
      sqlTable: `(SELECT * FROM ${q('tags', DB)})`,
      uniqueKey: 'id',
      alwaysFetch: ['id', 'tag', 'tag_order']
    }
  },
  parseValue: String,
  serialize: String,
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return ast.value
    }
    return null
  }
})

const connectionConfig = { nodeType: Tag }
if (PAGINATE === 'offset') {
  connectionConfig.connectionFields = {
    total: { type: GraphQLInt }
  }
}
const { connectionType: TagConnection } = connectionDefinitions(
  connectionConfig
)
export { TagConnection }

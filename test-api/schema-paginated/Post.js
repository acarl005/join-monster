import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList
} from 'graphql'

import {
  globalIdField,
  connectionDefinitions,
  connectionFromArray,
  connectionArgs,
  forwardConnectionArgs
} from 'graphql-relay'

import { User } from './User'
import { CommentConnection } from './Comment'
import { Tag, TagConnection } from './Tag'
import { Authored } from './Authored/Interface'
import { nodeInterface } from './Node'
import { q, bool } from '../shared'

const { PAGINATE, STRATEGY, DB } = process.env

export const Post = new GraphQLObjectType({
  description: 'A post from a user',
  name: 'Post',
  extensions: {
    joinMonster: {
      sqlTable: `(SELECT * FROM ${q('posts', DB)})`,
      uniqueKey: 'id'
    }
  },
  interfaces: () => [nodeInterface, Authored],
  fields: () => ({
    id: {
      ...globalIdField(),
      extensions: {
        joinMonster: {
          sqlDeps: ['id']
        }
      }
    },
    body: {
      description: 'The content of the post',
      type: GraphQLString
    },
    authorId: {
      type: GraphQLInt,
      extensions: {
        joinMonster: {
          sqlColumn: 'author_id'
        }
      }
    },
    author: {
      description: 'The user that created the post',
      type: User,
      extensions: {
        joinMonster: {
          ...(STRATEGY === 'batch'
            ? {
                sqlBatch: {
                  thisKey: 'id',
                  parentKey: 'author_id'
                }
              }
            : {
                sqlJoin: (postTable, userTable) =>
                  `${postTable}.${q('author_id', DB)} = ${userTable}.${q(
                    'id',
                    DB
                  )}`
              })
        }
      }
    },
    comments: {
      description: 'The comments on this post',
      type: CommentConnection,
      args: {
        active: { type: GraphQLBoolean },
        ...(PAGINATE === 'offset' ? forwardConnectionArgs : connectionArgs)
      },
      resolve: PAGINATE
        ? undefined
        : (post, args) => {
            post.comments.sort((a, b) => a.id - b.id)
            return connectionFromArray(post.comments, args)
          },
      extensions: {
        joinMonster: {
          sqlPaginate: !!PAGINATE,
          ...do {
            if (PAGINATE === 'offset') {
              ;({ orderBy: 'id' })
            } else if (PAGINATE === 'keyset') {
              ;({
                sortKey: {
                  order: 'DESC',
                  key: 'id'
                }
              })
            } else {
              {
              }
            }
          },
          ...do {
            if (STRATEGY === 'batch' || STRATEGY === 'mix') {
              ;({
                sqlBatch: {
                  thisKey: 'post_id',
                  parentKey: 'id'
                },
                where: (table, args) =>
                  args.active
                    ? `${table}.${q('archived', DB)} = ${bool(false, DB)}`
                    : null
              })
            } else {
              ;({
                sqlJoin: (postTable, commentTable, args) =>
                  `${commentTable}.${q('post_id', DB)} = ${postTable}.${q(
                    'id',
                    DB
                  )} ${
                    args.active
                      ? `AND ${commentTable}.${q('archived', DB)} = ${bool(
                          false,
                          DB
                        )}`
                      : ''
                  }`
              })
            }
          }
        }
      }
    },
    numComments: {
      description: 'How many comments this post has',
      type: GraphQLInt,
      extensions: {
        joinMonster: {
          // you can info from a correlated subquery
          sqlExpr: table =>
            `(SELECT count(*) from ${q('comments', DB)} WHERE ${table}.${q(
              'id',
              DB
            )} = comments.${q('post_id', DB)})`
        }
      }
    },
    archived: {
      type: GraphQLBoolean
    },
    createdAt: {
      type: GraphQLString,
      extensions: {
        joinMonster: {
          sqlColumn: 'created_at'
        }
      }
    },
    tags: {
      type: new GraphQLList(Tag),
      resolve: source => {
        return source.tags.map(tag => tag.tag)
      },
      extensions: {
        joinMonster: {
          orderBy: 'tag_order',
          ...(STRATEGY === 'batch'
            ? {
                sqlBatch: {
                  thisKey: 'post_id',
                  parentKey: 'id'
                }
              }
            : {
                sqlJoin: (postTable, tagTable) =>
                  `${postTable}.${q('id', DB)} = ${tagTable}.${q(
                    'post_id',
                    DB
                  )}`
              })
        }
      }
    }
  })
})

const connectionConfig = { nodeType: Post }
if (PAGINATE === 'offset') {
  connectionConfig.connectionFields = {
    total: { type: GraphQLInt }
  }
}
const { connectionType: PostConnection } = connectionDefinitions(
  connectionConfig
)
export { PostConnection }

import {
  GraphQLObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean
} from 'graphql'

import { globalIdField } from 'graphql-relay'

import IntimacyLevel from '../enums/IntimacyLevel'
import Comment from './Comment'
import Post from './Post'
import Person from './Person'
import AuthoredInterface from './Authored/Interface'
import AuthoredUnion from './Authored/Union'
import { toBase64, q, bool } from '../shared'
import FilterInput from './filterInput'

const { STRATEGY, DB } = process.env

const User = new GraphQLObjectType({
  description: 'a stem contract account',
  name: 'User',
  extensions: {
    joinMonster: {
      sqlTable: () => q('accounts', DB),
      uniqueKey: 'id'
    }
  },
  interfaces: [Person],
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
    },
    idEncoded: {
      description: 'The ID base-64 encoded',
      type: GraphQLString,
      extensions: {
        joinMonster: {
          sqlColumn: 'id'
        }
      },
      resolve: user => toBase64(user.idEncoded)
    },
    globalId: {
      description: 'The global ID for the Relay spec',
      ...globalIdField('User'),
      extensions: {
        joinMonster: {
          sqlDeps: ['id']
        }
      }
    },
    fullName: {
      description: "A user's first and last name",
      type: GraphQLString,
      extensions: {
        joinMonster: {
          sqlDeps: ['first_name', 'last_name']
        }
      },
      resolve: user => `${user.first_name} ${user.last_name}`
    },
    capitalizedLastName: {
      description: 'The last name WITH CAPS LOCK',
      type: GraphQLString,
      extensions: {
        joinMonster: {
          sqlExpr: (table, args, context) =>
            `upper(${table}.${q('last_name', DB)})` // eslint-disable-line no-unused-vars
        }
      }
    },
    comments: {
      description: "Comments the user has written on people's posts",
      type: new GraphQLList(new GraphQLNonNull(Comment)),
      args: {
        active: {
          description: 'Get only comments not archived',
          type: GraphQLBoolean
        }
      },
      extensions: {
        joinMonster: {
          orderBy: { id: 'asc' },
          ...(['batch', 'mix'].includes(STRATEGY)
            ? {
                sqlBatch: {
                  thisKey: 'author_id',
                  parentKey: 'id'
                },
                where: (table, args) =>
                  args.active
                    ? `${table}.${q('archived', DB)} = ${bool(false, DB)}`
                    : null
              }
            : {
                sqlJoin: (userTable, commentTable, args) =>
                  `${commentTable}.${q('author_id', DB)} = ${userTable}.${q(
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
    },
    posts: {
      description: 'A list of Posts the user has written',
      type: new GraphQLList(Post),
      args: {
        active: {
          description: 'Get only posts not archived',
          type: GraphQLBoolean
        },
        filter: {
          type: FilterInput
        }
      },
      extensions: {
        joinMonster: {
          where: (table, args) =>
            args.active
              ? `${table}.${q('archived', DB)} = ${bool(false, DB)}`
              : null,
          orderBy: { body: 'desc' },
          ...(STRATEGY === 'batch'
            ? {
                sqlBatch: {
                  thisKey: 'author_id',
                  parentKey: 'id'
                }
              }
            : {
                sqlJoin: (userTable, postTable) =>
                  `${postTable}.${q('author_id', DB)} = ${userTable}.${q(
                    'id',
                    DB
                  )}`
              })
        }
      }
    },
    following: {
      description: 'Users that this user is following',
      type: new GraphQLList(User),
      args: {
        name: { type: GraphQLString },
        oldestFirst: { type: GraphQLBoolean },
        intimacy: { type: IntimacyLevel }
      },
      extensions: {
        joinMonster: {
          orderBy: 'first_name',
          where: (table, args) =>
            args.name
              ? `${table}.${q('first_name', DB)} = '${args.name}'`
              : false,
          junction: {
            sqlTable: q('relationships', DB),
            orderBy: args =>
              args.oldestFirst ? { followee_id: 'desc' } : null,
            where: (table, args) =>
              args.intimacy
                ? `${table}.${q('closeness', DB)} = '${args.intimacy}'`
                : false,
            include: {
              friendship: {
                sqlColumn: 'closeness',
                ignoreAll: false
              },
              intimacy: {
                sqlExpr: table => `${table}.${q('closeness', DB)}`,
                ignoreAll: false
              },
              closeness: {
                sqlDeps: ['closeness'],
                ignoreAll: false
              }
            },
            ...(['batch', 'mix'].includes(STRATEGY)
              ? {
                  uniqueKey: ['follower_id', 'followee_id'],
                  sqlBatch: {
                    thisKey: 'follower_id',
                    parentKey: 'id',
                    sqlJoin: (relationTable, followeeTable) =>
                      `${relationTable}.${q(
                        'followee_id',
                        DB
                      )} = ${followeeTable}.${q('id', DB)}`
                  }
                }
              : {
                  sqlJoins: [
                    (followerTable, relationTable) =>
                      `${followerTable}.${q('id', DB)} = ${relationTable}.${q(
                        'follower_id',
                        DB
                      )}`,
                    (relationTable, followeeTable) =>
                      `${relationTable}.${q(
                        'followee_id',
                        DB
                      )} = ${followeeTable}.${q('id', DB)}`
                  ]
                })
          }
        }
      }
    },
    friendship: {
      type: GraphQLString,
      extensions: {
        joinMonster: {
          ignoreAll: true
        }
      }
    },
    intimacy: {
      type: GraphQLString,
      extensions: {
        joinMonster: {
          ignoreAll: true
        }
      }
    },
    closeness: {
      type: GraphQLString,
      extensions: {
        joinMonster: {
          ignoreAll: true
        }
      }
    },
    favNums: {
      type: new GraphQLList(GraphQLInt),
      extensions: {
        joinMonster: {
          ignoreAll: true
        }
      },
      resolve: () => [1, 2, 3]
    },
    numLegs: {
      description: 'How many legs this user has',
      type: GraphQLInt,
      extensions: {
        joinMonster: {
          sqlColumn: 'num_legs'
        }
      }
    },
    numFeet: {
      description: 'How many feet this user has',
      type: GraphQLInt,
      extensions: {
        joinMonster: {
          sqlDeps: ['num_legs']
        }
      },
      resolve: user => user.num_legs
    },
    writtenMaterial1: {
      type: new GraphQLList(AuthoredUnion),
      extensions: {
        joinMonster: {
          orderBy: 'id',
          ...(STRATEGY === 'batch'
            ? {
                sqlBatch: {
                  thisKey: 'author_id',
                  parentKey: 'id'
                }
              }
            : {
                sqlJoin: (userTable, unionTable) =>
                  `${userTable}.${q('id', DB)} = ${unionTable}.${q(
                    'author_id',
                    DB
                  )}`
              })
        }
      }
    },
    writtenMaterial2: {
      type: new GraphQLList(AuthoredInterface),
      extensions: {
        joinMonster: {
          orderBy: 'id',
          ...(STRATEGY === 'batch'
            ? {
                sqlBatch: {
                  thisKey: 'author_id',
                  parentKey: 'id'
                }
              }
            : {
                sqlJoin: (userTable, unionTable) =>
                  `${userTable}.${q('id', DB)} = ${unionTable}.${q(
                    'author_id',
                    DB
                  )}`
              })
        }
      }
    }
  })
})

export default User

import * as graphql from 'graphql'
export type Maybe<T> = null | undefined | T

// Extend graphql objects and fields

export type SqlJoin<TContext, TArgs> = (
  table1: string,
  table2: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: any
) => string
export type Where<TContext, TArgs> = (
  usersTable: string,
  args: TArgs,
  context: TContext,
  sqlASTNode: any
) => string | void

export type Direction = 'ASC' | 'asc' | 'DESC' | 'desc'

export type OrderBy =
  | string
  | { column: string; direction: Direction }[]
  | { [key: string]: Direction }

export type SortKey =
  | { column: string; direction: Direction }[]
  | {
      order: Direction
      key: string | string[]
    } // this is the old, pre 3.0 style limited to one direction for many keys

export type ThunkWithArgsCtx<T, TContext, TArgs> =
  | ((args: TArgs, context: TContext) => T)
  | T

export interface ObjectTypeExtension<TSource, TContext> {
  alwaysFetch?: string | string[]
  sqlTable?: ThunkWithArgsCtx<string, any, TContext>
  uniqueKey?: string | string[]
}

export interface FieldConfigExtension<TSource, TContext, TArgs> {
  ignoreAll?: boolean
  ignoreTable?: boolean
  junction?: {
    include?: ThunkWithArgsCtx<
      {
        [column: string]: {
          sqlColumn?: string
          sqlExpr?: string
          sqlDeps?: string | string[]
        }
      },
      TContext,
      TArgs
    >
    orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>
    sortKey?: ThunkWithArgsCtx<SortKey, TContext, TArgs>
    sqlBatch?: {
      thisKey: string
      parentKey: string
      sqlJoin: SqlJoin<TContext, TArgs>
    }
    sqlJoins?: [SqlJoin<TContext, TArgs>, SqlJoin<TContext, TArgs>]
    sqlTable: ThunkWithArgsCtx<string, TContext, TArgs>
    uniqueKey?: string | string[]
    where?: Where<TContext, TArgs>
  }
  limit?: ThunkWithArgsCtx<number, TContext, TArgs>
  orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>
  sortKey?: ThunkWithArgsCtx<SortKey, TContext, TArgs>
  sqlBatch?: {
    thisKey: string
    parentKey: string
  }
  sqlColumn?: string
  sqlDeps?: string[]
  sqlExpr?: (
    table: string,
    args: TArgs,
    context: TContext,
    sqlASTNode: any
  ) => string
  sqlJoin?: SqlJoin<TContext, TArgs>
  sqlPaginate?: boolean
  where?: Where<TContext, TArgs>
}

export interface UnionTypeExtension {
  sqlTable?: ThunkWithArgsCtx<string, any, any>
  uniqueKey?: string | string[]
  alwaysFetch?: string | string[]
}

export interface InterfaceTypeExtension {
  sqlTable?: ThunkWithArgsCtx<string, any, any>
  uniqueKey?: string | string[]
  alwaysFetch?: string | string[]
}

export interface ScalarTypeExtension {
  sqlTable?: ThunkWithArgsCtx<string, any, any>
  uniqueKey?: string | string[]
  alwaysFetch?: string | string[]
}

declare module 'graphql' {
  interface GraphQLObjectTypeExtensions<_TSource = any, _TContext = any> {
    joinMonster?: ObjectTypeExtension<_TSource, _TContext>
  }
  interface GraphQLFieldExtensions<
    _TSource,
    _TContext,
    _TArgs = { [argName: string]: any }
  > {
    joinMonster?: FieldConfigExtension<_TSource, _TContext, _TArgs>
  }
  interface GraphQLUnionTypeExtensions {
    joinMonster?: UnionTypeExtension
  }
  interface GraphQLInterfaceTypeExtensions {
    joinMonster?: InterfaceTypeExtension
  }
  interface GraphQLScalarTypeExtensions {
    joinMonster?: ScalarTypeExtension
  }
}

// JoinMonster lib interface

interface DialectModule {
  name: string
}

type Dialect = 'pg' | 'oracle' | 'mariadb' | 'mysql' | 'mysql8' | 'sqlite3'
type JoinMonsterOptions = {
  minify?: boolean
  dialect?: Dialect
  dialectModule?: DialectModule
}

type Rows = any
type DbCallCallback = (
  sql: string,
  done: (err?: any, rows?: Rows) => void
) => void
type DbCallPromise = (sql: string) => Promise<Rows>

declare function joinMonster(
  resolveInfo: any,
  context: any,
  dbCall: DbCallCallback | DbCallPromise,
  options?: JoinMonsterOptions
): Promise<any>

export default joinMonster

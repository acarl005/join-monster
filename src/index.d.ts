
import * as graphql from 'graphql'

// Extend graphql objects and fields

declare module 'graphql/type/definition' {
  type SqlJoin<TContext, TArgs> = (table1: string, table2: string, args: TArgs, context: TContext, sqlASTNode: any) => string
  type Where<TContext, TArgs> = (usersTable: string, args: TArgs, context: TContext, sqlASTNode: any) => string | void
  type Order = 'ASC' | 'asc' | 'DESC' | 'desc'
  type OrderBy = string | { [key: string]: Order }
  type ThunkWithArgsCtx<T, TContext, TArgs> = ((args: TArgs, context: TContext) => T) | T;

  export interface GraphQLObjectTypeConfig<TSource, TContext> {
    alwaysFetch?: string
    sqlTable?: ThunkWithArgsCtx<string, any, TContext>
    uniqueKey?: string | string[]
  }

  export interface GraphQLFieldConfig<TSource, TContext, TArgs> {
    jmIgnoreAll?: boolean
    jmIgnoreTable?: boolean
    junction?: {
      include?: ThunkWithArgsCtx<{
        sqlColumn?: string
        sqlExpr?: string
        sqlDeps?: string | string[]
      }, TContext, TArgs>
      orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>
      sortKey?: ThunkWithArgsCtx<{
        order: Order
        key: string | string[]
      }, TContext, TArgs>
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
    limit?: ThunkWithArgsCtx<number, any, TContext>
    orderBy?: ThunkWithArgsCtx<OrderBy, TContext, TArgs>
    sortKey?: ThunkWithArgsCtx<{
      order: Order
      key: string | string[]
    }, TContext, TArgs>
    sqlBatch?: {
      thisKey: string
      parentKey: string
    }
    sqlColumn?: string
    sqlDeps?: string[]
    sqlExpr?: (table: string, args: TArgs, context: TContext, sqlASTNode: any) => string
    sqlJoin?: SqlJoin<TContext, TArgs>
    sqlForeignTable?: (table: string, args: TArgs, context: TContext, sqlASTNode: any) => string
    sqlForeignColumn?: string
    sqlPaginate?: boolean
    where?: Where<TContext, TArgs>
  }
}

export interface GraphQLUnionTypeConfig<TSource, TContext> {
  sqlTable?: string
  uniqueKey?: string | string[]
  alwaysFetch?: string
}

export interface GraphQLInterfaceTypeConfig<TSource, TContext> {
  sqlTable?: string
  uniqueKey?: string | string[]
  alwaysFetch?: string
}

// JoinMonster lib interface

interface DialectModule { name: string }

type Dialect = 'pg' | 'oracle' | 'mariadb' | 'mysql' | 'mysql8' | 'sqlite3'
type JoinMonsterOptions = { minify?: boolean, dialect?: Dialect, dialectModule?: DialectModule }

type Rows = any
type DbCallCallback = (sql:string, done: (err?: any, rows?: Rows) => void) => void
type DbCallPromise = (sql: string) => Promise<Rows>
type DbCall = DbCallCallback | DbCallPromise

declare function joinMonster(resolveInfo: any, context: any, dbCall: DbCallCallback | DbCallPromise, options?: JoinMonsterOptions) : Promise<any>

export default joinMonster

import test from 'ava'
import { graphql } from 'graphql'
import schemaRelay from '../test-api/schema-paginated/index'
import { partial } from 'lodash'
import { errCheck } from './_util'

const run = partial(graphql, schemaRelay)

test('it should get a scalar list and resolve it', async t => {
  const { data, errors } = await run(`
    query {
      post(id: 1) {
        id
        tags
      }
    }
  `)

  errCheck(t, errors)
  t.deepEqual(['foo', 'bar', 'baz'], data.post.tags)
})

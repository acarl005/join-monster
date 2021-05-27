import { GraphQLList, GraphQLNonNull, GraphQLString } from 'graphql'
import {
    GraphQLInputObjectType
} from 'graphql'

const FilterInput = new GraphQLInputObjectType({
    name: 'FilterInput',
    description: 'Filter input',
    fields: () => ({
        compare: {
            type: ComparisonInput,
        },
        AND: {
            type: GraphQLList(FilterInput)
        },
        OR: {
            type: GraphQLList(FilterInput)
        }
    })
})

const ComparisonInput = new GraphQLInputObjectType({
    name: 'ComparisonInput',
    fields: () => ({
        key: {
            type: GraphQLNonNull(GraphQLString)
        },
        operator: {
            type: GraphQLNonNull(GraphQLString)
        },
        value: {
            type: GraphQLNonNull(GraphQLString)
        }
    })
})

export default FilterInput;

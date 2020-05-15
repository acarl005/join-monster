import G from 'generatorics'

// this class is responsible for generating the aliases that appear in each SQL query
// this has different rules depending on whether we are aliasing a column or table and on whether we are minifying
export default class AliasNamespace {
  constructor(minify) {
    this.minify = !!minify

    // a generator for infinite alias names, starting with the shortest possible
    // this is helpful for generating the names when minifying
    this.mininym = G.baseNAll('abcdefghijklmnopqrstuvwxyz#$')

    // keep track of all the table names we've used since these have to be unique in each query
    this.usedTableAliases = new Set()

    // we can re-use aliases for columns since columns names dont need to be globally unique because they will be prefixed
    // this object will remember alias assignments for each column name so we can reuse them
    this.columnAssignments = {}
  }

  generate(type, name) {
    // if minifiying, make everything ugly and unique.
    if (this.minify) {
      // tables definitely all need unique names
      if (type === 'table') {
        return this.mininym.next().value.join('')
      }

      // but if its a column, we dont need to worry about the uniqueness from other columns
      // because the columns will get prefixed with the parent(s)
      if (!this.columnAssignments[name]) {
        this.columnAssignments[name] = this.mininym.next().value.join('')
      }

      return this.columnAssignments[name]
    }

    // otherwise, lets make it readable
    if (type === 'column') {
      return name
    }

    name = name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 10).toLocaleLowerCase()
    // the table aliases must be unique
    // just append a "$" until its a unique name
    while (this.usedTableAliases.has(name)) {
      name += '$'
    }
    this.usedTableAliases.add(name)
    return name
  }
}

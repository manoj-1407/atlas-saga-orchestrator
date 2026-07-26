
// Test DAG dependency resolution logic
function getLevel(name: string, steps: {name:string,dependsOn?:string[]}[]): number {
  const step = steps.find(s => s.name === name)
  if (!step || !step.dependsOn?.length) return 0
  return Math.max(...step.dependsOn.map(d => getLevel(d, steps))) + 1
}

describe('DAG level resolution', () => {
  const steps = [
    { name: 'a' },
    { name: 'b' },
    { name: 'c', dependsOn: ['a', 'b'] },
    { name: 'd', dependsOn: ['c'] },
    { name: 'e', dependsOn: ['a'] },
  ]

  it('root nodes are level 0', () => {
    expect(getLevel('a', steps)).toBe(0)
    expect(getLevel('b', steps)).toBe(0)
  })

  it('nodes with two parents are level 1', () => {
    expect(getLevel('c', steps)).toBe(1)
    expect(getLevel('e', steps)).toBe(1)
  })

  it('nodes with transitive deps get correct level', () => {
    expect(getLevel('d', steps)).toBe(2)
  })
})

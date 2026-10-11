import { WorkflowEngine } from '../packages/engine'
import type { StepDefinition } from '../packages/types'

/**
 * White-box (basis path) tests for the cycle-detection logic inside
 * WorkflowEngine.register().
 *
 * Flow graph of the logic under test (see docs/TESTING.md):
 *   decisions: D1 for-each dependency, D2 !visited.has(dep), D3 checkCycle(dep),
 *              D4 recStack.has(dep), D5 for-each stepDef, D6 !visited.has(stepDef),
 *              D7 checkCycle(stepDef)
 *   Cyclomatic complexity V(G) = 7 predicate nodes + 1 = 8 -> 8 independent paths.
 */
const step = (name: string, dependsOn: string[] = []): StepDefinition => ({
  name,
  dependsOn,
  async run() { return {} },
})

const reg = (steps: StepDefinition[]) => {
  const eng = new WorkflowEngine()
  return () => eng.register('bp', { name: 'BP', steps })
}

describe('register() cycle detection - basis path set (V(G) = 8)', () => {
  it('P1: no steps -> main loop never entered, registers', () => {
    expect(reg([])).not.toThrow()
  })

  it('P2: single step without dependencies -> inner loop never entered', () => {
    expect(reg([step('a')])).not.toThrow()
  })

  it('P3: linear chain a <- b -> unvisited dependency, recursion, no cycle', () => {
    expect(reg([step('b', ['a']), step('a')])).not.toThrow()
  })

  it('P4: diamond -> dependency already visited but not on recursion stack', () => {
    const steps = [step('d', ['b', 'c']), step('b', ['a']), step('c', ['a']), step('a')]
    expect(reg(steps)).not.toThrow()
  })

  it('P5: direct 2-cycle a <-> b is rejected', () => {
    expect(reg([step('a', ['b']), step('b', ['a'])])).toThrow(/Circular dependency/)
  })

  it('P6: self dependency is rejected', () => {
    expect(reg([step('a', ['a'])])).toThrow(/Circular dependency/)
  })

  it('P7: 3-cycle a -> b -> c -> a propagates true through the recursion', () => {
    const steps = [step('a', ['b']), step('b', ['c']), step('c', ['a'])]
    expect(reg(steps)).toThrow(/Circular dependency/)
  })

  it('P8: valid component first, cycle in a later component is still found', () => {
    const steps = [step('x'), step('y', ['x']), step('p', ['q']), step('q', ['p'])]
    expect(reg(steps)).toThrow(/Circular dependency/)
  })

  it('dependency on an unknown step name does not crash registration', () => {
    expect(reg([step('a', ['ghost'])])).not.toThrow()
  })
})
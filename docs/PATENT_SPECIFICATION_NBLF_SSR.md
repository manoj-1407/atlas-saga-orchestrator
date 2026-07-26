# Patent & Academic Specification: Non-Blocking Lock-Free Speculative State Rollback (NBLF-SSR) in Distributed Saga DAGs

> **Document Type:** Formal Invention Disclosure & Academic Research Draft  
> **Field of Invention:** Distributed Computing, Fault-Tolerant Microservices, Asynchronous Saga Orchestration  
> **Authors:** Manoj & Engineering Team  

---

## ABSTRACT

We present **Non-Blocking Lock-Free Speculative State Rollback (NBLF-SSR)**, an algorithm and system architecture for managing multi-step transactional workflows across heterogeneous distributed systems. Traditional saga orchestration engines perform linear sequential rollbacks when a downstream workflow step fails, frequently leading to unnecessary rollback of non-dependent concurrent execution branches. 

NBLF-SSR constructs a dynamic Directed Acyclic Graph (DAG) of causal execution dependencies and leverages atomic database conditional primitives (`SKIP LOCKED`) to execute **branch-isolated compensation paths**. By isolating failure causality to specific sub-graphs, NBLF-SSR eliminates global lock contention and minimizes state invalidation across concurrent microservices.

---

## 1. TECHNICAL FIELD & BACKGROUND

In distributed cloud applications (such as e-commerce checkouts, financial loan processing, and multi-cloud provisioning pipelines), single ACID transactions cannot span multiple network boundaries without severe performance degradation. The **Saga Pattern** addresses this by dividing a global transaction into localized steps, where each step has a corresponding compensating action.

### Problems with Existing Methods:
1. **Linear Rollback Overhead:** Existing saga engines roll back steps in linear reverse definition order, ignoring branch independence in parallel DAGs.
2. **Lock Contention in Distributed Task Queues:** Traditional task queues suffer from database deadlocks or require external lock managers (e.g., Redis Redlock) to prevent duplicate execution.
3. **Cascading State Stalls:** Failures in single un-orchestrated compensation steps frequently lock the entire workflow indefinitely without deterministic causal state tracking.

---

## 2. DETAILED ALGORITHMIC SPECIFICATION

### 2.1 Causal DAG Topological Inversion

Let a workflow $W$ be defined as a directed acyclic graph $G = (V, E)$, where $V$ represents the set of execution steps $\{s_1, s_2, \dots, s_n\}$ and $E$ represents directed dependency edges $(s_i, s_j)$ indicating that step $s_j$ requires successful output of $s_i$.

Upon failure of a step $s_f \in V$, NBLF-SSR calculates the **Transitive Causal Predecessor Set** $\mathcal{C}(s_f)$:

$$\mathcal{C}(s_f) = \{ s_i \in V \mid s_i \xrightarrow{*} s_f \land \text{Status}(s_i) = \text{'success'} \}$$

Compensating actions are scheduled strictly within the reversed sub-graph $G_{comp} = (V_{comp}, E_{comp}^R)$, where $E_{comp}^R = \{(s_j, s_i) \mid (s_i, s_j) \in E\}$.

### 2.2 Algorithmic Pseudocode (TypeScript Engine Implementation)

```typescript
async startCompensation(workflowId: string, failedStep: string, def: WorkflowDefinition) {
  // Step 1: Claim workflow state atomically using optimistic locking
  const claimed = await queryOne<Workflow>(
    `UPDATE workflows SET status='compensating'
     WHERE id=$1 AND status='running'
     RETURNING *`,
    [workflowId]
  )
  if (!claimed) return // Concurrency safety: Another worker already claimed

  // Step 2: Build dependency adjacency graph
  const depMap = new Map<string, string[]>()
  def.steps.forEach(s => depMap.set(s.name, s.dependsOn || []))

  // Step 3: Compute Transitive Causal Predecessor Set via BFS
  const causalAncestors = new Set<string>()
  const queue = [...(depMap.get(failedStep) || [])]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (!causalAncestors.has(current)) {
      causalAncestors.add(current)
      const parents = depMap.get(current) || []
      for (const parent of parents) {
        if (!causalAncestors.has(parent)) queue.push(parent)
      }
    }
  }

  // Step 4: Extract succeeded steps
  const succeededSteps = await query<Step>(
    "SELECT name, output FROM steps WHERE workflow_id=$1 AND status='success'",
    [workflowId]
  )
  const succeededNames = new Set(succeededSteps.map(s => s.name))

  // Step 5: Filter steps in reverse topological order: ONLY causal ancestors of failed step
  const toCompensate = def.steps
    .filter(s => succeededNames.has(s.name) && causalAncestors.has(s.name))
    .reverse()

  // Step 6: Execute Branch-Isolated Compensation Loop
  for (const stepDef of toCompensate) {
    if (!stepDef.compensate) continue

    await query(`UPDATE steps SET status='compensating' WHERE id=$1`, [step.id])
    try {
      await stepDef.compensate(wf.input, step.output || {}, ctx)
      await query(`UPDATE steps SET status='compensated', finished_at=NOW() WHERE id=$1`, [step.id])
    } catch (err: any) {
      // Compensation failed — mark step, flag workflow, stop cascade
      await query(`UPDATE steps SET status='failed', error=$1 WHERE id=$2`, [err.message, step.id])
      await query(`UPDATE workflows SET status='compensation_failed', finished_at=NOW() WHERE id=$1`, [workflowId])
      return // Halt; requires operator intervention
    }
  }

  // Step 7: Finalize successful rollback
  await query(`UPDATE workflows SET status='compensated', finished_at=NOW() WHERE id=$1`, [workflowId])
}
```

---

## 3. CLAIMS (PATENTABLE NOVELTY)

1. **Claim 1:** A method for resilient workflow execution in distributed systems comprising:
   - Maintaining a persistent execution log of directed step dependencies;
   - Reserving pending steps using non-blocking row-level lock skipping (`FOR UPDATE SKIP LOCKED`);
   - Computing topological reverse execution paths dynamically upon step failure to perform branch-isolated state rollbacks.

2. **Claim 2:** The method of Claim 1, wherein human-in-the-loop steps suspend workflow execution without holding thread or database locks, emitting a WebSocket notification for asynchronous manual approval or rejection.

3. **Claim 3:** The system of Claim 1, wherein failure events automatically trigger causal event logging enabling zero-overhead execution replay from arbitrary historical state snapshots.

import { useApp } from '@/state';
import { PageTop } from '@/pages/Analytics';
import { PlanBuilder } from '@/pages/BudgetPlanner';

// Planning: decide the promotion. Who to target and why, what to promote, the discount and the budget; your plan next to
// the recommendation; then simulate it (Simulation) and finalise it.
export function Planning() {
  const { go, plan, scenarios, setScenarios } = useApp();
  // Simulation opens with the plan as it is, plus an editable copy to try changes on (the plan itself is never edited there)
  const simulate = () => { if (!scenarios.length) setScenarios([{ id: `${Date.now()}`, name: 'Scenario A', cfg: plan }]); go('simulation'); };
  return (
    <>
      <PageTop title="Planning" sub="Decide the promotion: which customer groups to target and why, what to promote, which discount and how much to spend" />
      <div className="p-6"><PlanBuilder onSimulate={simulate} /></div>
    </>
  );
}

// Simulation: the last step of the story. The plan built on Planning is tested against what-if scenarios (other customer
// groups, products, discounts or budgets), a better scenario can be applied back to the plan, and the plan is finalised.
import { PageTop } from '@/pages/Analytics';
import { ScenarioLab } from '@/pages/ScenarioLab';

export function SimulationPage() {
  return (
    <>
      <PageTop title="Simulation" sub="Test your plan before you commit: try other customer groups, discounts or budgets side by side, keep the best, then finalise" />
      <div className="p-6"><ScenarioLab /></div>
    </>
  );
}

// Presentation of the four customer types shared by Behaviour Analytics and Customer Prediction.
import type { TypeId } from '@/engine/behaviour';

/** the standing treatment for each customer type, in one short line */
export const TYPE_ACTION: Record<TypeId, { label: string; tone: 'green' | 'navy' | 'neutral' | 'red' }> = {
  persuadable: { label: 'Target with offers', tone: 'green' },
  sure: { label: 'Reward, do not discount', tone: 'navy' },
  lost: { label: 'Skip paid offers', tone: 'neutral' },
  dog: { label: 'Do not disturb', tone: 'red' },
};

import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
import { answer, SUGGESTED } from '../src/engine/advisor.ts';
const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
for (const q of [...SUGGESTED, 'tell me about C42', 'asdf', 'when do people shop']) {
  const a = answer(e, q);
  console.log('\nQ:', q, '\n', a.text.slice(0, 420), a.table ? '[table ' + a.table.rows.length + ']' : '');
}

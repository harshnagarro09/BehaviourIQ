import fs from 'node:fs';
import { parseCsv, buildDataset } from '../src/engine/data.ts';
import { trainModel } from '../src/engine/model.ts';

const text = fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8');
const ds = buildDataset(parseCsv(text));
console.time('train');
const m = trainModel(ds);
console.timeEnd('train');
console.log('auc train/test', m.aucTrain.toFixed(3), m.aucTest.toFixed(3), 'n', m.nTrain, m.nTest, 'base', m.baseRateTest.toFixed(3));
console.table(m.calibration.map((c) => ({ n: c.n, pred: c.predicted.toFixed(3), actual: c.actual.toFixed(3) })));
console.table(m.importance.map((i) => ({ f: i.label, w: i.weight.toFixed(2), share: (i.share * 100).toFixed(1) })));
console.log(m.groupImportance.map((g) => g.group + ' ' + (g.share * 100).toFixed(0)).join(' | '));

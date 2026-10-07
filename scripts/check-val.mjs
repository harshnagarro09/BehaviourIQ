import fs from 'node:fs';
import { buildEngine } from '../src/engine/index.ts';
const e = buildEngine(fs.readFileSync(new URL('../public/data/promo_behaviour_data.csv', import.meta.url), 'utf8'));
console.log('AUC', e.model.aucTest.toFixed(3), 'test camps', e.model.testCampaigns.length);
console.table(e.validation.map((v) => ({ c: v.campaign.name, reached: v.reached, tgt: v.targeted, predNet: Math.round(v.predNet), realNet: Math.round(v.realNet), predB: Math.round(v.predBuyers), realB: v.realBuyers, roi: v.roi.toFixed(2), skip: Math.round(v.skippedNet), broad: Math.round(v.broadNet) })));
const s = (f) => e.validation.reduce((a, v) => a + f(v), 0);
console.log('total pred', Math.round(s((v) => v.predNet)), 'real', Math.round(s((v) => v.realNet)), 'cost', Math.round(s((v) => v.cost)), 'skipped', Math.round(s((v) => v.skippedNet)), 'broad', Math.round(s((v) => v.broadNet)), Math.round(s((v)=>v.broadCost)));
console.log(e.strategies.map((x) => x.name + ' ' + x.roi.toFixed(2) + ' ' + Math.round(x.netProfit)));

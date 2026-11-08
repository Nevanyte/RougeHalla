import {cases as lifecycle} from '../player-faction-reset-fixtures/cases.mts';
const input=structuredClone(lifecycle.find(c=>c.players[0].faction==='fire')!);
input.name='base-player-axe-shred-reset-and-continuation';input.players[0].weapon='axe';
export const cases=[input];

/** Fresh process: absolutely no inspector connection until its complete ordinary trace has ended. */
import{readFileSync}from'node:fs';Math.random=()=>{throw Error('undeclared randomness')};if(process.env.RH_CARD_NO_INSPECTOR!=='1')throw Error('control flag required');
const E=await import('./engine.mts'),input=JSON.parse(readFileSync(0,'utf8'));const result=E.run(input);await E.prepareInspection();const finalOracle=E.lastOracle();process.stdout.write(JSON.stringify({result,postTracePrivateOracle:finalOracle,privateOracleRecords:E.privateOracleRecords})+'\n');

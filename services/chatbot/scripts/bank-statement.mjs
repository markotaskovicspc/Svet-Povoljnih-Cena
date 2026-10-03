import {readFile} from 'node:fs/promises';
import {parseErsteStatement,submitBankStatement} from '../src/bank-statements.mjs';
const [path,...flags]=process.argv.slice(2);
if(!path)throw Error('Usage: node --env-file=.env.local scripts/bank-statement.mjs path.pdf [--check | --apply]');
const statement=await parseErsteStatement(await readFile(path));
console.log(JSON.stringify({statement:statement.statement,date:statement.date,entries:statement.entries.map(({orderNumber,amountMinor,bankReference})=>({orderNumber,amount:amountMinor/100,bankReference}))}));
if(flags.includes('--check')||flags.includes('--apply')){
 if(flags.includes('--check')&&flags.includes('--apply'))throw Error('Choose --check or --apply');
 console.log(JSON.stringify(await submitBankStatement(statement,process.env,{dryRun:!flags.includes('--apply')})));
}

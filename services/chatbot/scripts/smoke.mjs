import { Agent, run, setTracingDisabled } from '@openai/agents';
setTracingDisabled(true);
try {
  const result=await run(new Agent({name:'SPC connection check',model:process.env.OPENAI_MODEL??'gpt-5.4-mini',instructions:'Odgovori samo: SPC_OK'}),'Provera veze. Bez alata i bez korisničkih podataka.',{maxTurns:1,signal:AbortSignal.timeout(30000)});
  console.log(JSON.stringify({ok:String(result.finalOutput).includes('SPC_OK'),model:process.env.OPENAI_MODEL??'gpt-5.4-mini'}));
} catch(e) {console.error(JSON.stringify({ok:false,status:e.status??null,code:e.code??null,type:e.name}));process.exitCode=1;}

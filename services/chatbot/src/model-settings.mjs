export const DEFAULT_MODEL='gpt-6.1-sol';
// Bound latency/cost for interactive turns. Older model rollback keeps its explicit staff effort.
export function modelSettings(model,effort){
 return {parallelToolCalls:false,...(effort||/^gpt-6(?:\.\d+)?-sol(?:$|-)/.test(model)?{reasoning:{effort:effort??'low'}}:{})};
}

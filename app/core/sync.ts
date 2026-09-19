export type Stamp = {stamp:string|null;count:number};
export type Manifest = {admin:boolean;owner:boolean;revision:number|null;profiles:Stamp;days:Stamp;evaluations:Stamp;settings:Stamp;grading:Stamp;final_scores:Stamp;audit?:Stamp};
export function changed(a:Stamp|undefined,b:Stamp|undefined){return !a || !b || a.stamp!==b.stamp || a.count!==b.count}
export function fullFetch(before:Stamp|undefined,after:Stamp){return !before?.stamp || after.count<before.count || (!!after.stamp && after.stamp<before.stamp)}
export function mergeRows<T extends {id:string|number}>(before:T[],updates:T[]){const map=new Map(before.map(row=>[row.id,row]));for(const row of updates)map.set(row.id,row);return [...map.values()]}
// Serializes sync requests; a request arriving during a fetch runs once more afterwards.
export function serialSync<T>(run:(options:T)=>Promise<void>,combine:(a:T,b:T)=>T){let pending:T|undefined;let running:Promise<void>|undefined;return (options:T)=>{pending=pending===undefined?options:combine(pending,options);if(!running){running=(async()=>{try{while(pending!==undefined){const next=pending;pending=undefined;await run(next)}}finally{running=undefined}})()}return running}}

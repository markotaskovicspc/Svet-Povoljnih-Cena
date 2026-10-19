type CategoryNode={id:string;name:string;parentId:string|null;path:string};
export function primaryRootCategory(ids:string[],nodes:CategoryNode[]){
  const index=new Map(nodes.map(node=>[node.id,node]));
  const roots=new Map<string,CategoryNode>();
  for(const id of ids){let node=index.get(id);const seen=new Set<string>();
    while(node?.parentId){if(seen.has(node.id)){node=undefined;break;}seen.add(node.id);node=index.get(node.parentId);}
    if(node)roots.set(node.id,node);
  }
  // Assign one category per product: never count the same turnover twice.
  return [...roots.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.id.localeCompare(b.id))[0]??null;
}

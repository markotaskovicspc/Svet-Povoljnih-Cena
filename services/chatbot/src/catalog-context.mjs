// Recheck recently mentioned catalogue codes before the model reads its old replies.
// Assistant prose is not a product database, especially after an incorrect offer.
export async function refreshCatalogContext({state,event,spc}) {
  const text=[...state.history.slice(-8).map(m=>m.content),event.text].join('\n');
  const skus=[...new Set(text.match(/\b\d{6}\b/g)??[])].slice(-6);
  const items=[];
  for(const sku of skus){
    const result=await spc({action:'search',query:sku});
    const item=result.items?.find(p=>p.sku===sku);
    items.push(item?{sku:item.sku,name:item.name,price:item.price,available:item.available,checkedQuantity:item.checkedQuantity,url:item.slug?`https://www.svetpovoljnihcena.rs/p/${encodeURIComponent(item.slug)}`:null}:{sku,notFound:true});
  }
  return items;
}

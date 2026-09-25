// Images come only from the catalog, never from an URL supplied by the model.
export function productPresentation(product) {
  const url=product.slug?`https://www.svetpovoljnihcena.rs/p/${encodeURIComponent(product.slug)}`:null;
  let imageUrl=null;
  try {
    const image=new URL(typeof product.image==='string'?product.image:product.image?.url);
    if(image.protocol==='https:' && !image.username && !image.password &&
      image.hostname==='vyebjbcfhgujlvjnoxpl.supabase.co' &&
      image.pathname.startsWith('/storage/v1/object/public/product-media/') && !image.search) imageUrl=image.href;
  } catch {}
  const caption=[`${product.name} (${product.sku})`,`${product.price} RSD`,url].filter(Boolean).join('\n');
  return {sku:product.sku,url,imageUrl,caption};
}

import {expect,it} from 'vitest';
import type {Product} from '@/types';
import {productText,socialProductDetails} from '@/lib/social/product-details';
it('exposes public description and distinct product/package sizes; zero dimensions are unknown',()=>{
 const p={sku:'TEST',slug:'fen-test',name:'Fen',description:'<p>Dimenzije: 24 &times; 18 cm.</p><script>bad()</script>',dimensionsCm:{w:24,d:0,h:18},unitPackageDimensionsCm:{w:30,d:10,h:25},materials:[],technicalSpecs:[{key:'power',label:'Snaga',value:'2000 W'}],stock:73,internalNote:'not public'} as unknown as Product;
 const r=socialProductDetails(p);
 expect(r.dimensions).toEqual({width:24,depth:null,height:18,unit:'cm'});
 expect(r.packageDimensions?.width).toBe(30);expect(r.description).not.toContain('bad');expect(r.technicalSpecs[0].value).toBe('2000 W');
 expect(r).not.toHaveProperty('stock');expect(r).not.toHaveProperty('internalNote');
 expect(socialProductDetails({...p,dimensionsCm:{w:0,d:0,h:0},unitPackageDimensionsCm:undefined}).dimensions).toBeNull();
});
it('bounds descriptions, decodes entities and reports truncation',()=>{
 expect(productText('<b>Snaga&nbsp;2000&#32;W</b>')).toEqual({text:'Snaga 2000 W',truncated:false});
 expect(productText('abcdef',3)).toEqual({text:'abc',truncated:true});
});

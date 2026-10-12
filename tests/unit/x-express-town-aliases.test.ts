import {describe,it,expect} from 'vitest';
import {customerTownLabel,exactTownAlias,searchTownAliases} from '@/lib/x-express/town-aliases';
const town={id:791059,name:'Beograd (Zemun)',postalCode:'11080'};
describe('verified courier locality aliases',()=>{
 it('routes Žarkovo only with its verified postal code and preserves the locality label',()=>{
  const routing={id:791113,name:'Beograd (Čukarica)',postalCode:'11030'};
  for(const q of ['Žarkovo','Zarkovo BG','Жарково','Beograd Zarkovo'])expect(exactTownAlias(q,'11030')?.townId).toBe(791113);
  expect(searchTownAliases('Žarkovo')[0]?.townId).toBe(791113);
  expect(exactTownAlias('Žarkovo','11080')).toBeUndefined();
  expect(customerTownLabel({city:'Zarkovo',postalCode:'11030'},routing,{preserveCustomerPostalCode:true})).toEqual({city:'Žarkovo',postalCode:'11030'});
 });
 it('recognizes postal code, partial names and Cyrillic without guessing other localities',()=>{
  for(const q of ['11273','Bata','Батајница','Zemun - Batajnica']) expect(searchTownAliases(q)[0]?.townId).toBe(791059);
  expect(searchTownAliases('1127')).toEqual([]);
  expect(searchTownAliases('Zemun')).toEqual([]);
  expect(searchTownAliases('Beograd')).toEqual([]);
  expect(exactTownAlias('Batajnica','11080')).toBeUndefined();
  expect(exactTownAlias('Batajnica naselje','11273')).toBeUndefined();
 });
 it('resolves Zemun polje by exact name/postcode while keeping the existing courier ID',()=>{
  for(const q of ['11185','Zemun polje','Земун поље','Beograd (Zemun polje)'])expect(searchTownAliases(q)[0]?.townId).toBe(791059);
  expect(exactTownAlias('Zemun polje','11080')).toBeUndefined();
  expect(customerTownLabel({city:'Zemun polje',postalCode:'11185'},town)).toEqual({city:'Zemun polje',postalCode:'11185'});
 });
 it('preserves customer locality in receipt/order only for the verified courier record',()=>{
  expect(customerTownLabel({city:'Батајница',postalCode:'11273'},town)).toEqual({city:'Batajnica',postalCode:'11273'});
  expect(customerTownLabel({city:'Batajnica',postalCode:'11273'},{...town,id:123,name:'Other',postalCode:'99999'})).toEqual({city:'Other',postalCode:'99999'});
  expect(customerTownLabel({city:'Batajnica',postalCode:'11273'},null)).toEqual({city:'Batajnica',postalCode:'11273'});
 });
});

describe('chat customer postcode preservation',()=>{
 it('keeps buyer correction in stored address while retaining the resolved courier town',()=>{
  const shipping={city:'Jasenovik',postalCode:'18207'};
  const routing={id:321,name:'Jasenovik',postalCode:'18000'};
  expect(customerTownLabel(shipping,routing,{preserveCustomerPostalCode:true})).toEqual(shipping);
  expect(customerTownLabel(shipping,routing)).toEqual({city:'Jasenovik',postalCode:'18000'});
 });
});

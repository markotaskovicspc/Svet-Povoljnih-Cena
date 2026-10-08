import {describe,it,expect} from 'vitest';
import {customerTownLabel,exactTownAlias,searchTownAliases} from '@/lib/x-express/town-aliases';
const town={id:791059,name:'Beograd (Zemun)',postalCode:'11080'};
describe('verified courier locality aliases',()=>{
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

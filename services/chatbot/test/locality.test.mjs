import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLooseTown,splitLocality} from '../src/locality.mjs';
import {normalizePlace} from '../src/delivery.mjs';

// Real X Express dictionary records (13.11.2026.) for the addresses the
// chatbot rejected between 14.10. and 13.11.2026.
const T=[[700029,'Aleksandrovac','37230',70017],[700614,'Aleksinac','18220',70025],[700649,'Aleksinački Rudnik','18226',70025],[701858,'Aleksandrovac','18330',70050],[702315,'Radosin','18330',70050],[702765,'Rača','31250',70068],[703273,'Leskovik','18310',70084],[703338,'Novo Selo','18310',70084],[703702,'Vinča','11351',70122],[704865,'Borča','11211',70203],[704911,'Padinska Skela','11213',70203],[707759,'Novo Selo','17520',70351],[709344,'Velika Plana','11320',70386],[709433,'Novo Selo','11320',70386],[709468,'Staro Selo','11324',70386],[710016,'Novo Selo','15225',70408],[710512,'Priboj','17511',70416],[711187,'Aleksandrovac','17500',70432],[712418,'Novo Selo','36216',70459],[712752,'Novo Selo','18240',70467],[714828,'Aleksandrovac','12370',70521],[714895,'Mirijevo','12374',70521],[718980,'Kragujevac','34000',70645],[720682,'Velika Kruševica','37000',70670],[720992,'Jasika','37252',70670],[721107,'Kruševac','37000',70670],[722316,'Novo Selo','18430',70688],[722456,'Rača','18440',70688],[723401,'Novo Selo','16230',70718],[723428,'Petrovac','16230',70718],[724726,'Novo Selo','16000',70726],[724823,'Petrovac','16000',70726],[724904,'Priboj','16000',70726],[725595,'Novo Selo','15300',70734],[728551,'Aleksandrovac','19319',70840],[729272,'Leskovik','18000',71315],[729370,'Niška Banja','18205',71285],[730602,'Novi Pazar','36300',70874],[731820,'Kamenovo','12300',70912],[731960,'Petrovac','12300',70912],[732478,'Nišor','18300',70939],[732567,'Petrovac','18300',70939],[733083,'Požarevac','12000',70947],[734179,'Krnjača','31330',70971],[734233,'Priboj','31330',70971],[734241,'Pribojska Goleša','31330',70971],[734250,'Pribojske Čelice','31330',70971],[734268,'Rača','31330',70971],[735477,'Velika Plana','18403',70998],[736074,'Novo Selo','18400',70998],[736147,'Petrovac','18400',70998],[736325,'Staro Selo','18400',70998],[736732,'Vučić','34210',71013],[736813,'Rača','34210',71013],[737291,'Novo Selo','36350',71021],[737607,'Velika Kruševica','35260',71030],[738409,'Staro Selo','35000',71048],[738425,'Topola(kod Jagodine)','35000',71048],[738492,'Vojska','35208',71056],[738620,'Radošin','35210',71056],[738654,'Svilajnac','35210',71056],[738964,'Niševac','18366',71064],[740900,'Novo Selo','18230',71129],[741345,'Novo Selo','17530',71137],[741957,'Vinča','34310',71153],[742228,'Topola(KG)','34310',71153],[742236,'Topola(KG) (selo)','34310',71153],[742481,'Novo Selo','17525',71161],[742490,'Petrovac','17525',71161],[743097,'Rujišnik','37240',71170],[743178,'Trstenik','37240',71170],[746207,'Duvanište','15000',71269],[791016,'Beograd (Voždovac)','11010',70106],[791024,'Beograd (Vračar)','11104',70114],[791032,'Beograd (Zvezdara)','11050',70149],[791059,'Beograd (Zemun)','11080',70157],[791067,'Beograd (Novi Beograd)','11070',70181],[791075,'Beograd (Palilula)','11060',70203],[791083,'Beograd (Rakovica)','11090',70211],[791091,'Beograd (Savski Venac)','11040',70220],[791105,'Beograd (Stari Grad)','11102',70246],[791113,'Beograd (Čukarica)','11030',70254],[792012,'Niš (Pantelej)','18000',71307],[792039,'Niš (Crveni Krst)','18000',71315],[792047,'Niš (Medijana)','18000',71331],[792055,'Niš (Palilula)','18000',71323],[802069,'Novo Selo','24420',80195]]
 .map(([townId,name,postalCode,municipalityId])=>({townId,name,postalCode,municipalityId}));
const fold=s=>normalizePlace(s).replace(/dj/g,'d');
// Mirrors /api/x-express/locations: folded "contains" search, exact first, 20 items.
const lookup=async q=>{const k=fold(q);return T.filter(t=>fold(t.name).includes(k)).sort((a,b)=>(fold(b.name)===k)-(fold(a.name)===k)).slice(0,20);};

const cases=[
 ['Padinska Skela, Beograd',null,704911],['Radosin, Vojska, opština Svilajnac','35208',738620],['Beograd, Cerak Vinogradi','11000',791113],
 ['Jajinci, Beograd',null,791016],['Petrovac na Mlavi',null,731960],['Vučić, Rača Kragujevačka','34210',736732],['Beograd, Železnik','11250',791113],
 ['Beograd, Borča',null,704865],['Novo Selo, opština Velika Plana','11327',709433],['Leskovik, Crveni Krst, Niš','18000',729272],
 ['Beograd, Zvezdara MMLug','11050',791032],['Cerak, Beograd',null,791113],['ZP Jasika, Kruševac','37252',720992],['Kamenovo, Petrovac na Mlavi','12300',731820],
 ['Beograd, Zvezdara, Mirijevo',null,791032],['Aleksandrovac Požarevački','12370',714828],['Beograd, Krnjača, opština Palilula',null,791075],
 ['Aleksinacki Rudnici',null,700649],['Topola kod Kragujevca','34310',742228],['Petrovac na Mlavi','12300',731960],['Rujišnik kod Trstenika','37244',743097],
 ['Zabela, Požarevac','12000',733083],['Staro Selo kod Velike Plane','11324',709468],['Beograd, Kotež, opština Palilula',null,791075],
 ['Priboj na Limu',null,734233],['Krnjača, Beograd','11210',791075],['Beograd (Zvezdara)',null,791032],
];
for(const [city,postalCode,expected] of cases)test(`resolves ${city}`,async()=>{
 const r=await resolveLooseTown({city,postalCode},lookup);
 assert.equal(r.town?.townId,expected,`${city} → ${r.town?.name}`);
});

test('ambiguous or unknown places are never guessed',async()=>{
 for(const [city,postalCode] of [['Novo Selo',null],['Petrovac',null],['Naselje 9. Maj, Niš',null],['Duvanište, Niš',null],['Priboj',null],['Beograd',null],['Beograd, Nepoznato naselje',null]]){
  const r=await resolveLooseTown({city,postalCode},lookup);
  assert.equal(r.town,null,`${city} → ${r.town?.name}`);
 }
});

test('a city split into boroughs offers its boroughs as candidates',async()=>{
 const r=await resolveLooseTown({city:'Naselje 9. Maj, Niš'},lookup);
 assert.deepEqual(r.candidates.map(t=>t.name).sort(),['Niš (Crveni Krst)','Niš (Medijana)','Niš (Palilula)','Niš (Pantelej)']);
});

test('noise words and postcodes are removed from locality parts',()=>{
 assert.deepEqual(splitLocality('selo Novo Selo, opština Velika Plana, 11327'),['novo selo','velika plana']);
});

# Launch provider status — 16. avgust 2026.

Ovaj presek navodi samo trenutno otvorene stavke. Tajne, podaci kupaca i puni
provider identifikatori namerno nisu deo dokumenta.

## Resend — tehnički GO

- Domen `svetpovoljnihcena.rs` je verifikovan.
- Pravi aplikacioni šablon potvrde porudžbine poslat je na Resend test sink sa
  predračunom i obrascem za odustajanje u PDF prilogu.
- Resend je vratio završni događaj `delivered`.
- Produkcioni webhook je primio i `email.sent` i `email.delivered`.
- Pet старих неуспелих потврда припада QA поруџбинама које су отказане; не
  шаљу се поново стварним купцима.

## BADI — V-PFR подешен, стварни рачуни намерно закључани

- Постојећи API кључ припада production окружењу. Позив production `/stores`
  пролази са HTTP 200, враћа једно продајно место и подешени store/client UUID
  се поклапа са њим.
- У Vercel пројекат који служи `www.svetpovoljnihcena.rs` уписани су PGJO
  ознака, production BADI endpoint, `vpfr` режим и комплетан електронски
  безбедносни елемент. PFX, његова лозинка и PAC су заштићене environment
  вредности; саме тајне нису део овог документа.
- `FISCAL_LOCATION_ID` је јединствена ознака пословног простора/просторије коју
  Пореска управа генерише након PGJO пријаве у ePorezi. То није BADI
  `BADI_STORE_ID`: BADI ID је UUID продајног места, док је fiscal location
  законска ознака пословног простора која се приказује на фискалном рачуну.
- `BADI_INVOICE_TYPE=training` и `BADI_PRODUCTION_ACCEPTED=false` остају
  намерна двострука кочница.
- Контролисани training тест је завршен: продаја је потписана, службени PDF је
  приватно сачуван, мејл је прихваћен, а training рефундација је издата и
  усклађена са локалним `refundedQty`, повратном евиденцијом и COD refund
  записом.
- У тесту је откривено да BADI refund endpoint враћа низ рачуна. Адаптер је
  очекивао један објекат и зато је успешан provider одговор означио као
  `FAILED`; parser је исправљен и покривен regression тестом. Стварни рачуни
  остају закључани док се одвојено не одобри `BADI_PRODUCTION_ACCEPTED=true`.

## X Express — master data GO, креирање налога блокира недодељен code range

- Test-account аутентикација, шифарник статуса и провера pickup адресе пролазе.
- `AAA + 850300000–850599999` нису provider подаци: то су примери које је наш
  репозиторијум увео 9. јуна 2026. Readiness их је зато погрешно прихватао као
  праву алокацију. Код сада препознаје и блокира баш ту sample комбинацију.
- Званични јавни tracking користи пример `26-0001234567`, али је контролисани
  `order/add` одбио и `26-` + наш sample број. То потврђује да проблем није само
  форматирање: тренутном API user-у није везан тај бројчани опсег.
- X Express треба да достави или веже стварни `code prefix + range` за тренутни
  API user и contract code, уз потврду да ли API package code има исти формат
  као јавни број товарног листа. Не треба нагађати следећи број.
- За стварни launch су затим потребни production API user/key, потврђен
  production range и `X_EXPRESS_PRODUCTION_ACCEPTED=true`. Садашњи налог је
  test и не прави стварно преузимање.
- У бази су присутни шифарници (169 општина, 4.721 место и 39.260 активних
  улица). Стари cron записи о прекорачењу PostgreSQL parameter limit-а односе
  се на деактивацију великог списка улица; тренутни код већ шаље један integer
  array параметар уместо огромног `NOT IN` списка.

## MyGLS — API GO, остаје контролисани физички launch

- Production credentials и acceptance gate су подешени; `MYGLS_AUTO_CREATE`
  остаје исправно искључен за ручни први launch.
- Read-only production провера враћа HTTP 200 и 4.766 локација, без provider
  грешака. `GetDeliveryPoints` враћа празан списак без грешке; то не блокира
  кућну доставу, али pickup point избор тренутно нема податке за приказ.
- Обавезни sender/pickup параметри су присутни, а GLS-ом потврђено мапирање
  адресе без броја је већ у конфигурацији.
- Историјски FAILED записи нису активни launch кварови: један је старо
  `Unauthorized`, а две адреснице су намерно обрисане после контролисаних QA
  провера.
- Преостало је заказивање првог физичког прикупа одвојеним GLS каналом, једна
  одобрена реална test поруџбина са примаоцем и стварним мерама пакета, затим
  провера адреснице, првог scan-а, доставе и COD усаглашавања.

## Рута оба курира

- Пакет чије су све странице највише 60 cm иде X Express-ом. То је договорено
  launch правило клијента, не јавно ограничење X Express-а.
- Пакет са било којом страницом преко 60 cm иде MyGLS-ом; тежина сама не мења
  избор курира.
- Мешовита поруџбина се дели у два налога за преузимање. Сваки налог учитава
  само своје пакете, а цела наплата поузећем сме бити додељена само првој
  успешно креираној пошиљци, никада оба пута.
- Глобални `COURIER_SMALL_PROVIDER` више није пословно правило за нове налоге;
  служи само као fallback за старе записе. Оператер при креирању налога бира
  X Express или MyGLS, а систем затим примењује правило 60 cm.
- MyGLS се може користити у контролисаном launch-у. X Express остаје видљив и
  функционално повезан, али стварно креирање његове пошиљке остаје блокирано
  док провајдер не додели важећи production package-code range.

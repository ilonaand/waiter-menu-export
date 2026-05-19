# Промт-спецификация (node-only): импорт **одного меню** из Firebird (Gedemin) в MongoDB (запуск кнопкой из Gedemin)

Ты пишешь скрипт импорта, который запускается **кнопкой из Gedemin** на клиентской машине и выполняет перенос **только Node.js-скриптом**:

- Node.js подключается **напрямую к Firebird** (Gedemin DB) через драйвер Firebird для Node.
- Node.js подключается **напрямую к MongoDB** (в т.ч. MongoDB 8.2.7 в контейнере) через официальный драйвер `mongodb`.
- VBScript в Gedemin выступает как **launcher** (собрать параметры, вызвать `node.exe`, показать результат).

Важно: этот этап **НЕ читает XML**. XML уже импортирован штатным макросом в Firebird.

Этот документ описывает **единственный утверждённый транспорт**: Node.js напрямую читает Firebird и напрямую пишет в MongoDB. Другие варианты (ADO/ODBC для Mongo, PowerShell/.NET и т.п.) **не рассматриваются**.

---

## 0) Контекст и источники правды (что читать и чему верить)

- **Меню в Firebird уже создано** существующим импортом (например, макросом из `MenuImportXML.vbs` и логикой из `mn-import.vbs`). Повторять разбор XML не нужно.
- **Схема Mongo** и ожидаемые поля ориентируйся на:
  - `waiter\44.md` (сущности `sys-ref:Good`, `sys-ref:GoodGroup`, `sys-ref:GoodGroupMembership`, `sys-ref:Unit`, `sys-ref:GroupHierarchy`, `pos:priceList`, `pos:priceListLine`, `pos:priceListType`)
  - реальные примеры документов, которые показал заказчик (там есть `__fbId`, `internalCode`, `price` в копейках и т.п.).
- **Важно про имена коллекций в этом проекте**: по умолчанию коллекции называются **с дефисами**, а не как “namespace:name” из `44.md`:
  - `sys-ref:Good` → `Good`
  - `sys-ref:GoodGroup` → `GoodGroup`
  - `sys-ref:GoodGroupMembership` → `GoodGroupMembership`
  - `sys-ref:Unit` → `Unit`
  - `sys-ref:GroupHierarchy` → `GroupHierarchy`
  - `pos:priceListType` → `pos-priceListType`
  - `pos:priceList` → `pos-priceList`
  - `pos:priceListLine` → `pos-priceListLine`
- **Источник Firebird**: таблицы (DDL/запросы даны заказчиком):
  - `USR$MN_MENU` (шапка меню, `DOCUMENTKEY`)
  - `GD_DOCUMENT` (общая шапка документа; `ID`, `DOCUMENTDATE`, `DISABLED`…)
  - `USR$MN_MENULINE` (строки меню; **связка с шапкой через `MASTERKEY`**, `USR$GOODKEY`, `USR$COST`, `USR$QUANTITY`…)
  - `GD_GOOD` (товар; `ID`, `NAME`, `ALIAS`, `BARCODE`, `GROUPKEY`, `VALUEKEY`, флаги `USR$BEDIVIDE` и т.п.)
  - `GD_GOODGROUP` (группа; `ID`, `NAME`, `ALIAS`, `PARENT`, `LB/RB`…)
  - `GD_VALUE` (единица; но в нашем кейсе фактически нужна только “шт”)
  - `USR$MN_MENUNAME` (справочник названий меню, `USR$NAME`) — используется для названия `priceList`
  - `GD_CONTACT` (подразделение/точка, `NAME`, `ADDRESS`) — при необходимости включать в name меню/лог

---

## 0.1) `.env` контракт и запуск (node-only)

Импорт должен поддерживать конфигурацию через переменные окружения (файл `.env` или системные env). Ниже — единый контракт параметров.

### `.env` (обязательные переменные)

Минимальный набор:
- `FIREBIRD_HOST`
- `FIREBIRD_PORT`
- `FIREBIRD_DB` (путь/alias БД, как требуется драйверу)
- `FIREBIRD_USER`
- `FIREBIRD_PASS`
- `FIREBIRD_CHARSET` (например `WIN1251` или `UTF8`; важно для кириллицы)
- `MONGODB_URI` (строка как в Compass, например `mongodb://user:pass@host:27017/?authSource=admin`)
- `MONGODB_DB` (имя базы)

Рекомендуемые (для удобства и совместимости с промтом):
- `NODE_ENV=production`
- `BATCH_SIZE=1000`
- `MENU_DOCUMENT_KEY` (только для локального теста, чтобы не передавать каждый раз в CLI)

### `.env` (опционально: имена коллекций)
Если в Mongo коллекции названы не “как ожидаем”, задавать явно:
- `COL_UNIT`
- `COL_GOOD`
- `COL_GOOD_GROUP`
- `COL_GOOD_GROUP_MEMBERSHIP`
- `COL_GROUP_HIERARCHY`
- `COL_PRICE_LIST_TYPE`
- `COL_PRICE_LIST`
- `COL_PRICE_LIST_LINE`

### Подключение dotenv (рекомендация)
Рекомендуемое поведение:
- если `dotenv` установлен — загрузить `.env`;
- если `dotenv` не установлен — не падать (предполагаем, что env заданы системой/службой).

### Таймауты Mongo (рекомендация)
Рекомендуемые настройки подключения:
- `socketTimeoutMS` (например 300000)
- `serverSelectionTimeoutMS` (например 30000)

---

## 1) Входные параметры функции и область импорта

Функция должна работать для **одного конкретного меню**:
- Вход: `menuDocumentKey` (это `USR$MN_MENU.DOCUMENTKEY`, он же `GD_DOCUMENT.ID`)
- Импортируем **только данные, относящиеся к этому меню**:
  - `pos:priceList` — 1 документ
  - `pos:priceListLine` — все строки этого меню
  - `sys-ref:*` справочники — только те товары/группы, которые встречаются в строках меню (плюс корневая группа, если нужна)

---

## 2) MongoDB: какие коллекции создаём/обновляем (итоговые сущности)

Минимальный набор для меню и справочников:

### A) `sys-ref:Unit`
- В Mongo должна быть единица измерения **`name = "шт"`**
- Все товары в этом импорте получают `unitId` именно этой записи.
- Если записи “шт” нет — создать.

### B) `sys-ref:GroupHierarchy`
- Создать/найти иерархию групп для меню:
  - `code = "menu"` (ключ)
  - `name` можно задать, например `"Menu hierarchy"` или `"Иерархия меню"`
  - `description` опционально

### C) `sys-ref:GoodGroup`
- Группы, используемые в меню (и их корень, если вы строите дерево)
- Поля:
  - `hierarchyId`: ObjectId иерархии (`code="menu"`)
  - `code`: строковый код группы (см. правила ниже)
  - `name`: из Firebird
  - `parentId`, `ancestors`, `depth`: строятся по `GD_GOODGROUP.PARENT` (в вашем кейсе “корень + группы”, глубина 0/1)
  - `__fbId`: `GD_GOODGROUP.ID` (как в примерах)

### D) `sys-ref:Good`
- Товары, которые встречаются в `USR$MN_MENULINE` выбранного меню
- Ключевой момент: **внешний id товара из Firebird хранится в поле `internalCode`** (`44.md`), это **`GD_GOOD.ID`**
- Поля:
  - `internalCode` = `CStr(GD_GOOD.ID)` (строка)
  - `name` = `GD_GOOD.NAME`
  - `alias` = `GD_GOOD.ALIAS` (не ключ, но полезно)
  - `barcode` = `GD_GOOD.BARCODE` (если не пусто)
  - `unitId` = ObjectId единицы `"шт"`
  - `isAssembly` = `GD_GOOD.ISASSEMBLY` (если переносите)
  - POS-расширения из `44.md` при необходимости:
    - `isFractional`: **в этом проекте фиксируем `false`** (в вашей базе это поле сейчас равно 0)
    - `GTIN` можно брать из `GD_GOOD.USR$GTIN` (если у вас это поле используется)
    - и т.д.
  - `__fbId` можно хранить как число = `GD_GOOD.ID` (как в примере), но при наличии `internalCode` это дублирование допустимо

### E) `sys-ref:GoodGroupMembership`
- Связь товар↔группа в рамках `hierarchyId="menu"`
- Поля:
  - `goodId`: ObjectId товара (`sys-ref:Good`)
  - `groupId`: ObjectId группы (`sys-ref:GoodGroup`)
  - `hierarchyId`: ObjectId иерархии
  - `ancestorGroupIds`: массив ObjectId предков (в вашем кейсе обычно `[rootGroupId]` или пусто)
  - `isPrimary = true`
- `__fbId` у membership **нет источника** (в Firebird отдельной таблицы membership нет), не заполнять.

### F) `pos:priceListType`
- Так как `pos:priceList.priceListTypeId` обязателен, создаём/находим тип:
  - `name = "menu"` (ключ/unique)
  - `disabled = false`

### G) `pos:priceList` (это и есть меню)
- 1 документ на `menuDocumentKey`
- В вашей реальной коллекции есть поля `noGroups` и `alternativeGroups` (по примерам) — заполнять.
- Поля:
  - `name`: стабильное уникальное имя меню (см. правило ниже)
  - `priceListTypeId`: ObjectId типа `"menu"`
  - `fromDate`: `GD_DOCUMENT.DOCUMENTDATE` (дата начала действия меню)
  - `toDate`: `USR$MN_MENU.USR$TODATE` (если null, решите правило: чаще всего = `fromDate`)
  - `noGroups`: `USR$MN_MENU.USR$NOGROUPS`
  - `alternativeGroups`: `USR$MN_MENU.USR$ALTERGROUPS`
  - `disabled`: правило `GD_DOCUMENT.DISABLED = 1 OR USR$MN_MENU.USR$NOTACTIVE = 1`
  - `navigationHierarchyId`: ObjectId иерархии `code="menu"` (если поле реально используется в вашей Mongo-схеме; в `44.md` оно есть)

### H) `pos:priceListLine` (строки меню)
- По каждой строке `USR$MN_MENULINE` выбранного меню:
  - `priceListId`: ObjectId меню (`pos:priceList`)
  - `goodId`: ObjectId товара (`sys-ref:Good`)
  - `price`: **в копейках**, целое (см. правила конвертации)
  - `quantity`: `USR$MN_MENULINE.USR$QUANTITY` (если null → 0)
  - `disabled`: по умолчанию `false` (если нет отдельного источника)
  - (если в будущем надо `vat`, `orderLimitQuantity` — пока не заполнять)

---

## 3) Правила ключей (upsert) и идемпотентность (повторный запуск без дублей)

Импорт должен быть **идемпотентным**: повторный запуск на то же `menuDocumentKey` обновляет записи, а не плодит дубли.

Рекомендуемые ключи для поиска/апсерта:

- `sys-ref:Unit`: по `name = "шт"`
- `sys-ref:GroupHierarchy`: по `code = "menu"`
- `pos:priceListType`: по `name = "menu"`

- `sys-ref:Good`: по `internalCode = CStr(GD_GOOD.ID)`
  (Это основной стабильный внешний ключ. Если возможно — обеспечьте индекс/уникальность по `internalCode`.)

- `sys-ref:GoodGroup`: по `(hierarchyId, code)`
  где `code` берётся так:
  - основной вариант: `code = GD_GOODGROUP.ALIAS` (строка, trim)
  - если `ALIAS` пустой/NULL: `code = "gg:" & GD_GOODGROUP.ID` (чтобы не потерять группу и не сломать unique `(hierarchyId, code)`)

- `sys-ref:GoodGroupMembership`: по `(goodId, groupId)` (как в ER — unique)

- `pos:priceList`: так как в `44.md` индекс unique на `name`, имя надо формировать **детерминированно и уникально**. Рекомендуемое правило:
- `name = "Меню " & GD_DOCUMENT.ID` (самый надёжный вариант; в проекте `NUMBER` не используем из‑за UDF в базе)
  Главное: одинаковое меню → одинаковое `name`.

- `pos:priceListLine`: если в вашей Mongo-модели нет уникального ключа на строку, делайте идемпотентность так:
  - сначала удалить/пометить старые линии данного `priceListId`, затем вставить заново
  - или upsert по `(priceListId, goodId)` (если в меню возможны дубли одного товара с разными ценами — тогда этого ключа недостаточно; в большинстве “меню на день” товар уникален, но это надо подтвердить).

---

## 4) Денежные значения и разделители (важно)

### Firebird → VBS (Decimal)
- `USR$MN_MENULINE.USR$COST` в Firebird хранится как decimal (в рублях).
- В Node.js это значение может прийти как число или строка (в зависимости от драйвера Firebird). **Нельзя** полагаться на строковый парсинг с запятой/точкой; нужно конвертировать защитно и затем округлять.

### Mongo: `pos:priceListLine.price` в копейках (Integer)
Правило:
- `priceCents = round( costRub * 100 )`
- если `costRub` NULL → 0
- результат привести к целому (Long)

Важно:
- Учитывать, что `CDec`/`CDbl` может дать погрешность. Используйте округление.
- Не используйте разбор строк с заменой `,`/`.` если можно избежать. Если драйвер возвращает строку — тогда:
  - явно заменяйте дробный разделитель в соответствии с форматом входа и `CDbl`, затем округляйте.
  - но базовый вариант: числовой Variant → умножение → `Round`.

---

## 5) ObjectId в Mongo (важно)

- В Mongo все ссылки (`goodId`, `groupId`, `hierarchyId`, `unitId`, `priceListId`, `priceListTypeId`) должны быть **настоящими ObjectId**.
- В Node.js использовать `ObjectId` из пакета `mongodb` (`new ObjectId(...)`).
- Держать мапы соответствий:
  - `internalCode -> good._id`
  - `groupCode -> goodGroup._id`
  - `unitName -> unit._id`
  - `hierarchyCode -> hierarchy._id`
  - `priceListTypeName -> priceListType._id`

---

## 5.0) VBScript (Gedemin) launcher: как вызывать Node-импорт кнопкой

Цель: написать в Gedemin отдельную функцию/макрос на VBScript, которая **не импортирует данные сама**, а запускает Node-скрипт и показывает результат пользователю.

### Входные данные
- `menuDocumentKey`: ID текущего меню (`GD_DOCUMENT.ID` / `USR$MN_MENU.DOCUMENTKEY`).
- Пути/параметры окружения (настраиваемые):
  - путь к `node.exe`
  - путь к `import-menu.js`
  - строка подключения Firebird (host/port/db/user/pass/charset)
  - Mongo URI (как в Compass)
  - (опционально) имена коллекций Mongo, если нестандартные

Рекомендация: хранить эти настройки в параметрах/константах системы Gedemin (или отдельном ini/json рядом со скриптом), чтобы не хардкодить креды в тексте макроса.

### Что делает launcher (пошагово)
1) Определяет `menuDocumentKey` (например, из текущего открытого документа/контекста формы).
2) Проверяет, что `node.exe` и `import-menu.js` существуют (через `Scripting.FileSystemObject.FileExists`).
3) Формирует команду запуска:
   - `"C:\path\to\node.exe" "C:\path\to\import-menu.js" --menuDocumentKey 12345 --fbHost ... --fbDb ... --fbUser ... --fbPass ... --fbCharset WIN1251 --mongoUri "mongodb://..." --mongoDb "..."`.
4) Запускает команду через shell-вызов процесса (например `WScript.Shell.Run` или эквивалент в среде Gedemin) так, чтобы:
   - окно консоли не мешало пользователю (по возможности скрыто),
   - скрипт дождался завершения процесса,
   - был получен `exitCode`.
5) Если `exitCode <> 0` — показать `MessageBox` “Ошибка импорта, см. лог”.
6) Если `exitCode = 0` — показать `MessageBox` “Импорт завершён” + краткую статистику (если launcher читает итоговый JSON/лог-файл).

### Как передавать результат обратно в Gedemin
Один из стабильных способов:
- Node пишет файл результата (например `export-menu.result.json`) с полями:
  - `ok`, `counts`, `errors[]`, `startedAt`, `finishedAt`
- VBScript после завершения процесса читает этот файл и показывает summary.

### Ошибки и безопасность
- Не выводить пароли в MsgBox/логах.
- При ошибке всегда сохранять путь к лог-файлу Node (stdout/stderr) для диагностики.

---

## 5.1) Транспорт: кнопка Gedemin → Node.js

### Основная идея
- **VBScript (Gedemin)** получает `menuDocumentKey` (текущий документ меню) и запускает внешний процесс:
  - `node.exe import-menu.js --menuDocumentKey <id> --fb <conn> --mongo <uri> ...`
- **Node.js** сам читает Firebird и пишет в Mongo.

### Почему не “один документ — один вызов Node”
- Из-за производительности и целостности ссылок. Node должен выполняться **один раз** на меню и делать все операции внутри одного процесса.

### Что должен уметь Node-скрипт
- Подключиться к Firebird по строке подключения (как у Gedemin).
- Подключиться к MongoDB по URI (как Compass).
- Уметь “ensure” справочники (unit/hierarchy/priceListType).
- Уметь upsert goods/groups/memberships/priceList и перезалить lines.
- Возвращать в stdout понятный результат (успех/ошибка + counts), чтобы VBS мог показать MsgBox/лог.

---

## 5.2) Node.js: требования к реализации (Firebird + Mongo)

### Зависимости
- MongoDB: официальный пакет `mongodb`.
- Firebird: драйвер Firebird для Node (например `node-firebird`), с явной настройкой `encoding/charset` под WIN1251/UTF8 (чтобы кириллица не “поехала”).

### Коллекции и имена
Node должен работать с коллекциями по именам, принятым в вашем Mongo.
В этом проекте имена коллекций **настраиваются** через `COL_*` в `.env`, а дефолты такие:
- `Unit`
- `GroupHierarchy`
- `GoodGroup`
- `Good`
- `GoodGroupMembership`
- `pos-priceListType`
- `pos-priceList`
- `pos-priceListLine`

### Upsert-паттерн
- Для справочников использовать `findOneAndUpdate(..., { upsert: true, returnDocument: "after" })`, чтобы **получить `_id`** сразу.
- Для множественных операций использовать `bulkWrite`.

### ObjectId и даты
- `_id` хранить как `ObjectId`.
- даты в Mongo хранить как `Date` (JS Date в UTC). Даты из Firebird читать как Date/строку и конвертировать в UTC.

### Идемпотентность lines
- Для `pos:priceListLine` проще и надёжнее:
  - удалить все линии `DeleteMany({ priceListId: <id> })`
  - вставить заново `InsertMany(lines)`
  - это соответствует “меню на день” и снимает проблему уникальных ключей строк.

---

---

## 6) Firebird: какие запросы делать (минимальный набор)

### 6.1 Шапка меню
Получить шапку по `:menuDocumentKey`:

- `GD_DOCUMENT` по `ID = :menuDocumentKey`
  - `ID`, `DOCUMENTDATE`, `DISABLED` … (**`NUMBER` не брать**)
- `USR$MN_MENU` по `DOCUMENTKEY = :menuDocumentKey`
  - `USR$TODATE`, `USR$MENUNAMEKEY`, `USR$DEPOTKEY`, `USR$NOTACTIVE`, `USR$NOGROUPS`, `USR$ALTERGROUPS`
- `USR$MN_MENUNAME` по `ID = USR$MENUNAMEKEY`
  - `USR$NAME`
- `GD_CONTACT` по `ID = USR$DEPOTKEY`
  - `NAME`, `ADDRESS`

### 6.2 Строки меню + товары + группы
Выбрать строки меню:
- из `USR$MN_MENULINE` по **`MASTERKEY = :menuDocumentKey`**:
  - `USR$GOODKEY`, `USR$COST`, `USR$QUANTITY`, (опционально `USR$SORTNUMBER`)

Подтянуть товары:
- `GD_GOOD` по `ID IN (все USR$GOODKEY)`:
  - `ID`, `NAME`, `ALIAS`, `BARCODE`, `GROUPKEY`, `VALUEKEY`, `ISASSEMBLY`, `USR$BEDIVIDE`, `USR$GTIN`…

Подтянуть группы:
- `GD_GOODGROUP` по `ID IN (все GROUPKEY)` + их корень/родители:
  - `ID`, `NAME`, `ALIAS`, `PARENT`, `DISABLED` …

Юниты:
- В этом проекте допускается упрощение: всегда использовать `Unit(name="шт")` и **не читать `GD_VALUE`** (так как “в нашем случае будет только одна единица измерения шт”).

---

## 7) Порядок действий (строго по шагам)

1) **VBScript (Gedemin)** получает `menuDocumentKey` (ID текущего документа меню) и вызывает `node.exe import-menu.js ...`.
2) **Node.js** подключается к Firebird (Gedemin DB) и читает исходные данные по `menuDocumentKey`.
3) **Node.js** подключается к MongoDB и обеспечивает справочники:
   - Upsert `sys-ref:Unit` (`name="шт"`) → получить `unitId`
   - Upsert `sys-ref:GroupHierarchy` (`code="menu"`) → получить `hierarchyId`
   - Upsert `pos:priceListType` (`name="menu"`) → получить `priceListTypeId`

4) Из Firebird выбрать шапку меню (см. 6.1) и вычислить:
   - `fromDate`, `toDate` (если null → правило)
   - `noGroups`, `alternativeGroups`
   - `disabled` (по правилу)
   - `priceList.name` (детерминированно)

5) Upsert `pos:priceList` по `name` → получить `priceListId`.

6) Из Firebird выбрать строки меню + товары + группы (см. 6.2). Построить уникальные наборы:
   - goods (по `GD_GOOD.ID`)
   - groups (по `GD_GOODGROUP.ID` + корень)
   - lines (по `USR$MN_MENULINE`)

7) Upsert `sys-ref:GoodGroup`:
   - сначала корень (если нужен),
   - затем дочерние группы
   - заполнить `parentId/ancestors/depth` (в вашем кейсе “корень+группы”: depth=0 у корня, depth=1 у остальных, ancestors=[rootId]).

8) Upsert `sys-ref:Good`:
   - key: `internalCode = CStr(GD_GOOD.ID)`
   - проставить `unitId` (шт)
   - остальные поля по правилам выше

9) Upsert `sys-ref:GoodGroupMembership`:
   - key: `(goodId, groupId)`
   - `hierarchyId`, `isPrimary=true`, `ancestorGroupIds=[rootId]` (если группа не корень)

10) Импорт `pos:priceListLine`:
   - рекомендованный способ для идемпотентности: удалить все линии по `priceListId`, затем вставить заново (если допустимо)
   - иначе upsert по `(priceListId, goodId)` (только если товар в меню не повторяется)
   - конвертировать цену в копейки: `round(USR$COST * 100)`

11) Логирование:
   - количество созданных/обновлённых `Good`, `GoodGroup`, `Membership`, `priceListLine`
   - список проблем:
     - строка меню без `USR$GOODKEY`
     - товар не найден по `GD_GOOD.ID`
     - группа не найдена по `GD_GOODGROUP.ID`
     - некорректная цена

---

## 8) Особые правила и “острые углы”

- **Кириллица/кодировки**: Firebird поля WIN1251; Mongo хранит UTF-8. В Node Firebird-драйвере явно задать charset/encoding, чтобы кириллица не “поехала”.
- **Пустые ALIAS у групп**: использовать fallback `gg:<ID>`.
- **`GD_GOOD.ALIAS` длина до 16** — в Mongo поле `alias` допускает до 16, совпадает.
- **Повторные запуски**: важно не плодить:
  - `sys-ref:Good` — удерживаем по `internalCode`
  - `GoodGroup` — по `(hierarchyId, code)`
  - `priceListType` — по `name`
  - `priceList` — по `name`
  - `lines` — либо чистим, либо имеем уникальный ключ

---

## 9) Что заказчик предоставит отдельно (не придумывать)

- Строка подключения к Mongo (user/pass/db/host) и требования к TLS/authSource.
- Строка подключения к Firebird (host/port/db, user/pass, charset).
- Точные имена коллекций в Mongo (если не совпадают с ожидаемыми).
- Путь к `node.exe` на клиентской машине и путь к `import-menu.js`.
- Разрешено ли удалять старые `priceListLine` для `priceListId` при повторном импорте (предпочтительно да)

---

## Appendix: правила среды (выжимка из внутреннего документа команды)

Эти правила относятся к тому, **как писать** VBScript/SQL в Gedemin (Firebird), независимо от конкретной бизнес-логики импорта.

### Firebird version awareness
- Версия Firebird может отличаться. Базово предполагаем совместимость минимум с **Firebird 2.5**.
- Избегать синтаксиса/фич без уверенности в поддержке (например, window functions — только FB 3+).

### SQL style (Firebird)
- Явные `JOIN`, без неоднозначных алиасов.
- `FIRST 1` вместо `LIMIT`.
- Параметризованные запросы (`:param`), **без** конкатенации SQL-строк.

### VBScript ограничения (Gedemin runtime)
- Это не VBA: некоторые функции могут отсутствовать/вести себя иначе.
- Объявление переменных через `Dim`.

### Transactions (critical)
- Всегда явно контролировать транзакцию: `StartTransaction` → `Commit` или `Rollback`.
- Не оставлять транзакцию открытой при ошибках.

### Numbers & locale
- Среда зависит от локали (`,`/`.` как десятичный разделитель).
- Для цен/количеств стараться работать с **числовыми Variant**, а не строковым парсингом.
- При необходимости парсинга строк — нормализовать десятичный разделитель защитно.

### Mongo links must be ObjectId
- Все ссылочные поля в Mongo (`unitId`, `hierarchyId`, `goodId`, `groupId`, `priceListId`, `priceListTypeId`) должны быть **ObjectId**, не строки.
- В Node.js использовать `ObjectId` из `mongodb` и применять его одинаково во всех операциях.


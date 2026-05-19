# mongo-menu-export

Node.js module: read **one** menu from Firebird (Gedemin) and replicate into MongoDB per `PROMPT_firebird_menu_to_mongo.md`.

## Setup

```bash
cd mongo-menu-export
npm install
```

Copy `.env.example` → `.env` and fill real values.

### Firebird

Подключение по **TCP** (`FIREBIRD_HOST`, `FIREBIRD_PORT`): нужен **серверный** Firebird (порт слушает сервер). **Embedded** Firebird не подходит.

Настройка в **`.env`**: **`FIREBIRD_*`** (см. `src/lib/firebirdAttachOptions.js`). Если у сервера только `Legacy_Auth` — ставьте `FIREBIRD_AUTH_PLUGIN=legacy`.

Проверка соединения:

```powershell
npm run test:fb
```

## CLI

Надёжный способ (подходит для Windows PowerShell):

```powershell
node .\src\cli\import-menu.js --menuDocumentKey=12345
```

Или первым аргументом — только число (ID документа меню):

```powershell
node .\src\cli\import-menu.js 12345
```

Из корня пакета через `cmd` (аргументы не теряются):

```powershell
.\import-menu.cmd --menuDocumentKey=12345
.\import-menu.cmd 12345
```

`npm run import-menu -- --menuDocumentKey=12345` на части установок Windows **не передаёт** аргументы в `node`; если так произошло — используйте варианты выше или переменную окружения:

```powershell
$env:MENU_DOCUMENT_KEY = "12345"; npm run import-menu
```

После `npm install -g .` можно вызывать бинарник `import-menu` (если настроен путь к глобальным пакетам).

Результат: `export-menu.result.json` в текущей папке.

## Export halls and tables (full sync)

Экспорт **всех** залов (только с картой в `USR$FRONT_MAP`) и столов в `pos-restaurantHall` / `pos-restaurantTable`. Параметров ID нет.

```powershell
.\export-halls.cmd
```

или:

```powershell
node .\src\cli\export-halls-tables.js
npm run export-halls
```

Результат: `export-halls.result.json` в текущей папке.

## Notes

- В этой базе строки меню связаны с шапкой через `USR$MN_MENULINE.MASTERKEY = <menuDocumentKey>`.
- Коллекции по умолчанию создаются с дефисами: `pos-priceList`, `pos-priceListLine`, `pos-priceListType`, `Good`, `GoodGroup`… Если нужно другое — задайте `COL_*` в `.env`.

## Gedemin

Макросы и include хранятся в проекте Gedemin (не в этом git-репозитории). Вызовы:

- `waiter_LaunchMongoMenuExport(menuDocumentKey)` — меню
- `waiter_LaunchMongoMenuExportHalls()` — залы и столы

Параметры подключения — в `waiter_Options`; Firebird host/port/db — из `IBLogin.DatabaseName` через `ParseFbConn`.

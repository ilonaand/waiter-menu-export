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

## Notes

- В этой базе строки меню связаны с шапкой через `USR$MN_MENULINE.MASTERKEY = <menuDocumentKey>`.
- Коллекции по умолчанию создаются с дефисами: `pos-priceList`, `pos-priceListLine`, `pos-priceListType`, `Good`, `GoodGroup`… Если нужно другое — задайте `COL_*` в `.env`.

## Gedemin launcher

Place `launcher.vbs` where Gedemin macros can reference it (or paste into Gedemin macro).

Edit launcher paths: path to `node.exe`, folder of this package, optionally pass overrides as arguments (`--mongoUri`, `--mongoDb`, `--fb*`).

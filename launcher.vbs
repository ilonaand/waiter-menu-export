Option Explicit
Sub Macros147022951_589124946
' -----------------------------------------------------------------------------
' Лаунчер для кнопки Gedemin: запускает Node CLI импорта меню в MongoDB.
'
' Минимум: задать NODE_EXE_DEFAULT и PKG_DIR_DEFAULT (или передавать nodeExe /
' pkgDir из Gedemin). Папка PKG_DIR содержит .env со строками подключения.
' Дополнительно можно передать Firebird/Mongo параметрами подстановки Gedemin —
' они перекроют переменные окружения из .env.
' Результат: import-menu.result.json в PKG_DIR.
' -----------------------------------------------------------------------------

  Dim NODE_EXE_DEFAULT  ' Пример: "C:\Program Files\nodejs\node.exe"
  Dim PKG_DIR_DEFAULT   ' Пример: "C:\tools\mongo-menu-export"

  dim MONGODB_URI, MONGODB_DB

  NODE_EXE_DEFAULT = "C:\Program Files\nodejs\node.exe"
  PKG_DIR_DEFAULT = "C:\tools\mongo-menu-export"
  MONGODB_URI = "mongodb://"
  MONGODB_DB = "king-pos"

  ' NOTE: placeholders only. Real credentials/hosts must live in `.env` (not committed)
  ' or be passed from Gedemin as parameters.
  call MN_LaunchMongoMenuImport(12345, NODE_EXE_DEFAULT, PKG_DIR_DEFAULT, "127.0.0.1","3050", "C:\path\to\database.fdb", "SYSDBA", "changeme", "UTF8", MONGODB_URI, MONGODB_DB)
end sub

function MN_LaunchMongoMenuImport(ByVal menuDocumentKey, ByVal nodeExe, ByVal pkgDir, ByVal fbHost, ByVal fbPort, ByVal fbDb, ByVal fbUser, ByVal fbPass, ByVal fbCharset, ByVal mongoUri, ByVal mongoDb)
    Dim IMPORT_CLI_REL       ' Пример: "src\cli\import-menu.js"
    Dim RESULT_FILENAME      ' Пример: "import-menu.result.json"
    IMPORT_CLI_REL = "src\cli\import-menu.js"
    RESULT_FILENAME = "import-menu.result.json"
    Dim sh, exe, root, cli, rp, ec, txt, cmdln

    Dim pDir: pDir = Nz(pkgDir)
    Dim nExe: nExe = Nz(nodeExe)

    If Len(pDir) = 0 Then pDir = Nz(PKG_DIR_DEFAULT)
    If Len(nExe) = 0 Then nExe = Nz(NODE_EXE_DEFAULT)

    If Len(pDir) = 0 Or Len(nExe) = 0 Then
      MsgBox "Заполните nodeExe и pkgDir (в параметрах Gedemin или в launcher.vbs).", vbExclamation, "Импорт меню"
      Exit Function
    End If

    If Not FileExists(nExe) Then
      MsgBox "Не найден node.exe:" & vbCrLf & nExe, vbExclamation, "Импорт меню"
      Exit Function
    End If

    If Len(Nz(IMPORT_CLI_REL)) = 0 Then IMPORT_CLI_REL = "src\cli\import-menu.js"
    If Len(Nz(RESULT_FILENAME)) = 0 Then RESULT_FILENAME = "import-menu.result.json"

    root = NormalizeFolder(pDir)
    cli = BuildPathSafe(root, IMPORT_CLI_REL)
    rp = BuildPathSafe(root, RESULT_FILENAME)

    If Len(cli) = 0 Or Not FileExists(cli) Then
      MsgBox "Не найден import-menu.js:" & vbCrLf & cli, vbExclamation, "Импорт меню"
      Exit Function
    End If

    cmdln = Q(nExe) & " " & Q(cli) _
      & " --menuDocumentKey=" & CStr(menuDocumentKey) _
      & " --resultFile=" & Q(rp)

    If Len(Nz(fbHost)) > 0 Then cmdln = cmdln & " --fbHost=" & Q(Nz(fbHost))
    If Len(Nz(fbPort)) > 0 Then cmdln = cmdln & " --fbPort=" & Q(Nz(fbPort))
    If Len(Nz(fbDb)) > 0 Then cmdln = cmdln & " --fbDb=" & Q(Nz(fbDb))
    If Len(Nz(fbUser)) > 0 Then cmdln = cmdln & " --fbUser=" & Q(Nz(fbUser))
    If Len(Nz(fbPass)) > 0 Then cmdln = cmdln & " --fbPass=" & Q(Nz(fbPass))
    If Len(Nz(fbCharset)) > 0 Then cmdln = cmdln & " --fbCharset=" & Q(Nz(fbCharset))
    If Len(Nz(mongoUri)) > 0 Then cmdln = cmdln & " --mongoUri=" & Q(Nz(mongoUri))
    If Len(Nz(mongoDb)) > 0 Then cmdln = cmdln & " --mongoDb=" & Q(Nz(mongoDb))

    Set sh = CreateObject("WScript.Shell")
    sh.CurrentDirectory = root

    ec = sh.Run(cmdln, 0, True)

    txt = ReadAllTextMaybe(rp)
    If ec <> 0 Then
      MsgBox "Ошибка импорта меню." & vbCrLf & "Код процесса: " & ec & vbCrLf & vbCrLf & "Результат: " & rp, vbCritical, "Импорт меню"
      Exit Function
    End If

    If Len(txt) = 0 Then
      MsgBox "Процесс завершился (код 0), но файл результата пуст." & vbCrLf & rp, vbInformation, "Импорт меню"
      Exit Function
    End If

    MsgBox "Импорт меню выполнен." & vbCrLf, vbInformation, "Импорт меню"
  End Function

  Function Nz(ByVal v)
    If IsNull(v) Then
      Nz = ""
    ElseIf IsEmpty(v) Then
      Nz = ""
    Else
      Nz = Trim(CStr(v))
    End If
  End Function

  Function Q(ByVal raw)
    ' Двойные кавычки в середине строки продублируем как для cmd-подобной оболочки
    Dim x: x = CStr(raw)
    x = Replace(x, Chr(34), Chr(34) & Chr(34))
    Q = Chr(34) & x & Chr(34)
  End Function

  Function FileExists(ByVal p)
    On Error Resume Next
    Dim fso: Set fso = CreateObject("Scripting.FileSystemObject")
    FileExists = fso.FileExists(p)
  End Function

  Function NormalizeFolder(ByVal folder)
    Dim fso: Set fso = CreateObject("Scripting.FileSystemObject")
    On Error Resume Next
    NormalizeFolder = fso.GetAbsolutePathName(folder)
    If Len(NormalizeFolder) = 0 Then NormalizeFolder = folder
  End Function

  Function BuildPathSafe(ByVal root, ByVal rel)
    On Error Resume Next
    Dim fso: Set fso = CreateObject("Scripting.FileSystemObject")
    BuildPathSafe = fso.BuildPath(root, rel)
  End Function

  Function ReadAllTextMaybe(ByVal p)
    On Error Resume Next
    Dim fso, ts
    ReadAllTextMaybe = ""
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FileExists(p) Then Exit Function
    Set ts = fso.OpenTextFile(p, 1)
    ReadAllTextMaybe = ts.ReadAll
    ts.Close
  End Function

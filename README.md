# JurassicFox — Entorno de desarrollo Visual FoxPro + Claude

             ==--.
       ..-=="  ,'o`)      `.
     ,'         `"'         \
    :  (                     `.__...._
    |                  )    /         `-=-.
    :       ,vv.-._   /    /               `---==-._
     \/\/\/VV ^ d88`;'    /                         `.
         ``  ^/d88P!'    /             ,              `._
            ^/    !'   ,.      ,      /                  "-,,__,,--'""""-.
           ^/    !'  ,'  \ . .(      (         _           )  ) ) ) ))_,-.\
          ^(__ ,!',"'   ;:+.:%:a.     \:.. . ,'          )  )  ) ) ,"'    '
          ',,,'','     /o:::":%:%a.    \:.:.:         .    )  ) _,'
           """'       ;':::'' `+%%%a._  \%:%|         ;.). _,-""
                  ,-='_.-'      ``:%::)  )%:|        /:._,"
                 (/(/"           ," ,'_,'%%%:       (_,'
                                (  (//(`.___;        \
                                 \     \    `         `
                                  `.    `.   `.        :
                                    \. . .\    : . . . :
                                     \. . .:    `.. . .:
                                      `..:.:\     \:...\
                                       ;:.:.;      ::...:
                                       ):%::       :::::;
                                   __,::%:(        :::::
                                ,;:%%%%%%%:        ;:%::
                                  ;,--""-.`\  ,=--':%:%:\
                                             /-".:%%%%%%%\
                                                 ;,-"'`)%%)  
                                             


Entorno moderno para desarrollar y mantener aplicaciones **Visual FoxPro** desde
**VS Code** asistido por **Claude** a través de un servidor **MCP**
(Model Context Protocol).

Claude puede leer/escribir tus archivos `.prg`, navegar la estructura del proyecto
`.pjx`, inspeccionar tablas `.dbf` (incluidos memos), entender la base de datos
`.dbc`, compilar y ejecutar código vía COM, y detectar código muerto o generar
documentación — todo sin necesidad de tener Visual FoxPro abierto.

---

## Cómo funciona

```text
┌─────────────┐     MCP Protocol     ┌──────────────────┐
│  VS Code    │ ◄──────────────────► │  foxpro-mcp      │
│  + Claude   │                      │  (Bun / Node.js) │
└─────────────┘                      └────────┬─────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              │               │               │
                       ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
                       │ Archivos    │ │ Tablas .dbf │ │ VFP Runtime│
                       │ .prg .scx  │ │ .dbc memos  │ │ vía COM    │
                       └─────────────┘ └─────────────┘ └────────────┘
```

Claude Code (extensión de VS Code) se conecta al servidor MCP que está configurado
en `.claude/settings.json`. Desde ese momento, Claude puede usar las herramientas
de FoxPro directamente en la conversación: leer código, buscar funciones, consultar
tablas, compilar, ejecutar, renombrar procedimientos, detectar código muerto, etc.

---

## Tecnologías

| Componente | Tecnología |
| --- | --- |
| Editor | Visual Studio Code |
| Asistente IA | Claude (via Claude Code extensión o Claude Desktop) |
| Protocolo | MCP — Model Context Protocol |
| Runtime servidor | [Bun](https://bun.sh) 1.0+ |
| Lectura DBF | Lector puro JS (sin ADODB ni drivers externos) |
| Encoding | [iconv-lite](https://github.com/ashtuchkin/iconv-lite) — soporta CP1252, OEM437 y todos los codepages VFP |
| Parser FoxPro | Implementación propia en JS |
| COM Automation | VBScript + cscript.exe (sin módulos nativos) |
| Lenguaje app | Visual FoxPro 9.0 |

---

## Instalación

### Requisitos previos

- Windows 10/11
- [VS Code](https://code.visualstudio.com/)
- [Claude Code](https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code) (extensión de VS Code) **o** [Claude Desktop](https://claude.ai/download)
- [Bun](https://bun.sh) 1.0+
- Visual FoxPro 9.0 instalado (solo para herramientas COM — Fases 5)

### 1. Clonar el repositorio

```powershell
git clone https://github.com/SirWinxas/JurassicFox.git
cd JurassicFox
```

### 2. Instalar Bun (si no lo tienes)

```powershell
irm bun.sh/install.ps1 | iex
```

Cierra y vuelve a abrir el terminal para que el PATH se actualice.

### 3. Instalar dependencias del servidor MCP

```powershell
cd foxpro-mcp
bun install
```

Verifica que todo funciona:

```powershell
bun test
```

Deberías ver `pass, 0 fail`.

### 4. Configurar la ruta de tu proyecto FoxPro

Copia el archivo de ejemplo:

```powershell
copy .claude\settings.example.json .claude\settings.json
```

Edita `.claude/settings.json` y ajusta las rutas:

```json
{
  "mcpServers": {
    "foxpro": {
      "command": "C:\\Users\\TU_USUARIO\\.bun\\bin\\bun.exe",
      "args": ["C:\\ruta\\a\\JurassicFox\\foxpro-mcp\\server.js"],
      "env": {
        "VFP_PROJECT_PATH": "C:\\ruta\\a\\tu\\proyecto\\foxpro"
      }
    }
  }
}
```

### 5. Reiniciar VS Code

Cierra y vuelve a abrir VS Code para que Claude Code cargue el servidor MCP.
A partir de ahora Claude tiene acceso a tu proyecto FoxPro.

> **Claude Desktop**: usa en su lugar `%APPDATA%\Claude\claude_desktop_config.json`.
> Consulta [foxpro-mcp/claude_desktop_config.example.json](foxpro-mcp/claude_desktop_config.example.json).

---

## Herramientas disponibles para Claude

### Código fuente

| Herramienta | Descripción |
| --- | --- |
| `list_prg_files` | Lista archivos `.prg`, `.scx`, `.vcx`, etc. del proyecto |
| `read_prg` | Lee un archivo de código con encoding correcto (CP1252/OEM) |
| `write_prg` | Escribe un archivo con backup automático previo |
| `search_in_code` | Busca texto/regex en todo el código (case-insensitive) |
| `get_procedures` | Extrae PROCEDUREs, FUNCTIONs y DEFINE CLASS de un `.prg` |
| `get_project_tree` | Lee el árbol de archivos de un `.pjx` |

### Base de datos

| Herramienta | Descripción |
| --- | --- |
| `list_dbf_tables` | Lista todas las tablas `.dbf` bajo un directorio |
| `get_table_structure` | Devuelve campos, tipos, longitudes y metadata de un DBF |
| `query_dbf` | Consulta filas con filtros (eq, contains, gt, lt…) |
| `get_record_count` | Cuenta registros totales, activos y borrados |
| `get_dbc_info` | Lee un `.dbc`: tablas, vistas, conexiones, relaciones |
| `read_memo_fields` | Lee campos memo (`.fpt`) de un registro específico |

### Runtime VFP (COM)

Requiere Visual FoxPro 9.0 instalado con servidor COM registrado (`VisualFoxPro.Application`).
VFP arranca en modo invisible, ejecuta la operación y se cierra (~5-10 s de overhead).

| Herramienta | Descripción |
| --- | --- |
| `run_vfp_command` | Ejecuta comandos VFP (PACK, REINDEX, SET…) vía COM |
| `eval_vfp_expression` | Evalúa una expresión VFP (`DATE()`, `RECCOUNT(…)`) y devuelve el resultado |
| `compile_prg` | Compila un `.prg` con VFP y devuelve errores de compilación |
| `run_prg` | Ejecuta un `.prg` y captura el output producido por `?` / `??` |

### Herramientas avanzadas

| Herramienta | Descripción |
| --- | --- |
| `rename_procedure` | Renombra un PROCEDURE/FUNCTION en todos los archivos del proyecto (con backup y modo dryRun) |
| `find_dead_code` | Detecta funciones definidas pero nunca llamadas en el proyecto |
| `generate_docs` | Genera documentación Markdown desde comentarios de cabecera de los `.prg` |
| `git_log` | Historial de commits git del proyecto o de un archivo concreto |
| `git_diff` | Diff git de cambios pendientes, staged o de un commit concreto |

---

## Adaptador HTTP para migraciones

Ademas del servidor MCP por `stdio`, JurassicFox incluye un adaptador HTTP
ligero para scripts de migración o procesos externos que solo necesitan leer
tablas DBF sin hablar el protocolo MCP.

El adaptador vive en `foxpro-mcp/http_adapter.js` y expone:

| Endpoint | Método | Uso |
| --- | --- | --- |
| `/health` | `GET` | Comprueba estado, ruta VFP activa y límite de filas |
| `/query` | `POST` | Consulta una tabla DBF y devuelve todos los registros paginando internamente |

Arranque desde `foxpro-mcp`:

```powershell
$env:VFP_PROJECT_PATH="C:\BitTPV44\Datos"
npm run http -- --port 3100
```

También puede ejecutarse directamente:

```powershell
$env:VFP_PROJECT_PATH="C:\BitTPV44\Datos"
node .\http_adapter.js --port 3100
```

Ejemplo de consulta:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3100/query `
  -ContentType "application/json" `
  -Body '{"table":"articulos","where":[{"field":"ACTIVO","op":"eq","value":true}]}'
```

Notas operativas:

- Solo escucha en `127.0.0.1`.
- Usa el lector DBF existente de JurassicFox.
- Acepta nombres de tabla con o sin extensión `.dbf`.
- Incrementa `VFP_MAX_QUERY_ROWS` a `50000` si no está definido.
- Devuelve `{ rows, count }`, pensado para pipelines DBF → PostgreSQL/SQLite.

---

## Seguridad

- **Backups automáticos** antes de cada `write_prg` y `rename_procedure` en `.mcp_backups/`
- **Log de auditoría** en `.mcp_logs/mcp-audit.log` con timestamp de cada cambio
- **Path traversal bloqueado**: las herramientas no pueden salir de `VFP_PROJECT_PATH`
- **Escritura opcional**: pon `VFP_ALLOW_WRITE=false` para modo solo lectura

---

## Variables de entorno

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `VFP_PROJECT_PATH` | (requerido) | Ruta raíz del proyecto FoxPro |
| `VFP_ENCODING` | `cp1252` | Codepage por defecto para archivos `.prg` |
| `VFP_ALLOW_WRITE` | `true` | Permite escritura (`write_prg`, `rename_procedure`) |
| `VFP_MAX_FILE_SIZE` | `5MB` | Tamaño máximo de archivo para `read_prg` |
| `VFP_MAX_SEARCH_RESULTS` | `500` | Límite de resultados de `search_in_code` |
| `VFP_MAX_QUERY_ROWS` | `1000` | Límite de filas de `query_dbf` |
| `VFP_BACKUPS_DIR` | `.mcp_backups/` | Carpeta de backups |
| `VFP_LOGS_DIR` | `.mcp_logs/` | Carpeta de logs de auditoría |
| `VFP_COM_PROGID` | `VisualFoxPro.Application` | ProgID del servidor COM de VFP |
| `VFP_COM_TIMEOUT` | `60000` | Timeout en ms para operaciones COM |

---

## Estructura del repositorio

```text
JurassicFox/
├── .claude/
│   ├── settings.example.json    Plantilla de configuración MCP para Claude Code
│   └── settings.json            Configuración activa (no se sube al repo)
├── .vscode/
│   ├── settings.json            Asociaciones de archivos FoxPro, encoding CP1252
│   ├── tasks.json               Tareas: compilar, ejecutar, abrir VFP IDE
│   ├── extensions.json          Extensiones recomendadas
│   └── foxpro-snippets.code-snippets
├── foxpro-mcp/                  Servidor MCP
│   ├── server.js                Punto de entrada (stdio MCP)
│   ├── config.js                Variables de entorno + protección path traversal
│   ├── http_adapter.js          Adaptador HTTP ligero para migraciones
│   ├── tools/
│   │   ├── file_tools.js        Herramientas de código fuente (Fase 3)
│   │   ├── dbf_tools.js         Herramientas de base de datos (Fase 4)
│   │   ├── vfp_tools.js         Integración COM con runtime VFP (Fase 5)
│   │   └── advanced_tools.js    Refactoring, dead code, docs, git (Fase 6)
│   ├── utils/
│   │   ├── foxpro_parser.js     Parser de PROCEDURE/FUNCTION/DEFINE CLASS
│   │   ├── dbf_reader.js        Lector DBF puro JS (sin ADODB)
│   │   ├── encoding.js          Codepages VFP (CP1252, OEM437…)
│   │   ├── backup.js            Backups automáticos con timestamp
│   │   ├── cache.js             Caché por mtime para evitar relecturas
│   │   └── logger.js            Logs de auditoría y errores
│   ├── test/
│   │   ├── dbf_reader.test.js
│   │   ├── encoding.test.js
│   │   ├── parser.test.js
│   │   ├── advanced_tools.test.js
│   │   └── cache.test.js
│   ├── claude_desktop_config.example.json
│   └── README.md                Documentación técnica del servidor MCP
├── plan_desarrollo_foxpro_vscode.md
└── plan_migracion_comercio365.md
```

---

## Licencia

MIT

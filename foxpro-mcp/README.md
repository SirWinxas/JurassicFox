# foxpro-mcp

Servidor MCP (Model Context Protocol) que expone proyectos Visual FoxPro a Claude.
Implementado en JavaScript y ejecutado con **Bun**.

## Requisitos

- **Bun 1.0+** ([instalaci n](https://bun.sh))
- Windows / macOS / Linux (lectura de DBF funciona en cualquier OS)
- Para integraci n con VFP via COM (no incluido en esta versi n) se requiere Windows + VFP9

## Instalaci n

```powershell
bun install
```

## Configuraci n

El servidor se configura mediante variables de entorno (normalmente desde el
`claude_desktop_config.json`). Solo `VFP_PROJECT_PATH` es obligatoria.

| Variable                  | Default                         | Descripci n                                                |
|---------------------------|---------------------------------|------------------------------------------------------------|
| `VFP_PROJECT_PATH`        | (sin valor: error)              | Carpeta ra z del proyecto FoxPro                           |
| `VFP_BACKUPS_DIR`         | `<proyecto>/.mcp_backups`       | D nde guardar backups antes de sobreescribir               |
| `VFP_LOGS_DIR`            | `<proyecto>/.mcp_logs`          | D nde guardar logs de auditor a y errores                  |
| `VFP_ENCODING`            | `cp1252`                        | Encoding por defecto para `.prg`                           |
| `VFP_ALLOW_WRITE`         | `true`                          | Permitir `write_prg`. Pon `false` para modo solo lectura   |
| `VFP_MAX_FILE_SIZE`       | `5242880` (5 MB)                | Tama o m ximo de archivo le ble                            |
| `VFP_MAX_SEARCH_RESULTS`  | `500`                           | L mite de resultados en `search_in_code`                   |
| `VFP_MAX_QUERY_ROWS`      | `1000`                          | L mite de filas en `query_dbf`                             |

## Registrar en Claude Desktop

Edita `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "foxpro": {
      "command": "bun",
      "args": [
        "C:/Users/TU_USUARIO/Desktop/proyectos/JurassicFox/foxpro-mcp/server.js"
      ],
      "env": {
        "VFP_PROJECT_PATH": "C:/ruta/a/tu/proyecto/foxpro",
        "VFP_ALLOW_WRITE": "true"
      }
    }
  }
}
```

Reinicia Claude Desktop tras editar el archivo.

> Hay una plantilla lista para copiar en
> [claude_desktop_config.example.json](claude_desktop_config.example.json).

### Alternativa: ejecutable nativo

`bun build --compile` genera un ejecutable est tico que no requiere tener Bun
instalado en runtime:

```powershell
bun run build
```

Y luego en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "foxpro": {
      "command": "C:/.../foxpro-mcp/foxpro-mcp.exe",
      "env": { "VFP_PROJECT_PATH": "C:/..." }
    }
  }
}
```

## Tests

```powershell
bun test
```

Cubren:
- Parser de PROCEDUREs/FUNCTIONs/DEFINE CLASS con continuaci n `;` y comentarios
- Lector DBF: header, registros, filtros, registros borrados, conteo
- Encoding: roundtrip CP1252, mapeo de codepage byte, detecci n autom tica

## Adaptador HTTP

`http_adapter.js` permite usar el lector DBF desde procesos externos sin
registrar un cliente MCP. Esta pensado para migraciones de datos, auditorias e
integraciones temporales como Comercio365.

Arranque:

```powershell
$env:VFP_PROJECT_PATH="C:\BitTPV44\Datos"
npm run http -- --port 3100
```

Tambien se puede ejecutar sin script:

```powershell
$env:VFP_PROJECT_PATH="C:\BitTPV44\Datos"
node .\http_adapter.js --port 3100
```

Endpoints:

| Endpoint | Metodo | Body | Respuesta |
| -------- | ------ | ---- | --------- |
| `/health` | `GET` | - | `{ ok, projectPath, maxQueryRows }` |
| `/query` | `POST` | `{ "table": "articulos", "where": [...] }` | `{ rows, count }` |

Ejemplo:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3100/query `
  -ContentType "application/json" `
  -Body '{"table":"clientes"}'
```

Detalles:

- Escucha solamente en `127.0.0.1`.
- Resuelve tablas con o sin extension `.dbf`.
- Realiza paginacion interna de 10.000 filas para devolver todos los registros.
- Usa `VFP_MAX_QUERY_ROWS=50000` por defecto si no se ha definido otro valor.
- Reutiliza `query_dbf` y las protecciones de ruta de `config.js`.

## Arquitectura

```
server.js                Stdio + registro de herramientas con @modelcontextprotocol/sdk
config.js                Resoluci n de env vars + path traversal protection
http_adapter.js          API local GET /health y POST /query para migraciones
tools/
  file_tools.js          Fase 3: c digo fuente
  dbf_tools.js           Fase 4: tablas DBF
utils/
  foxpro_parser.js       Parser ligero de PROCEDURE/FUNCTION/DEFINE CLASS
  dbf_reader.js          Lector DBF puro JS (sin VFP runtime ni ADODB)
  encoding.js            iconv-lite con mapping de codepages VFP
  backup.js              Backups con timestamp en .mcp_backups/
  logger.js              Logs de auditor a + errores
```

### Por qu  un lector DBF puro JS

La alternativa (`node-adodb` + Microsoft Visual FoxPro 9.0 OLE DB Provider) tiene
varias desventajas:

- Solo funciona en Windows
- Requiere VFP9 OLE DB Provider instalado (no es trivial)
- Es lento porque spawna procesos `cscript.exe` por consulta
- Bloquea tablas en uso por el VFP en ejecuci n

El lector puro JS de [utils/dbf_reader.js](utils/dbf_reader.js):

- Funciona en cualquier OS
- Lee directamente los bytes (rapid simo)
- Lectura compartida, no bloquea
- Soporta tipos VFP completos: C, N, F, D, T, L, M, B, I, Y, G, V, Q
- Lee memos `.fpt` con header big-endian
- Detecta codepage del header (byte 29)

Para Fase 5 (ejecuci n de comandos VFP via COM) se a adir  un m dulo separado
con `winax`, que solo funciona en Windows y solo se activa cuando se necesita.

## Seguridad

- `resolveSafe()` valida que toda ruta resuelta cae dentro de `VFP_PROJECT_PATH`
- `write_prg` siempre hace backup antes de sobreescribir
- Toda escritura queda registrada en `mcp-audit.log` con timestamp
- `VFP_ALLOW_WRITE=false` deshabilita las modificaciones por completo

## Licencia

MIT

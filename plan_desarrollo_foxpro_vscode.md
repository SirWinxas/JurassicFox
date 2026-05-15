# Plan de Desarrollo: Integración FoxPro + VS Code + MCP

## Visión General

Construir un entorno de desarrollo moderno para aplicaciones Visual FoxPro (VFP),
utilizando VS Code como editor principal y un servidor MCP (Model Context Protocol)
que permita a Claude interactuar directamente con el código fuente `.prg` y las
tablas `.dbf` de la aplicación.

---

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────┐
│                  DESARROLLADOR                  │
└──────────────────────┬──────────────────────────┘
                       │
         ┌─────────────▼─────────────┐
         │      VS Code + Claude     │
         │  (Editor + Asistente IA)  │
         └─────────────┬─────────────┘
                       │ MCP Protocol
         ┌─────────────▼─────────────┐
         │      MCP Server           │
         │      (Node.js)            │
         └──────┬────────────┬───────┘
                │            │
   ┌────────────▼──┐    ┌────▼──────────────┐
   │  Archivos     │    │  VFP Runtime       │
   │  .prg .scx    │    │  (COM Automation)  │
   │  .vcx .dbc    │    └────────────────────┘
   └───────────────┘
         │
   ┌─────▼──────────┐
   │  Tablas .dbf   │
   │  (ADODB/DBF)   │
   └────────────────┘
```

---

## Fases de Desarrollo

### FASE 1 — Entorno Base en VS Code
**Duración estimada: 1-2 días**

Objetivo: tener VS Code listo para editar código FoxPro con soporte básico.

#### Tareas

- [ ] Instalar extensión **VFP Language Support** (syntax highlighting `.prg`, `.scx`, `.vcx`)
- [ ] Instalar extensión **DBF Viewer Plus** (visualizar tablas `.dbf` desde VS Code)
- [ ] Configurar carpeta del proyecto con estructura estándar
- [ ] Crear `.vscode/tasks.json` para:
  - Ejecutar archivo `.prg` actual en VFP
  - Compilar proyecto completo
  - Abrir VFP IDE desde VS Code
- [ ] Crear `.vscode/settings.json` con asociaciones de archivos FoxPro
- [ ] Crear `.gitignore` adaptado a proyectos VFP

#### Entregables
- Proyecto FoxPro abierto y navegable en VS Code
- Atajos de teclado para compilar/ejecutar

---

### FASE 2 — MCP Server: Estructura Base
**Duración estimada: 2-3 días**

Objetivo: crear el servidor MCP Node.js que Claude pueda usar como herramienta.

#### Estructura de archivos del proyecto MCP

```
foxpro-mcp/
├── package.json
├── server.js              ← Punto de entrada MCP
├── tools/
│   ├── file_tools.js      ← Leer/escribir archivos .prg
│   ├── dbf_tools.js       ← Acceso a tablas .dbf
│   └── vfp_tools.js       ← COM automation con VFP
├── utils/
│   ├── foxpro_parser.js   ← Parser básico de sintaxis VFP
│   └── dbf_reader.js      ← Lectura de archivos DBF
└── README.md
```

#### Tareas

- [ ] Inicializar proyecto Node.js con `npm init`
- [ ] Instalar dependencias base:
  - `@modelcontextprotocol/sdk` — framework MCP
  - `node-adodb` — acceso ADODB a DBF/VFP
  - `@mapbox/node-dbf` — lectura directa de archivos DBF
  - `winax` o `win32ole` — COM automation con VFP (Windows)
- [ ] Implementar estructura base del servidor MCP
- [ ] Registrar el servidor en Claude Desktop (`claude_desktop_config.json`)
- [ ] Prueba de conexión básica

#### Entregables
- Servidor MCP arrancando sin errores
- Claude reconoce el servidor como herramienta disponible

---

### FASE 3 — Herramientas de Código Fuente
**Duración estimada: 3-4 días**

Objetivo: que Claude pueda leer, entender y modificar archivos `.prg`.

#### Herramientas a implementar

| Herramienta        | Descripción                                              |
|--------------------|----------------------------------------------------------|
| `list_prg_files`   | Lista todos los `.prg`, `.scx`, `.vcx` del proyecto      |
| `read_prg`         | Lee el contenido completo de un archivo `.prg`           |
| `write_prg`        | Escribe o sobreescribe un archivo `.prg`                 |
| `search_in_code`   | Busca texto o función en todos los archivos del proyecto |
| `get_procedures`   | Extrae lista de PROCEDUREs y FUNCTIONs de un archivo     |
| `get_project_tree` | Devuelve árbol de archivos del proyecto `.pjx`           |

#### Tareas

- [ ] Implementar `list_prg_files` con filtros por extensión
- [ ] Implementar `read_prg` con encoding correcto (CP1252/Latin1 habitual en VFP)
- [ ] Implementar `write_prg` con backup automático antes de sobreescribir
- [ ] Implementar `search_in_code` con expresiones regulares
- [ ] Implementar parser básico para extraer PROCEDUREs y FUNCTIONs
- [ ] Leer archivos `.pjx` (son DBF internamente) para obtener el árbol del proyecto

#### Entregables
- Claude puede leer cualquier archivo del proyecto
- Claude puede modificar código fuente con confirmación
- Claude puede buscar funciones y procedimientos

---

### FASE 4 — Herramientas de Base de Datos DBF
**Duración estimada: 3-4 días**

Objetivo: que Claude pueda consultar y manipular las tablas `.dbf`.

#### Herramientas a implementar

| Herramienta          | Descripción                                          |
|----------------------|------------------------------------------------------|
| `list_dbf_tables`    | Lista todas las tablas `.dbf` de un directorio       |
| `get_table_structure`| Devuelve campos, tipos y longitudes de una tabla     |
| `query_dbf`          | Ejecuta una consulta SELECT sobre una tabla DBF      |
| `get_record_count`   | Cuenta registros (total y activos/borrados)          |
| `get_dbc_info`       | Información de la base de datos `.dbc` (relaciones)  |
| `read_memo_fields`   | Lee campos memo `.fpt` asociados                     |

#### Tareas

- [ ] Configurar acceso ADODB con driver **Microsoft Visual FoxPro OLE DB**
- [ ] Implementar `list_dbf_tables` recursivo por directorio
- [ ] Implementar `get_table_structure` usando ADODB schema
- [ ] Implementar `query_dbf` con SELECT básico y filtros
- [ ] Manejar encoding de datos (OEM/ANSI según tabla)
- [ ] Implementar lectura de archivos `.dbc` para obtener relaciones entre tablas
- [ ] Gestión de errores para tablas bloqueadas o en uso

#### Entregables
- Claude puede inspeccionar cualquier tabla DBF
- Claude puede hacer consultas para entender los datos
- Claude conoce la estructura relacional de la base de datos

---

### FASE 5 — Integración con VFP Runtime (COM)
**Duración estimada: 2-3 días**

Objetivo: ejecutar código VFP directamente desde el MCP server.

#### Herramientas a implementar

| Herramienta          | Descripción                                              |
|----------------------|----------------------------------------------------------|
| `run_vfp_command`    | Ejecuta un comando VFP via COM y devuelve resultado      |
| `compile_prg`        | Compila un archivo `.prg` y reporta errores              |
| `run_prg`            | Ejecuta un `.prg` y captura output                       |
| `eval_vfp_expression`| Evalúa una expresión VFP y devuelve el valor             |

#### Tareas

- [ ] Instanciar objeto COM de VFP: `new ActiveXObject("VisualFoxPro.Application")`
- [ ] Implementar `run_vfp_command` con captura de errores VFP
- [ ] Implementar `compile_prg` y parsear mensajes de error del compilador
- [ ] Gestionar instancia COM (singleton, reconexión si falla)
- [ ] Implementar timeout para comandos que tarden demasiado

#### Entregables
- Claude puede compilar y detectar errores de sintaxis
- Claude puede ejecutar fragmentos de código VFP para probar lógica

---

### FASE 6 — Pulido y Herramientas Avanzadas
**Duración estimada: 3-5 días**

Objetivo: mejorar la experiencia y añadir funcionalidades de productividad.

#### Tareas

- [ ] **Logging y auditoría**: registrar todas las modificaciones de código con timestamp
- [ ] **Backups automáticos**: versionar archivos modificados en carpeta `.mcp_backups/`
- [ ] **Caché de estructura**: no releer la DBF si no ha cambiado (por fecha de modificación)
- [ ] **Herramienta de refactoring**: renombrar procedimiento en todos los archivos
- [ ] **Detector de código muerto**: funciones definidas pero no llamadas
- [ ] **Generador de documentación**: extraer comentarios y generar Markdown
- [ ] **Integración con Git**: `git diff`, `git log` sobre archivos VFP desde el MCP

#### Entregables
- Entorno robusto y seguro para modificar código en producción
- Historial de cambios realizados por Claude

---

## Stack Tecnológico

| Componente        | Tecnología                              |
|-------------------|-----------------------------------------|
| Editor            | Visual Studio Code                      |
| Asistente IA      | Claude (via Claude Desktop)             |
| Protocolo         | MCP (Model Context Protocol)            |
| MCP Server        | Node.js 18+                             |
| Acceso DBF        | node-adodb + VFP OLE DB Provider        |
| COM Automation    | winax (Node.js → COM → VFP)             |
| Lenguaje app      | Visual FoxPro 9.0                       |
| Control versiones | Git (recomendado)                       |

---

## Prerrequisitos del Sistema

- Windows 10/11 (necesario para COM y VFP OLE DB)
- Visual FoxPro 9.0 instalado
- **Microsoft Visual FoxPro 9.0 OLE DB Provider** instalado
- Node.js 18 o superior
- VS Code (última versión estable)
- Claude Desktop (para usar el MCP)
- Git (recomendado)

---

## Configuración de Claude Desktop

Una vez construido el servidor, añadir a `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "foxpro": {
      "command": "node",
      "args": ["C:/ruta/a/foxpro-mcp/server.js"],
      "env": {
        "VFP_PROJECT_PATH": "C:/ruta/a/tu/proyecto/foxpro"
      }
    }
  }
}
```

---

## Riesgos y Mitigaciones

| Riesgo                               | Mitigación                                          |
|--------------------------------------|-----------------------------------------------------|
| Claude modifica código incorrecto    | Backup automático antes de cada escritura           |
| Tablas DBF bloqueadas por VFP        | Modo lectura compartida, manejo de errores robusto  |
| COM automation inestable             | Watchdog + reconexión automática                    |
| Encoding incorrecto en PRGs          | Detectar y respetar CP1252/OEM según archivo        |
| Archivos compilados (.fxp) desactualizados | Compilar automáticamente tras modificar .prg  |

---

## Resumen de Plazos

| Fase | Descripción                    | Días estimados |
|------|--------------------------------|----------------|
| 1    | Entorno base VS Code           | 1-2            |
| 2    | MCP Server estructura base     | 2-3            |
| 3    | Herramientas de código fuente  | 3-4            |
| 4    | Herramientas de base de datos  | 3-4            |
| 5    | Integración COM con VFP        | 2-3            |
| 6    | Pulido y herramientas avanzadas| 3-5            |
| **Total** |                           | **14-21 días** |

---

*Documento generado para el proyecto de integración FoxPro + VS Code + MCP*

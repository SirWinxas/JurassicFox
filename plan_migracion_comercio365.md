# Plan de Migración — Comercio365 TPV
**BitTPV44 (Visual FoxPro 9) → React + Electron + Node.js**

> Versión 1.0 · 2026-05-18 · Codebit Development

---

## 1. Contexto

### Estado actual
BitTPV44 es un TPV en producción desarrollado desde el año 2000 en Visual FoxPro 9:

| Métrica | Valor |
|---|---|
| Archivos de código (.prg) | 108 archivos |
| Líneas de código | ~21.600 líneas |
| Formularios (.scx) | 150+ formularios |
| Librerías de clases (.vcx) | 20 librerías |
| Años en producción | 25+ años |
| Cumplimiento fiscal | TicketBAI · Verifactu · FacturaE |

### Motivación
- VFP9 sin soporte oficial desde 2015 (sin parches de seguridad)
- Limitaciones de UI insuperables (sin responsive, sin touch nativo, sin fuentes modernas)
- Imposible contratar desarrolladores VFP en el mercado actual
- El diseño Comercio365 ya está especificado y requiere tecnología web
- JurassicFox MCP ya existe como puente Node.js ↔ VFP (ventaja de partida)

### Objetivo
Reemplazar BitTPV44 por **Comercio365**, un TPV moderno con la misma funcionalidad de negocio, cumplimiento fiscal completo y experiencia de usuario radicalmente mejorada.

---

## 2. Stack tecnológico objetivo

```
┌──────────────────────────────────────────────────────────┐
│  CAPA DE PRESENTACIÓN                                    │
│  React 19 + TypeScript + Tailwind CSS                    │
│  Electron 32 (shell de escritorio)                       │
├──────────────────────────────────────────────────────────┤
│  CAPA DE APLICACIÓN                                      │
│  Node.js + Hono (API REST interna)                       │
│  Estado: Zustand · Formularios: React Hook Form          │
│  Impresión: node-escpos (tickets) + Electron print API   │
├──────────────────────────────────────────────────────────┤
│  CAPA DE DATOS                                           │
│  PostgreSQL (producción) / SQLite (instalación local)    │
│  Prisma ORM · Migraciones versionadas                    │
├──────────────────────────────────────────────────────────┤
│  PUENTE DE TRANSICIÓN (temporal — Fases 1 y 2)          │
│  JurassicFox MCP — llama a VFP9 via COM                  │
│  Para: TicketBAI · Verifactu · Hardware legacy           │
└──────────────────────────────────────────────────────────┘
```

### Justificación de elecciones

| Tecnología | Alternativa descartada | Motivo |
|---|---|---|
| Electron | Web puro (browser) | El TPV necesita acceso a COM ports, impresoras, cajón |
| PostgreSQL | MySQL | JSONB nativo, mejor para datos de ticket complejos |
| Hono | Express | Más ligero, TypeScript first, misma API |
| Prisma | Knex / Sequelize | Migrations + type-safety sin configuración extra |
| Zustand | Redux | Un TPV no necesita Redux; menos boilerplate |

---

## 3. Mapa de componentes a migrar

### 3.1 Por dificultad y riesgo

```
RIESGO BAJO ──────────────────────────────────── RIESGO ALTO
    │                                                  │
    ▼                                                  ▼
 UI/Pantallas        Lógica TPV         Fiscal / Hardware
 (React — fácil)  (Node.js — media)   (VFP via COM — mantener)

 waccesotactil      inicio.prg          ticketbai.prg
 wtpvtactil         calculos.prg        verifactu_generar.prg
 wmesas             entorno.prg         facturae.prg (1.050 líneas)
 wcajaeurtactil     borrar.prg          cajon.prg
 warticulos         indices.prg         Drivers de balanza / display
 wclientes          actprefs.prg
```

### 3.2 Inventario de módulos

| Módulo | PRGs VFP | Pantallas | Prioridad | Fase |
|---|---|---|---|---|
| Autenticación de usuarios | `acceso.prg` | `wacceso*` | Alta | 1 |
| Sesión TPV (ventas) | `inicio.prg`, `entorno.prg` | `wtpvtactil`, `wmesas` | Alta | 1 |
| Cobro y caja | `calculos.prg`, `cajon.prg` | `wcajaeurtactil`, `wfpago*` | Alta | 1 |
| Artículos y familias | `codbar.prg` | `warticulos`, `wfamilias` | Media | 2 |
| Clientes y fidelización | — | `wclientes`, `wpuntos` | Media | 2 |
| Gestión de stock | — | `walbcompra`, `wmovalmacen` | Media | 2 |
| Informes y listados | `informes.prg` | `wlist*` (30+ forms) | Baja | 3 |
| Configuración (Prefs) | `actprefs.prg` (873 líneas) | `wprefs` | Baja | 3 |
| TicketBAI | 20 PRGs · 2.500 líneas | — | **Crítica** | Puente |
| Verifactu | 4 PRGs · 1.200 líneas | — | **Crítica** | Puente |
| FacturaE | `facturae.prg` · 1.050 líneas | — | **Crítica** | Puente |

---

## 4. Fases del proyecto

### Fase 0 — Fundamentos (completada parcialmente)
**Duración estimada:** 3 semanas · **Estado:** En curso

- [x] Especificación de diseño Comercio365 (paleta, tipografía, componentes)
- [x] JurassicFox MCP server — puente Node.js ↔ VFP (v0.3.0)
- [x] Theming aplicado a BitTPV44 (bitmaps planos + colores + fuentes)
- [ ] Repositorio Git del nuevo proyecto Comercio365
- [ ] Pipeline CI/CD básico (GitHub Actions)
- [ ] Entorno de desarrollo Electron + React funcionando

---

### Fase 1 — MVP: UI nueva, lógica VFP
**Duración estimada:** 8 semanas
**Objetivo:** Una sesión de TPV completa (login → venta → cobro → ticket) funcionando en Electron, con la lógica de negocio todavía ejecutándose en VFP via JurassicFox.

#### Semanas 1–2: Shell Electron + Design System
- [ ] Proyecto Electron + React + TypeScript + Tailwind scaffolding
- [ ] Componentes base del Design System:
  - `Button` (primary / secondary / ghost / danger)
  - `Card` (producto, categoría, comanda)
  - `NumPad` (teclado numérico táctil)
  - `Modal` y `Drawer`
  - `Badge`, `Avatar`, `Spinner`
- [ ] Layout de 3 columnas del TPV (sidebar · grilla · comanda)
- [ ] Modo kiosk de Electron (pantalla completa, sin chrome)

#### Semanas 3–4: Autenticación y sesión
- [ ] Pantalla de login (`/login`) con selector de usuario + PIN
  - Datos: `query_dbf('usuarios.dbf')` via JurassicFox
- [ ] Estado de sesión global (Zustand): usuario, turno, configuración
- [ ] Protección de rutas por nivel de acceso (`nNAcceso[]` del VFP)
- [ ] Cierre de sesión y bloqueo de pantalla

#### Semanas 5–6: Pantalla principal TPV
- [ ] Vista de mesas (`/mesas`) — grid configurable
- [ ] Vista de artículos (`/tpv`) — categorías + productos
  - Datos: JurassicFox `query_dbf` sobre `familias.dbf` y `articulos.dbf`
- [ ] Comanda derecha: añadir líneas, cambiar cantidad, eliminar
- [ ] Buscador de artículos por nombre y código de barras

#### Semanas 7–8: Cobro y ticket
- [ ] Pantalla de cobro (`/cobro`) — efectivo, tarjeta, mixto
- [ ] Cálculo de cambio y vuelto
- [ ] Apertura de cajón via JurassicFox (`run_vfp_command "DO cajon"`)
- [ ] Impresión de ticket via JurassicFox (`DO iticket`)
- [ ] Generación TicketBAI/Verifactu via JurassicFox (llama al PRG VFP)

**Entregable:** Demo funcional instalable. Un camarero puede hacer una venta completa.

---

### Fase 2 — Migración de lógica de negocio
**Duración estimada:** 16 semanas
**Objetivo:** Reemplazar las llamadas a VFP por lógica propia en Node.js + PostgreSQL.

#### Sprint 1 (sem. 1–3): Base de datos
- [ ] Diseño del esquema PostgreSQL desde la estructura de los DBF:
  - `usuarios`, `familias`, `articulos`, `clientes`, `ivas`
  - `tickets`, `lineasticket`, `caja`, `turnos`
  - `prefs`, `delegaciones`, `vendedores`
- [ ] Script de migración de datos: DBF → PostgreSQL
  - Usar `query_dbf` de JurassicFox para extraer registros
  - Normalizar codepages CP1252 → UTF-8
- [ ] Prisma schema + migraciones iniciales
- [ ] Seed de datos de prueba

#### Sprint 2 (sem. 4–6): API de catálogo
- [ ] `GET /api/familias` — árbol de categorías
- [ ] `GET /api/articulos` — con filtros, búsqueda, paginación
- [ ] `GET /api/articulos/:id` — detalle con imagen, opciones, extras
- [ ] `POST /api/articulos` — alta desde gestión
- [ ] Precios especiales, ofertas, descuentos por familia

#### Sprint 3 (sem. 7–9): Motor de ventas
- [ ] Modelo `Ticket` con líneas, descuentos, IVAs
- [ ] Cálculo de totales (replicar `calculos.prg`)
- [ ] Apertura / cierre de turno
- [ ] Gestión de mesas (ocupar, liberar, traspasar, partir)
- [ ] Comanda a cocina (impresora de cocina)

#### Sprint 4 (sem. 10–12): Clientes y fidelización
- [ ] CRUD clientes con búsqueda
- [ ] Sistema de puntos y fidelización
- [ ] Vales descuento
- [ ] Historial de compras por cliente

#### Sprint 5 (sem. 13–16): Gestión de almacén
- [ ] Albaranes de compra y entrada de stock
- [ ] Movimientos de almacén
- [ ] Inventario y regularización
- [ ] Alertas de stock mínimo

**Entregable:** VFP ya no es necesario para el flujo de venta. Solo se usa para fiscal.

---

### Fase 3 — Informes, configuración y pulido
**Duración estimada:** 8 semanas
**Objetivo:** Paridad funcional completa con BitTPV44.

#### Informes
- [ ] Dashboard de ventas del día (reemplaza `wrescaja`)
- [ ] Listado de tickets (reemplaza `wlisttickets`)
- [ ] Resumen de ventas por familia / artículo / vendedor
- [ ] Exportación a Excel (xlsx) y PDF
- [ ] Cierre de caja con desglose de IVAs

#### Configuración
- [ ] Panel de preferencias (reemplaza `wprefs` — 30 tabs)
- [ ] Gestión de usuarios y permisos (reemplaza `wusuarios`)
- [ ] Configuración de impresoras y hardware
- [ ] Gestión de familias, artículos, IVAs desde la propia app

#### Calidad
- [ ] Tests unitarios de la lógica de cálculo (Jest)
- [ ] Tests E2E del flujo de venta (Playwright)
- [ ] Tests de migración de datos (comparar totales DBF vs. PostgreSQL)
- [ ] Auditoría de seguridad (acceso a datos, rutas protegidas)

**Entregable:** Comercio365 puede ejecutarse en producción SIN BitTPV44.

---

### Fase 4 — Fiscal nativo (opcional / largo plazo)
**Duración estimada:** 12–18 meses
**Objetivo:** Eliminar la dependencia de VFP para la parte fiscal.

> ⚠️ Esta fase requiere asesoría legal y certificación por parte de la AEAT y las haciendas forales. No iniciar sin validación jurídica.

- [ ] Implementar generación de XML TicketBAI en TypeScript
  - Firma digital con certificado X.509 (librería `xmldsigjs`)
  - Integración con API LROE del Gobierno Vasco / Navarra / Álava
- [ ] Implementar Verifactu en TypeScript
  - Seguir especificación técnica AEAT (versión vigente)
  - Hash encadenado de registros (`huella` anterior)
- [ ] Implementar FacturaE (si aplica)
- [ ] Suite de pruebas contra sandbox de cada hacienda
- [ ] Certificación y homologación

**Entregable:** Comercio365 sin ninguna dependencia de VFP9.

---

## 5. Riesgos y mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Error en cálculos fiscales | Media | **Crítico** | Mantener VFP como fallback hasta certificar |
| Pérdida de datos en migración DBF→PG | Baja | Alto | Validar totales antes/después + rollback |
| Comportamiento de la impresora de tickets | Media | Alto | Probar node-escpos con los modelos reales |
| Regresión en reglas de negocio oscuras | Alta | Medio | Tests contra datos reales del año anterior |
| Rechazo del usuario (cambio de hábito) | Media | Medio | Modo de entrenamiento, pilot en 1 terminal |
| Cambio normativo fiscal durante el proyecto | Media | Alto | Arquitectura de adaptadores intercambiables |

---

## 6. Criterios de éxito por fase

| Fase | Criterio de aceptación |
|---|---|
| **Fase 1** | Un turno completo (apertura → ventas → cierre) sin tocar BitTPV44 para la UI |
| **Fase 2** | VFP COM no se llama para ninguna operación de venta o catálogo |
| **Fase 3** | Todos los informes de BitTPV44 tienen equivalente en Comercio365 |
| **Fase 4** | Un TicketBAI generado por Comercio365 es aceptado por la hacienda foral |

---

## 7. Estructura del repositorio propuesta

```
comercio365/
├── apps/
│   ├── desktop/          # Electron shell
│   └── web/              # React SPA (también deployable en tablet)
├── packages/
│   ├── ui/               # Design System (componentes compartidos)
│   ├── api/              # Servidor Hono (Node.js)
│   ├── db/               # Prisma schema + migraciones
│   ├── fiscal/           # Módulo fiscal (inicialmente wraps VFP)
│   └── hardware/         # Cajón, impresoras, balanza, display
├── tools/
│   ├── migration/        # Scripts DBF → PostgreSQL
│   └── jurassicfox/      # MCP server (puente VFP — ya existe)
└── docs/
    ├── design/           # Especificación Comercio365
    └── fiscal/           # Documentación técnica TicketBAI / Verifactu
```

---

## 8. Estimación de esfuerzo

| Fase | Duración | Perfil |
|---|---|---|
| Fase 0 (fundamentos) | 3 semanas | 1 fullstack |
| Fase 1 (MVP UI+puente) | 8 semanas | 1 fullstack |
| Fase 2 (lógica negocio) | 16 semanas | 1–2 fullstack |
| Fase 3 (informes + pulido) | 8 semanas | 1 fullstack |
| Fase 4 (fiscal nativo) | 12–18 meses | 1 especialista + asesor legal |
| **Total sin Fase 4** | **~35 semanas** (~9 meses) | |

> La Fase 4 es opcional en el sentido de que el sistema puede operar indefinidamente con VFP como motor fiscal via JurassicFox. Solo tiene sentido abordarla si se quiere eliminar VFP9 del servidor completamente.

---

## 9. Próximos pasos inmediatos

1. **Crear repositorio** `comercio365` con monorepo (pnpm workspaces)
2. **Scaffolding** Electron + React + TypeScript + Tailwind
3. **Implementar los componentes del Design System** (Button, Card, NumPad)
4. **Pantalla de login** conectada a `usuarios.dbf` via JurassicFox
5. **Decisión**: ¿PostgreSQL desde el inicio o SQLite primero?

---

*Documento generado con Claude Code (Sonnet 4.6) · Codebit Development*

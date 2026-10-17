# Strava

Notas verificadas de la API de Strava para el cliente de T5 (`packages/strava`). Consultadas el **17-oct-2026**
solo en documentación oficial pública. No se hizo ninguna llamada autenticada y no se usó ningún dato real.

Parte de la sección 4.8 del spec (verificada el 16-oct) y de 4.5. Convención de marcas:

- **VERIFICADO**: está en la documentación oficial, con su fuente de la sección 10.
- **NO VERIFICADO**: la documentación no lo dice o lo dice a medias. Va con la prueba que propone la sección 8.

Abreviaturas de fuentes: GS (Getting Started), AUTH (Authentication), RL (Rate Limits), REF (API Reference), SW
(swagger), CL (Changelog), WH (Webhooks), POL (API Policy), AGR (API Agreement). Las URLs están en la sección 10.

## 1. Resumen

- **Mecanismo.** OAuth 2.0 (código de autorización) y lectura con `GET /athlete/activities` usando un access token
  Bearer. Sin webhooks en la Fase 1 (el oráculo relee la semana al liquidar).
- **Madurez.** API v3 estable y pública. Pero 2026-2027 trae cambios con fecha que tocan nuestro cliente: un endpoint
  nuevo de revocación (disponible desde el 1-jun-2026) y una URL base nueva (desde el 4-ene-2027).
- **Riesgo.** Medio. Los puntos que pueden hacer daño al usuario:
  1. Un refresh token que perdiéramos se vería como una revocación y liquidaría la semana como `Forfeited` (`A-10`).
     Por eso la rotación se guarda de forma atómica.
  2. La documentación no fija el máximo de `per_page`, ni si cada página cuenta como una lectura, ni el cuerpo de los
     errores de token. Esto se mide con la cuenta del usuario (sección 8).
  3. Términos de uso: caché de 7 días, prohibición de IA y visibilidad (sección 9).
- **Lo que cambia respecto de 4.8** está marcado con **[CAMBIO vs 4.8]** en cada sección.

## 2. Requisitos de cuenta y app

| Tema | Hecho | Estado |
|---|---|---|
| Suscripción | "A Strava subscription is a prerequisite for creating an app" (GS). Es del dueño de la app | VERIFICADO |
| Crear la app | Panel de API de Strava; se fija el "Authorization Callback Domain". Sirve `localhost` o cualquier dominio (GS). `redirect_uri` debe caer dentro de ese dominio; `localhost` y `127.0.0.1` están permitidos (AUTH) | VERIFICADO |
| Capacidad | Toda app nueva nace en "single-player mode": solo la cuenta del dueño puede autenticarse (GS; RL). Capacidad 10 desde el panel. Más de 10 requiere revisión y, hasta que se apruebe, no se pueden autenticar más atletas (RL) | VERIFICADO |
| Ampliación | El 1-jun-2026 Strava lanzó "self service expanded access" en el panel para desarrolladores de un jugador y muestra el nivel de la app (CL) | VERIFICADO |
| Scope que pedimos | `activity:read_all`: actividades visibles para Todos y Seguidores, más zonas de privacidad y "Only You" (AUTH; SW). Con `activity:read` las "Only You" se filtran (REF) | VERIFICADO |
| Nombre | "Strava" no puede ir en el nombre de la app (POL 4.2, tomado de 4.8) | De 4.8, no vuelto a leer hoy |
| Costos | La documentación no menciona costo por usar la API. El costo es la suscripción del dueño | VERIFICADO (por ausencia) |
| Fase 3 | Si cada invitado necesita su propia suscripción: la documentación no lo dice | NO VERIFICADO (no bloquea la Fase 1) |

Scopes que existen (AUTH): `read`, `read_all`, `profile:read_all`, `profile:write`, `activity:read`,
`activity:read_all`, `activity:write`. **Solo se pide `activity:read_all`.** El usuario puede desmarcar cualquier scope
en la pantalla de permisos, por eso hay que validar el que vuelve.

## 3. Autenticación

### 3.1 Autorizar

`GET https://www.strava.com/oauth/authorize` (AUTH). La variante móvil es `/oauth/mobile/authorize`; no aplica.

| Parámetro | Obligatorio | Valor |
|---|---|---|
| `client_id` | sí | entero, el id de la app |
| `redirect_uri` | sí | dentro del dominio de callback de la app |
| `response_type` | sí | `code` |
| `scope` | sí | `activity:read_all` (se admiten varios separados por coma o por espacio URL-safe) |
| `approval_prompt` | no | `force` muestra siempre la pantalla de permisos; `auto` es el valor por defecto |
| `state` | no | se devuelve siempre en el redirect si se envió |

- `state` debe ser un valor aleatorio de un solo uso ligado a la sesión (anti-CSRF) y a la wallet que inicia el
  vínculo (4.4 del spec).
- `approval_prompt`: la documentación no dice qué hace `auto` si el usuario ya autorizó antes con un scope más
  estrecho. **NO VERIFICADO.** Propuesta: usar `force` al reconectar tras un rechazo de scope, para que el usuario
  vuelva a ver la casilla.

### 3.2 El redirect

- **Rechazo:** la query trae `error=access_denied`.
- **Aceptación:** la query trae `code` y `scope`; el `scope` refleja lo que el usuario **aceptó realmente** y la
  aplicación debe comprobarlo (AUTH).
- El `code` es de vida corta y de un solo uso (AUTH).
- **[NO VERIFICADO] Delimitador del `scope` en el redirect.** AUTH no da un ejemplo del redirect. El campo `scope` del
  token se describe como "lista separada por espacios" (CL, 23-abr-2026). El cliente debe aceptar coma o espacio al
  separar y exigir que el conjunto contenga `activity:read_all`. Se mide en la prueba 8.1.

### 3.3 Intercambio del código

`POST https://www.strava.com/oauth/token` (AUTH). Parámetros como form data: `client_id`, `client_secret`, `code`,
`grant_type=authorization_code`. El ejemplo de cURL de AUTH usa `https://www.strava.com/api/v3/oauth/token`; los dos
caminos están documentados.

Respuesta (AUTH), forma exacta del ejemplo:

```json
{
  "token_type": "Bearer",
  "expires_at": 1568775134,
  "expires_in": 21600,
  "refresh_token": "...",
  "access_token": "...",
  "athlete": { "...": "summary athlete representation" },
  "scope": "activity:read activity:write"
}
```

- `expires_at` es epoch en segundos. `expires_in` son los segundos que quedan.
- **`athlete`**: AUTH solo dice "summary athlete representation" y no lista campos. REF define `SummaryAthlete` con:
  `id`, `resource_state`, `firstname`, `lastname`, `profile_medium`, `profile`, `city`, `state`, `country`, `sex`
  (`M`/`F`), `premium` (deprecado), `summit`, `created_at`, `updated_at`. Swagger no marca ninguno como obligatorio.
  Solo usamos `id`. **NO VERIFICADO** que el `athlete` del intercambio traiga todos esos campos; por eso el cliente
  exige `id` y deja pasar el resto sin guardarlo. No guardamos nombre, ciudad ni foto: no hace falta y reduce lo que
  se retiene (POL 6.4).
- **[NO VERIFICADO] Que el intercambio devuelva siempre `scope`.** El ejemplo de AUTH lo trae y CL del 23-abr-2026 dice
  que la autenticación devuelve el campo. El cliente lo exige en el intercambio. Si falta, rechaza la conexión
  (decisión D2, sección 8).

### 3.4 Renovación y rotación

`POST https://www.strava.com/oauth/token` con `client_id`, `client_secret`, `grant_type=refresh_token` y
`refresh_token` (AUTH).

Respuesta (ejemplo de AUTH): `token_type`, `access_token`, `expires_at`, `expires_in`, `refresh_token`. **No** trae
`scope` ni `athlete`.

Reglas documentadas (AUTH):

- El access token dura 6 horas.
- Si al access token le quedan más de 3.600 s, la respuesta devuelve el mismo; si venció o le quedan 3.600 s o menos,
  emite uno nuevo. **Ambos, el viejo y el nuevo, sirven hasta que venzan.**
- **El refresh token rota.** Cada llamada exitosa devuelve un refresh token que puede coincidir o no con el enviado.
  Hay que guardar el más reciente: "once a new one is returned, the older one is invalidated immediately".
  Implicación para T5: **persistir siempre el refresh token de la respuesta, de forma atómica y antes de usar el
  access token**, aunque el valor parezca igual. Dos renovaciones concurrentes de la misma conexión pueden invalidarse
  entre sí: hace falta exclusión por conexión (un bloqueo o una fila bloqueada en la base).

### 3.5 Token revocado o inválido

- **VERIFICADO (AUTH):** las solicitudes con tokens invalidados reciben `401 Unauthorized`. AUTH no documenta cuerpo.
- **NO VERIFICADO:** el código y el cuerpo exactos cuando falla la **renovación** con un refresh token revocado,
  inválido o ya rotado (¿400 o 401?). REF define para los errores un `Fault`: `{ "message": string,
  "errors": [{ "code": string, "field": string, "resource": string }] }`. Es la forma documentada, pero no sabemos qué
  valores trae en cada caso. Se mide en la prueba 8.5, con tokens falsos.
- **Por qué importa:** `A-10` convierte "Strava rechaza el refresh token como inválido o revocado" en `Forfeited`.
  Una clasificación demasiado amplia le cuesta dinero al usuario por un error nuestro. Regla propuesta:
  - es revocación solo una respuesta 4xx del endpoint de token con `grant_type=refresh_token` cuyo cuerpo se haya
    medido como "token inválido/revocado";
  - 429, 5xx, errores de red y cuerpos que no cumplan el `Fault` esperado son errores pasajeros: se salta la
    posición (4.6);
  - el liquidador registra el motivo.

### 3.6 Deautorización

**[CAMBIO vs 4.8]** 4.8 decía que `oauth/deauthorize` se retira el 1-jun-2027 y lo atribuía al changelog. Lo que dice
la documentación hoy:

| Endpoint | Hecho | Fuente |
|---|---|---|
| `POST https://www.strava.com/oauth/deauthorize` | Parámetro `access_token` (documentado como parámetro de query). Revoca refresh y access token del atleta y quita la app de sus aplicaciones | AUTH |
| `POST https://www.strava.com/oauth/revoke` | Disponible desde el **1-jun-2026**. AUTH dice que pasa a ser el **único** endpoint de deautorización soportado el **1-jun-2027**. Autenticación HTTP Basic (`client_id:client_secret` en Base64). Parámetros: `token` (obligatorio, access o refresh) y `token_type_hint` (`access_token` o `refresh_token`). Éxito: `200` con cuerpo vacío, incluso si el token no existía. Revocar un tipo revoca también el otro | AUTH, CL (1-jun-2026) |
| Errores de `/oauth/revoke` | `400` falta `token`; `401` cabecera de autorización inválida o ausente; `503` error interno, se puede reintentar | AUTH |

El changelog **solo** registra la introducción del endpoint nuevo el 1-jun-2026. La fecha de retiro del 1-jun-2027
sale de AUTH, no de CL. El cliente de T5 debe usar `/oauth/revoke` (el viejo mandaría el token por query, y la regla es
no hacerlo).

## 4. Operaciones

El cliente de T5 usa cuatro: autorizar (3.1), intercambiar código (3.3), renovar (3.4), revocar (3.6) y **una** de datos.

### `GET /athlete/activities` (REF; SW)

- Base: `https://www.strava.com/api/v3`. Cabecera `Authorization: Bearer <access_token>`.
- Descripción oficial: "Returns the activities of an athlete for a specific identifier. Requires activity:read.
  Only Me activities will be filtered out unless requested by a token with activity:read_all."

| Parámetro (query) | Tipo | Defecto | Notas |
|---|---|---|---|
| `before` | entero, epoch | sin valor | "actividades que ocurrieron antes de un momento". Segundos o milisegundos y si el borde es inclusivo: **NO VERIFICADO** |
| `after` | entero, epoch | sin valor | "actividades que ocurrieron después de un momento". Mismo vacío |
| `page` | entero | 1 | |
| `per_page` | entero | 30 | **No hay máximo documentado** ni en REF ni en el swagger |

- Todos los parámetros son opcionales. Respuesta `200`: arreglo de `SummaryActivity`. `4xx`/`5xx`: un `Fault`.
- **Orden de los resultados: NO VERIFICADO** (la documentación no lo fija). El cliente no debe depender del orden.
- **Paginación.** Propuesta de diseño: pedir `page=1,2,…` hasta recibir una **página vacía**, no hasta recibir una
  "incompleta". Mientras el máximo de `per_page` no esté medido, una página corta puede ser un tope del servidor y no
  el final. Cuesta una lectura extra por posición. Si la prueba 8.3 mide el máximo, se puede volver a "página
  incompleta" con `per_page` ≤ máximo.
- **Ventana.** El spec mide `[week_start, week_end)` sobre `start_date` en UTC. Como el borde de `after`/`before` no
  está documentado, el cliente debe pedir un margen (`after = week_start - 1 s`, `before = week_end + 1 s`) y **aplicar
  la ventana exacta localmente** sobre `start_date`. Así el resultado no depende de si el borde es inclusivo.
- No usamos `GET /activities/{id}` (el detalle): `device_name` ya viene en el listado desde el 27-oct-2025 (CL).

## 5. Datos y formatos

`SummaryActivity` según SW (`activity.json`) y REF. **El swagger no tiene lista `required`**: ningún campo está
garantizado. La tabla marca lo que usan los filtros de 4.5.

| Campo | Tipo documentado | Uso en AgentHabit |
|---|---|---|
| `id` | entero int64 | Id para el registro de actividades usadas y su purga. Un `number` de JS pierde precisión sobre 2^53: validar entero seguro. **NO VERIFICADO** el rango real de los ids |
| `sport_type` | enumeración `SportType` | Filtro: `Run` o `TrailRun` (`A-9`) |
| `type` | `ActivityType`, **deprecado** (desde el 15-jun-2022 según CL) | No se usa como filtro. Posible respaldo |
| `distance` | float, **metros** | Se trunca a metro entero antes de sumar |
| `moving_time` | entero, **segundos** | Mayor que 0 y base del ritmo (2:30 min/km o más lento) |
| `start_date` | string `date-time`, UTC | Ventana de la semana |
| `start_date_local`, `timezone`, `utc_offset` | string | No se usan (4.5). `utc_offset` no aparece en REF |
| `trainer` | boolean | Debe ser distinto de `true` |
| `manual` | boolean | Debe ser `false` |
| `device_name` | string, "dispositivo que registró la actividad" (desde 27-oct-2025) | `device_name` o `upload_id` |
| `upload_id` | entero int64 ("la subida que originó la actividad") | `device_name` o `upload_id` |
| `upload_id_str` | string | No se usa |
| `elapsed_time` | entero, segundos | No se usa |
| `private`, `visibility`, `flagged`, `commute` | boolean | No se usan. No excluimos `commute` (4.5 no lo pide) |

Valores de `SportType` relevantes (REF, lista completa en la fuente): `Run`, `TrailRun`, `VirtualRun`, `Walk`, `Hike`,
`Ride`, `GravelRide`, `Workout`. `VirtualRun` es distinto de `Run` y no cuenta. Desde el 30-abr-2026 se sumaron
Basketball, Cricket, Dance, Padel, PhysicalTherapy y Volleyball (CL): una lista cerrada de valores en zod se rompería con
cada alta. **El cliente no debe usar `z.enum` sobre `sport_type`: leerlo como string y comparar con `Run`/`TrailRun`.**

### Formas que el cliente debe validar con zod

Descripción de las formas, no código de la aplicación. `?` = opcional según la documentación.

**Respuesta del intercambio del código** (3.3):

| Campo | Forma |
|---|---|
| `token_type` | string `"Bearer"` |
| `access_token` | string no vacío |
| `refresh_token` | string no vacío |
| `expires_at` | entero (epoch, s) |
| `expires_in` | entero (s) |
| `scope` | string; separar por coma o espacio y exigir que contenga `activity:read_all` |
| `athlete` | objeto con `id` entero; el resto, opcional y descartado |

**Respuesta de la renovación** (3.4): `token_type`, `access_token`, `refresh_token` (strings), `expires_at`,
`expires_in` (enteros). Sin `scope` ni `athlete`.

**Parámetros del redirect** (3.2): `code` y `scope` (strings) y `state`, o `error` con valor `access_denied`.

**`Fault`** (errores `4xx`/`5xx`): `message` string opcional; `errors` arreglo opcional de objetos con `code`, `field`,
`resource` (strings). Debe tolerar un cuerpo que no sea JSON o que no cumpla la forma: eso es un error pasajero y no
una revocación.

**Elemento del listado** (`SummaryActivity`), campos que lee el cliente:

| Campo | Forma |
|---|---|
| `id` | entero |
| `sport_type` | string |
| `distance` | número, finito y no negativo |
| `moving_time` | entero no negativo |
| `start_date` | string de fecha-hora ISO 8601 en UTC |
| `trainer` | boolean |
| `manual` | boolean |
| `device_name` | string, o ausente / nulo |
| `upload_id` | entero, o ausente / nulo |

Los demás campos pasan sin validarse y no se guardan. **Ausencia de campos:** como ninguno está garantizado, hay
que decidir qué pasa si falta uno que el filtro necesita (`sport_type`, `distance`, `moving_time`, `start_date`,
`trainer`, `manual`). Recomendación: una actividad así hace **fallar la lectura** (la posición salta y termina en
`release_if_stale` sin costo para el usuario, 4.6) en vez de excluirse en silencio (decisión D3, sección 8). `device_name` y
`upload_id` sí pueden faltar: la regla es "al menos uno presente", y si faltan los dos la actividad no cuenta.
**NO VERIFICADO** si el servidor manda `null` o una cadena vacía; el esquema debe tratar `null`, ausente y `""`
como "no hay".

**NO VERIFICADO:** el sufijo exacto de `start_date` (`Z` u offset). El esquema debe aceptar una fecha-hora ISO 8601
con zona y convertirla a epoch UTC; comprobarlo con la prueba 8.6. `timezone` no se usa: no importa su formato.

## 6. Límites

**VERIFICADO (RL; GS):**

| Capacidad | Lecturas (todo salvo crear actividades y subidas) | Total |
|---|---|---|
| 1 (un jugador, el defecto) | **100 por 15 min y 1.000 por día** | 200 por 15 min y 2.000 por día |
| 10 | 200 por 15 min y 2.000 por día | 400 por 15 min y 4.000 por día |
| Más de 10 | sin números publicados; requiere revisión | |

- La ventana de 15 min se reinicia en los minutos 0, 15, 30 y 45 de cada hora. La diaria, a medianoche UTC. Las
  solicitudes que pasan el límite corto igual cuentan para el diario.
- GS cita solo "200 cada 15 min, 2.000 al día" como límite por defecto: es el total. Para un cliente que solo lee,
  manda el límite de lectura de RL.

**Cabeceras (RL):**

| Cabecera | Formato | Ejemplo en RL |
|---|---|---|
| `X-RateLimit-Limit` | dos enteros separados por coma: **límite de 15 min, luego diario** | `600,30000` |
| `X-RateLimit-Usage` | dos enteros por coma: **uso de 15 min, luego diario** | `314,27536` |
| `X-ReadRateLimit-Limit` | igual que `X-RateLimit-Limit`, para lecturas | sin ejemplo |
| `X-ReadRateLimit-Usage` | igual que `X-RateLimit-Usage`, para lecturas | sin ejemplo |

- Los ejemplos de RL escriben las cabeceras como `X-Ratelimit-*` y sus números (`600,30000`) no coinciden con los
  límites de la tabla. El cliente debe leer las cabeceras **sin distinguir mayúsculas** y no dar por buenos los
  números del ejemplo.
- **Respuesta 429:** estado `429 Too Many Requests`, cuerpo JSON, `Content-Type: application/json; charset=utf-8`
  (RL). El contenido del cuerpo no está documentado. `Retry-After`: no está documentado. **NO VERIFICADO.**
- **Si cada página de un listado cuenta como una lectura:** RL no lo dice. Lo normal es que cuente cada solicitud HTTP,
  pero **NO VERIFICADO** (prueba 8.2).
- **Presupuesto estimado** (a confirmar con 8.2): una posición lee 1 página (hasta 30 actividades a `per_page=30`) más
  una vacía de cierre, unas 2 lecturas. Con 100 lecturas por 15 min hay mucho margen en la Fase 1. El límite que
  importa es el de lecturas (100/15 min), no el total. Regla propuesta: antes de cada solicitud, si el uso de 15 min
  llegó al límite, esperar al próximo múltiplo de 15 min o abandonar la posición (se reintenta en la corrida diaria).

## 7. Errores comunes

| Código | Cuándo | ¿Reintentable? | Estado |
|---|---|---|---|
| `401` | Token de acceso inválido, vencido o revocado. AUTH: las solicitudes con tokens invalidados reciben `401 Unauthorized`. Sin cuerpo documentado | Una vez, tras renovar si el access token venció. Si la renovación falla por token inválido: es revocación (3.5), no se reintenta | Código VERIFICADO; cuerpo NO VERIFICADO |
| `400` en el endpoint de token | Parámetro faltante o `code`/`refresh_token` inválidos | No | NO VERIFICADO; REF solo documenta `Fault` |
| `403` | Permisos insuficientes | No | NO VERIFICADO (REF solo dice `4xx`) |
| `404` | Recurso que no existe | No | NO VERIFICADO |
| `429` | Límite superado | Sí, tras el próximo múltiplo de 15 min (o medianoche UTC si fue el diario). No dentro de la misma corrida si queda otro intento | VERIFICADO el código; sin `Retry-After` |
| `5xx` | Error de Strava. `/oauth/revoke` documenta `503` como reintentable | Sí, con espera creciente y tope | VERIFICADO solo para `/oauth/revoke` |
| `error=access_denied` en el redirect | El usuario rechazó | No es error del sistema | VERIFICADO |
| Scope aceptado sin `activity:read_all` | El usuario desmarcó la casilla | No: se rechaza la conexión y se le explica | VERIFICADO el mecanismo |

Los demás `4xx` y `5xx` traen un `Fault` según REF. Un `401` sobre el listado puede significar token vencido, revocado
o con scope insuficiente, y **la documentación no los distingue**. Hasta medirlo (8.5), la regla es: `401` en el
listado, renovar una vez y reintentar; si la renovación falla con rechazo del token, revocación; si la renovación
funciona y el listado sigue en `401`, error de scope: no cuenta como revocación y la lectura queda incompleta.

## 8. Cómo probar sin riesgo

**Modo un jugador (verificado):** la app nace con capacidad 1 y solo la cuenta del dueño puede autenticarse. Es el
único entorno de la Fase 1. No hay un modo de pruebas de Strava (sandbox): no está documentado.

**Reglas de esta prueba (restricción 5 de `CLAUDE.md`, POL 5.3):**
- La corre el usuario con su cuenta. Ningún dato real de Strava (actividades, ids, tokens, nombres, fechas) se pega en
  un prompt, en git ni en `docs/`.
- Las respuestas se guardan en un archivo local fuera del repo (por ejemplo `~/strava-probe/`, con permisos `600`).
  El usuario nos trae **solo conclusiones sobre cómo se comporta la API**: números de límites, nombres y formatos de
  cabeceras, códigos HTTP, si un campo viene presente/vacío/nulo. POL 5.3 cubre datos derivados o agregados, por lo
  que no se traen conteos, distancias ni fechas de sus actividades (decisión D4, al final de esta sección).
- El token va en un archivo de cabeceras (`curl --header @archivo`), no en la línea de comandos, para que no quede en
  el historial del shell ni en `ps`.

**Pruebas (todas lecturas de su propia cuenta, salvo la 8.7):**

| # | Qué resuelve | Procedimiento | Qué se anota |
|---|---|---|---|
| 8.1 | OAuth, `scope` y formato del redirect | Autorizar dos veces con la app en modo un jugador: una pidiendo `activity:read_all` y aceptando; otra desmarcando la casilla | El formato del `scope` en la URL de redirect (separador) y en la respuesta del token; si `approval_prompt=auto` muestra la pantalla otra vez; si el intercambio trae `scope` y qué campos trae `athlete` (solo nombres de campos) |
| 8.2 | ¿Cada página cuenta como una lectura? | Con la app sin otro tráfico, hacer 3 solicitudes seguidas a `GET /athlete/activities?per_page=1&page=1,2,3` y leer `X-ReadRateLimit-Usage` tras cada una (`-D` guarda las cabeceras) | Cuánto sube el primer número en cada solicitud. Confirma además el formato "15 min, diario" |
| 8.3 | Máximo real de `per_page` | Pedir `per_page=100`, `200`, `201`, `500` y mirar cuántos elementos vuelven (`jq length`). **Solo sirve si la cuenta tiene más actividades que el valor probado**; si no, solo se conoce un mínimo | El máximo observado, o "no determinable, hay menos de N" |
| 8.4 | `device_name` y `upload_id` | Mirar si vienen presentes, `null`, ausentes o `""` en una carrera con reloj (Garmin) y en una de la app móvil de Strava. Con `jq`, imprimir solo el tipo de cada campo (`type`) y no su valor | Solo los tipos (`string`, `null`, `number`) por tipo de origen, sin valores |
| 8.5 | Cuerpos de error de token | (a) `GET /athlete/activities` con un access token falso; (b) `POST /oauth/token` con `grant_type=refresh_token` y un refresh token falso; (c) igual con un access token real sin el scope pedido, si se puede. No usa datos de actividades | Código HTTP y la forma del cuerpo (`message`, `errors[].code/field/resource`). Esto fija la regla de revocación de 3.5 |
| 8.6 | Bordes de `after`/`before`, unidad, orden y `start_date` | Con una actividad que el usuario sabe cuándo empezó: probar `after` igual a su `start_date` en epoch menos 1, igual y más 1; lo mismo con `before`. Mirar el orden de los resultados y el sufijo de `start_date` | Si los bordes son inclusivos o exclusivos, si el orden es del más reciente al más antiguo, si `start_date` termina en `Z` |
| 8.7 | Carrera manual | Opcional: crear una carrera manual de prueba desde la web de Strava (no necesita `activity:write` de la app) y mirar `manual`, `device_name`, `upload_id`. Después borrarla | Tipos de esos campos. Es un cambio en la cuenta real: lo decide el usuario |
| 8.8 | Revocación real | Al final: llamar a `POST /oauth/revoke` con el access token y luego usar el access token y el refresh token ya revocados | Código y forma del cuerpo de cada uno. Desconecta la app: habrá que volver a autorizar |

Después de 8.1 a 8.8, `docs/integraciones/strava.md` se actualiza con los valores medidos, sin datos de la cuenta,
y las marcas **NO VERIFICADO** pasan a **VERIFICADO (prueba del usuario, fecha)**.

### Lo que sigue SIN verificar (lo prueba el usuario con su cuenta)

| Pendiente | Prueba |
|---|---|
| Máximo real de `per_page` | 8.3 |
| Si cada página cuenta como una lectura en `X-ReadRateLimit-Usage` | 8.2 |
| Si `device_name` y `upload_id` vienen vacíos, nulos o ausentes en carreras con reloj Garmin | 8.4 |
| Si una carrera manual trae alguno de los dos | 8.7 |
| Delimitador del `scope` en el redirect y si el intercambio siempre trae `scope`; comportamiento de `approval_prompt=auto` | 8.1 |
| Campos que trae el `athlete` del intercambio | 8.1 |
| Código y cuerpo de los errores de token: renovación con token revocado, inválido o rotado; `401` por scope insuficiente | 8.5, 8.8 |
| Cuerpo del `429` y si trae `Retry-After` | solo se ve si se llega al límite; no se provoca a propósito (queda con las cabeceras de 8.2) |
| Unidad y bordes de `after`/`before`, orden del listado, sufijo de `start_date` | 8.6 |
| Si `device_name`/`upload_id` pueden ser `null` o `""` en general | 8.4 |
| Dónde se mueven los endpoints OAuth con la URL base nueva (4-ene-2027) | No hay prueba posible hoy; revisar el changelog tras esa fecha |
| "Token solo en cabecera desde 1-jun-2027" | Sin respaldo oficial; no cambia el diseño |
| POL 5.16(c): ¿compartir la base de tokens entre la API y el liquidador cuenta como reutilizar entre servidores? Ambiguo, riesgo bajo (sección 9) | El usuario lee 5.16 completo antes de T6 y se incluye la pregunta en el correo a developers@strava.com |
| Suscripción de los invitados en la Fase 3 | Consulta a developers@strava.com |

### Decisiones pendientes del usuario

- **D2.** Si el intercambio de token no trae `scope`: rechazar la conexión (propuesto) o aceptarla y confiar en el
  `scope` del redirect.
- **D3.** Si a una actividad le falta un campo que usan los filtros: la lectura falla y la posición va a
  `release_if_stale` (propuesto), o la actividad se excluye en silencio.
- **D4.** Qué puede traer el usuario a este chat desde las pruebas: solo conclusiones sobre el comportamiento de la API
  (propuesto), sin conteos, distancias ni fechas de sus actividades.
- **D5.** Cómo cumplir POL 6.3 (48 h) sin webhooks para ids retenidos hasta 7 días. Propuesta: la web nunca muestra
  actividades guardadas sin releerlas, y la liquidación siempre relee la semana, por lo que un id borrado no cuenta.

**Fixtures sintéticos para los tests de T5.** Actividades inventadas con ids y fechas falsas, que cubran: ventana
semiabierta en los dos bordes, `Run`, `TrailRun`, `VirtualRun`, `trainer=true`, `manual=true`, sin `device_name` ni
`upload_id`, solo uno de los dos, distancia 0, `moving_time` 0, ritmo más rápido que 2:30, campos faltantes,
`device_name` nulo y vacío, y sport types desconocidos. Para el servidor simulado: respuestas del token con y sin
`scope` y con scope insuficiente, rotación del refresh token, `401`, `429` con las cabeceras de límites y `5xx`. Ver
la nota de "**NO VERIFICADO**" de 3.5: hasta medirlo (8.5), los tests de cuerpos de error describen la forma `Fault`
documentada, no una respuesta real.

## 9. Riesgos y términos de uso relevantes

Política vigente desde el 1-jun-2026 (POL).

| Tema | Regla | Qué implica |
|---|---|---|
| Caché | **6.2:** "You may not retain Strava Data in your cache for longer than seven (7) days" | Purga a los 7 días o al liquidar (4.5). Aplica también a lo que lea la web durante la semana (T7) |
| Retención | **6.4:** guardar solo el tiempo necesario para el propósito | No guardamos nombre, ciudad ni foto del atleta (3.3) |
| Borrados | **6.3:** lo que el usuario borró en Strava debe reflejarse "expeditiously but in all cases within 48 hours" | Sin webhooks, un id guardado hasta 7 días puede apuntar a una actividad ya borrada. La web no debe mostrar actividades guardadas sin releerlas. Cómo cumplir las 48 h para ids retenidos: decisión D5 (sección 8) |
| IA | **5.3:** prohíbe usar Strava Data o la API "directly or indirectly" en el desarrollo, entrenamiento, evaluación u operación de cualquier aplicación de IA, y extiende la prohibición a datos derivados, agregados, anonimizados o de salida de modelo, y a embeddings, RAG y la ventana de contexto | Ningún dato real, ni derivado ni agregado, pasa por un prompt. Aplica a este agente y a Claude Code. Por eso 8 pide conclusiones sobre la API y no datos de la cuenta |
| Visibilidad | **2.3:** los datos de un usuario se muestran solo a ese usuario | Ningún dato de un usuario es visible para otro (regla 5 de `CLAUDE.md`) |
| Revocación | **7.4:** si el atleta revoca, sus datos se borran en un máximo de 30 días | Borrar tokens y datos de Strava de ese usuario al detectar la revocación |
| Reventa | **5.8:** no se puede vender ni redistribuir el acceso a la API | AgentHabit no cobra por el acceso |
| Tokens entre servicios | **5.16(c)**, dentro de la sección 5.16 "No Abstraction Layers, Pass-Through Proxies, or Unauthorized Agent Interfaces". Prohíbe "share, transfer, multiplex, or otherwise re-use API Tokens or authentication credentials" entre varios servidores, servicios, aplicaciones o usuarios finales. Las otras tres letras prohíben: (a) una capa intermedia que re-expone la API a terceros, (b) operar un servidor MCP o interfaz mediada por agentes, (d) una app cuyo fin principal sea dar acceso a terceros con nuestras credenciales | **AMBIGUO, riesgo bajo, no bloquea.** Ver el análisis debajo de la tabla |
| Seguridad | **8.1:** medidas "commercially reasonable" para proteger los datos, con responsabilidad total del desarrollador. **8.3:** avisar por escrito a legal@strava.com **dentro de 24 h** de descubrir una brecha de seguridad. **8.4:** Strava puede exigir controles (por ejemplo 2FA para usuarios). No hay regla específica de cifrado de tokens | Cifrar los tokens con `TOKEN_ENCRYPTION_KEY` ya está en el diseño. Definir quién avisa a Strava y cómo, antes de conectar a un tercero |
| Credenciales de usuario | **7.1:** respetar la configuración de privacidad; la app no puede usar datos de un usuario si no tiene sus credenciales de autenticación | Coherente con pedir `activity:read_all` y respetar el rechazo del scope |
| Carreras virtuales | developers.strava.com: Strava puede revocar el token por usos "that enable virtual races or competitions" | AgentHabit no es una competencia. Consultar a developers@strava.com antes del piloto con terceros de la Fase 3. No bloquea la Fase 1 |
| Marca | "Strava" no puede ir en el nombre de la app (POL 4.2, de 4.8); BRAND si se muestra el botón | T7 |

**Análisis de 5.16(c) para nuestro diseño** (una app y un `client_id`, la API en un Web Service de Render con los
tokens cifrados en Neon, y el liquidador, un Cron Job de Render del mismo código, que los lee de esa misma base):

- **(a), (b) y (d) no aplican.** No exponemos la API de Strava a terceros, no operamos un MCP ni una interfaz de
  agente, y el único que accede es el dueño de la app a su propia cuenta (modo un jugador).
- **(c) es el único punto en duda.** Lo que dice el texto hoy es "compartir, transferir, multiplexar o reutilizar
  tokens o credenciales entre varios servidores, servicios, aplicaciones o usuarios finales". Leída al pie de la
  letra, "servidores" podría incluir dos procesos de Render. Pero el contexto de la sección (capas intermedias, proxies
  y agentes que dan acceso a otros) apunta a **repartir credenciales de Strava hacia terceros o entre usuarios**, no a
  los procesos de un mismo desarrollador que usan la misma app, el mismo `client_id` y la misma base. Además, nada se
  transfiere a otra parte: los tokens no salen de nuestra infraestructura.
- **Veredicto: ambiguo, no bloquea la Fase 1.** En la Fase 1 hay un solo atleta (el dueño), por lo que el riesgo
  práctico es muy bajo. La documentación no define "server", y la definición de los términos con mayúscula está en el
  API Agreement (AGR), que hoy no volví a leer.
- **Limitación de esta lectura.** La herramienta de consulta no devolvió 5.16 palabra por palabra (limita lo que cita),
  así que el análisis se apoya en una paráfrasis de las cuatro letras y su encabezado. Una consulta atribuyó al texto
  literal la cola "across multiple servers" y otra la dio como paráfrasis: no quedó resuelto, y es justo la frase que
  decide el caso. Conviene que el usuario lea
  5.16 directamente antes de T6.
- **Mitigaciones, de menos a más costosa:**
  1. Incluir esta pregunta en el correo a developers@strava.com que ya está previsto antes de la Fase 3. Es la única
     forma de cerrarlo.
  2. Un solo escritor de tokens: la renovación (que rota el refresh token) la hace un único proceso, con exclusión por
     conexión. Esto es necesario también por la rotación (3.4); dos procesos renovando a la vez pueden invalidarse.
  3. Si Strava dijera que dos procesos no pueden compartir tokens: el liquidador no abre los tokens y le pide la lectura
     de la semana a la API por un endpoint interno autenticado, de modo que solo el Web Service habla con Strava.
     Es un cambio de diseño de T5/T6 y no se hace sin el OK del usuario.

**[CAMBIO vs 4.8] "Token solo en cabecera desde el 1-jun-2027" no está en el changelog oficial.** 4.8 lo atribuía a CL.
Se buscó "header", "query parameter", "access_token" y "2027" en el changelog: la única mención de 2027 es la URL base
nueva, y la de "query parameter" es de 2023 y habla de webhooks. La afirmación aparece solo en un blog de terceros
(Terra, 6-sep-2026), que no cita una fuente oficial para esa parte. Las páginas oficiales (GS, REF) muestran el token
en cabecera. **Tratar como NO VERIFICADO oficialmente.** No cambia el diseño: el cliente ya manda el token solo en
`Authorization: Bearer`.

Otros cambios con fecha (CL):

- **URL base nueva** `https://api-v3.strava.com`, disponible desde el **4-ene-2027** (anunciada el 1-jun-2026).
  Desde esa fecha reemplaza a `https://www.strava.com/api/v3`. Cuándo se apaga la vieja: no está documentado.
  **NO VERIFICADO** si los endpoints OAuth (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`) se mueven al dominio
  nuevo. El cliente tiene tres valores de configuración separados: base de la API, host de autorización y host de
  tokens.
- 23-abr-2026: la autenticación devuelve `scope`. 27-oct-2025: `device_name` en el resumen.
- 1-sep-2026: se retiran los endpoints de actividades, miembros y administradores de clubes, y "Explore Segments" pasa
  a Extended Access. No los usamos.
- Hoy es 17-oct-2026: la URL base nueva todavía no existe. Antes del 4-ene-2027 el cliente sigue con
  `https://www.strava.com/api/v3`.

## 10. Fuentes

Todas consultadas el **17-oct-2026**, salvo donde se indica.

| Sigla | URL | Para qué |
|---|---|---|
| GS | https://developers.strava.com/docs/getting-started/ | Suscripción, modo un jugador, callback domain, token en cabecera |
| AUTH | https://developers.strava.com/docs/authentication/ | Authorize, redirect, token, refresh y rotación, deautorización y `/oauth/revoke` |
| RL | https://developers.strava.com/docs/rate-limits/ | Límites por capacidad, cabeceras, 429, ventanas |
| REF | https://developers.strava.com/docs/reference/ | `GET /athlete/activities`, `SummaryActivity`, `SportType`, `Fault`, `SummaryAthlete` |
| SW | https://developers.strava.com/swagger/swagger.json | Parámetros del listado, `securityDefinitions`, host y `basePath` |
| SW-A | https://developers.strava.com/swagger/activity.json | `SummaryActivity` sin lista `required` |
| CL | https://developers.strava.com/docs/changelog/ | Cambios con fecha (27-oct-2025, 23-abr-2026, 30-abr-2026, 1-jun-2026, 1-sep-2026) |
| WH | https://developers.strava.com/docs/webhooks/ | Eventos y requisitos del callback (no se usan en la Fase 1) |
| POL | https://www.strava.com/legal/api_policy | Secciones 2.3, 3.3, 5.3, 5.8, 6.2, 6.3, 6.4, 7.4; vigente desde el 1-jun-2026 |
| Portal | https://developers.strava.com/ | Aviso de carreras virtuales y competencias |

Solo como pista, no como fuente final:
- Terra, "Strava API Changes in 2026" (https://tryterra.co/blog/strava-api-changes-2026, publicado el 6-sep-2026,
  consultado el 17-oct-2026): origen de la afirmación "token solo en cabecera", sin respaldo oficial (sección 9).

Consulta adicional del 17-oct-2026 sobre POL 5.16, 7.1, 8.1, 8.3 y 8.4 (misma URL de POL), para D6.

No se volvieron a leer hoy: [API Agreement](https://www.strava.com/legal/api) (AGR) y
[Brand Guidelines](https://developers.strava.com/guidelines/) (BRAND). Siguen como los dejó la sección 4.8 (16-oct).

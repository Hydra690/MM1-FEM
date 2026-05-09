# MM1 FEM Libre — Documentación Técnica Interna
**Versión 3.5 — Abril 2026**

---

## 1. Visión General

Aplicación web educativa de cálculo estructural por elementos finitos (FEM) para la cátedra de Mecánica de Materiales 1 (MM1). Implementada en HTML5 + JavaScript vanilla sin frameworks. Dos módulos conmutables: **Torsión** y **Flexión Simple**.

**Stack:**
- HTML5 + CSS3 (sin frameworks UI)
- JavaScript vanilla (sin React/Vue/jQuery)
- Chart.js 4.4.1 para gráficas interactivas
- chartjs-plugin-annotation 3.0.1 para anotaciones en gráficas
- Google Fonts: DM Mono, DM Sans

**Archivos:**
```
index.html          (~580 líneas) — Layout principal, ambos módulos
css/style.css       (~1420 líneas) — Estilos globales + drawer manual
js/main.js          (~74 líneas)  — Inicialización y conmutación de módulos
js/shared.js        (~500 líneas) — Utilidades compartidas entre módulos
js/flexion.js       (~4150 líneas) — Módulo de Flexión (FEM Euler-Bernoulli)
js/torsion.js       (~1900 líneas) — Módulo de Torsión (FEM 1D)
```

---

## 2. Arquitectura General

```
index.html
├── #moduleTorsion     (div, visible por defecto)
└── #moduleFlexion     (div, oculto al inicio)

main.js
└── Conmutación entre módulos (switchModule)

shared.js
├── parseSci(str)       — Parser de notación científica
├── sciField(...)       — Genera inputs con notación científica
├── evalExpr(expr,x,L)  — Evaluador de expresiones q(x)
├── luSolve(A, b)       — Resolución sistema lineal LU con pivoteo parcial
└── fmtSciPreview(v)    — Formateador de valores para display
```

Cada módulo (torsion.js, flexion.js) es **autocontenido**: gestiona su propio estado, DOM y solver. No comparten variables entre sí excepto las utilidades de shared.js.

---

## 3. Módulo de Flexión — Arquitectura Interna

### 3.1 Estado Global

```javascript
// Modelo geométrico
let fSegs    = []   // Segmentos de viga
let fLoads   = []   // Cargas aplicadas
let fSupports = []  // Apoyos (condiciones de borde)

// Undo/Redo
let fUndoStack = [], fRedoStack = []
const F_MAX_UNDO = 60

// Contadores de ID
let fSid = 0, fLid = 0, fSpId = 0

// Resultados del último solve
let fLastSolveData = null

// Gráficas Chart.js activas
let fCharts = {}

// Rasante
let fRasYcut = null, fRasSpacing = 0.20
```

### 3.2 Estructura de Datos

**Segmento (`fSegs[i]`):**
```javascript
{
  id: Number,
  xa: Number,        // posición inicio (m, SI)
  xb: Number,        // posición fin (m, SI)
  secType: String,   // 'rect' | 'circ' | 'Isym' | 'Tsec' | 'Tinv' | 'composite'
  E: Number,         // Módulo de elasticidad (Pa, SI)

  // Sección rectangular:
  b: Number,         // ancho (m)
  h: Number,         // altura (m)

  // Sección circular:
  d: Number,         // diámetro (m)

  // Sección I simétrica:
  bf: Number,        // ancho ala (m)
  tf: Number,        // espesor ala (m)
  hw: Number,        // altura alma (m)
  tw: Number,        // espesor alma (m)

  // Sección T (Tsec = T normal, Tinv = T invertida):
  bf: Number, tf: Number, hw: Number, tw: Number,

  // Sección compuesta:
  composite: Boolean,
  layers: [{
    id: Number,
    type: 'rect' | 'circ',
    b: Number, h: Number,  // rect
    d: Number,              // circ
    E: Number,              // módulo propio de la capa (Pa)
    yOffset: Number,        // desplazamiento vertical desde base (m)
  }]
}
```

**Carga (`fLoads[i]`):**
```javascript
{
  id: Number,
  tipo: 'pun' | 'mom' | 'dis' | 'tri' | 'pol' | 'temp' | 'axial',

  // Puntual y Momento:
  x: Number,         // posición (m, SI)
  val: Number,       // valor (N para pun, N·m para mom, N para axial)

  // Distribuida uniforme:
  xa: Number, xb: Number,
  val: Number,       // intensidad (N/m, SI)

  // Triangular:
  xa: Number, xb: Number,
  va: Number,        // intensidad en xa (N/m, SI)
  vb: Number,        // intensidad en xb (N/m, SI)

  // Polinomial:
  xa: Number, xb: Number,
  expr: String,      // expresión q(x) en unidades de usuario

  // Gradiente térmico:
  xa: Number, xb: Number,
  T_sup: Number,     // temperatura fibra superior (°C)
  T_inf: Number,     // temperatura fibra inferior (°C)
  alpha: Number,     // coef. dilatación (1/°C)
}
```

**Apoyo (`fSupports[i]`):**
```javascript
{
  id: Number,
  x: Number,           // posición (m, SI)
  restrictV: Boolean,  // restringe desplazamiento vertical v=0
  restrictU: Boolean,  // restringe desplazamiento horizontal u=0
  restrictTheta: Boolean, // restringe giro θ=0
  kV: Number | null,   // rigidez resorte vertical (N/m) — null = rígido
  kTheta: Number | null, // rigidez resorte rotacional (N·m/rad) — null = rígido
  deltaV: Number,      // asentamiento prescrito vertical (m)
  deltaTheta: Number,  // giro prescrito (rad)
}
```

### 3.3 Sistema de Unidades

El módulo maneja conversión bidireccional entre unidades de usuario y SI. Cada grupo tiene sus propias funciones:

| Grupo | Variables | Funciones clave |
|-------|-----------|-----------------|
| Dimensiones sección | `fUnitLen`, `fUnitE` | `fLenToSI`, `fEToSI` |
| Posiciones viga | `fUnitSpan` | `fSpanToSI`, `fSpanFromSI` |
| Fuerzas/cargas | `fUnitForce` | `fForceToSI`, `fForceFromSI` |
| Resultados flecha | `fUnitDefl` | `fDeflFromSI` |
| Resultados tensión | `fUnitStress` | `fStressFromSI` |
| Asentamiento | `fUnitDeltaV` | `fDeltaVToSI` |
| Giro prescrito | `fUnitDeltaR` | `fDeltaRToSI` |

**Regla invariante:** Todo el estado interno (`fSegs`, `fLoads`, `fSupports`) se almacena **siempre en SI**. Las conversiones solo ocurren al leer inputs del usuario (→ SI) y al mostrar resultados (SI →).

---

## 4. Solver FEM — Teoría e Implementación

### 4.1 Elemento Euler-Bernoulli

La viga se discretiza en `nEl = nSegs × nps` elementos de longitud `le = L/nEl`, donde `nps` es el número de elementos por segmento (input `#fN`, por defecto 10).

Cada nodo tiene 2 DOFs: `[v_i, θ_i]` donde:
- `v_i` = desplazamiento transversal (m), **convención: +v = hacia arriba**
- `θ_i` = giro (rad), **convención: +θ = antihorario (↺)**

La matriz de rigidez del elemento (4×4, Euler-Bernoulli):

```
ke = (EI/le³) × [  12,   6le,  -12,   6le ]
                  [  6le,  4le²,  -6le,  2le² ]
                  [ -12,  -6le,   12,  -6le ]
                  [  6le,  2le²,  -6le,  4le² ]
```

Implementada en `fElemK(EI, le)`.

### 4.2 Ensamblado del Sistema Global

El sistema global `K·u = F` tiene `nDof = 2×(nEl+1)` ecuaciones.

**Ensamblado de K:** estándar por conectividad de elementos.

**Ensamblado de F (vector de cargas):**

| Tipo de carga | Método |
|--------------|--------|
| Distribuida uniforme (`dis`) | Cuadratura de Gauss 5 puntos con funciones de forma Hermite |
| Triangular (`tri`) | Ídem, intensidad interpolada linealmente |
| Polinomial (`pol`) | Ídem, evaluando `evalExpr(expr, x, L)` |
| Puntual (`pun`) | Ensamble directo: `F[2·idx] += val` |
| Momento puntual (`mom`) | Ensamble directo: `F[2·idx+1] += val` |
| Gradiente térmico (`temp`) | Momentos ficticios equivalentes: `EI·κ_T·[0,+1,0,−1]` por elemento, donde `κ_T = α·ΔT/h`, `ΔT = T_inf − T_sup` |

**Convención de signo de cargas:**
- `↑+` en la UI: el usuario ingresa positivo para fuerzas hacia arriba
- Las cargas se almacenan en SI con el mismo signo (positivo = hacia arriba en el vector F)
- Esto es consistente con la convención FEM donde +v = hacia arriba

### 4.3 Condiciones de Borde

Para cada apoyo en `fSupports`:

- **DOF rígido** (kV=null o kTheta=null): método de eliminación. Para cada DOF `i` prescrito a `δ_i`:
  1. `Ff[j] -= K[j][i] × δ_i` para todos los j libres
  2. Anular fila/columna i, poner `Kf[i][i] = 1`, `Ff[i] = δ_i`

- **DOF con resorte** (kV o kTheta definido): `K[dof][dof] += k` antes de aplicar BCs

### 4.4 Resolución

`luSolve(Kf, Ff)` en shared.js — descomposición LU con pivoteo parcial. Retorna `null` si el pivote es menor que `1e-15` (matriz singular = estructura inestable).

Post-solve: validación de deflexión máxima (`> 1e5` m → resultado inválido).

### 4.5 Post-Proceso

**Momento flector M(x):**
```
M_FEM[i] = EI × (θ[i+1] - θ[i]) / le   (diferencia de giros)
```
Para cargas térmicas, se resta el momento ficticio:
```
M_real[i] = M_FEM[i] − EI × κ_T
```

**Cortante V(x):** integración de la ecuación de equilibrio diferencial `dV/dx = −q(x)`, comenzando desde las reacciones en los apoyos. Más estable numéricamente que derivar M.

**Reacciones:** `R[i] = (K · u)[i] − F[i]` para cada DOF restringido.

**Esfuerzo cortante τ_máx (por elemento):**
```
τ_máx = V × Q_máx / (Ix × b_NA)
```
donde `Q_máx` es el momento estático de la mitad de la sección respecto al eje neutro, y `b_NA` es el ancho en el nivel neutro.

**Tensión normal σ (fibra crítica, nodal):**
```
σ_crit[ni] = N/A ± M × c / Ix
```
donde `c` es la distancia de la fibra más lejana al centroide. El signo ± selecciona la fibra de mayor |σ|.

### 4.6 Solver Axial

Para vigas con cargas axiales (`tipo='axial'`) o apoyos `restrictU=true`, se resuelve un segundo sistema FEM de barra en paralelo:
- 1 DOF por nodo (desplazamiento axial u)
- Rigidez elemental: `ke = EA/le × [1, -1; -1, 1]`
- Retorna `N_elem_arr`: fuerza axial por elemento

---

## 5. Propiedades de Sección — `fSecProps(s)`

Función central que calcula todas las propiedades geométricas según `secType`:

| Propiedad | Descripción |
|-----------|-------------|
| `Ix` | Momento de inercia respecto al eje centroidal (m⁴) |
| `A` | Área de la sección (m²) |
| `yc` | Centroide desde la fibra inferior (m) |
| `Qmax` | Momento estático máximo (m³) — para τ_máx |
| `b_for_tau_max` | Ancho en el nivel donde Q es máximo (m) |
| `H_tot` | Altura total (m) — para secciones compuestas |

**Para secciones compuestas:** `fCompositeSecProps(s)` calcula propiedades de la sección transformada:
- Material de referencia: capa 0 (E₀)
- Factor de transformación por capa: `n_i = E_i / E₀`
- Área transformada: `A_tr = Σ n_i × A_i`
- Centroide transformado: `yc_global = Σ(n_i × A_i × y_i) / A_tr`
- Inercia transformada: `I_tr = Σ n_i × (I_i + A_i × d_i²)`

---

## 6. Visualización

### 6.1 Diagrama de Viga (`drawBeamDiagram`)

Canvas HTML5 (`#cvBeam`, altura 160px). Dibuja de izquierda a derecha:

1. **Cuerpo de la viga** — rectángulos coloreados por segmento (paleta de 6 colores)
2. **Apoyos** — según DOFs restringidos:
   - Solo `restrictV` → rodillo (triángulo + círculos)
   - `restrictV` + `restrictU` → pasador (triángulo + rayas)
   - `restrictV` + `restrictTheta` → empotramiento (pared con rayas)
   - Con resorte → símbolo zigzag naranja
3. **Cargas** — flechas en dirección física (↑+ positivo):
   - Puntual: flecha con arrowhead en superficie de viga
   - Distribuida: líneas paralelas con arrowheads + línea conectora + etiqueta
   - Triangular: polígono relleno + flechas proporcionales
   - Momento: semicírculo sobre la viga (↺ = arco izq→der, ↻ = arco der→izq)
   - Térmica: gradiente de color (rojo=caliente, azul=frío) sobre el tramo
4. **Indicadores** — asentamiento prescrito (flecha discontinua naranja), u=0 (doble barra)

### 6.2 Gráficas Interactivas (`fMkChart`)

Todas las gráficas usan Chart.js tipo `'line'`. Configuración común:
- Fondo oscuro (`#0d0f10`)
- Sin leyenda, sin título (el título está en el DOM encima)
- Línea de referencia en y=0 (plugin annotation)
- Click en gráfica → actualiza el visor de sección en esa posición x

Gráficas disponibles (en orden de visualización):

| ID Canvas | Contenido | Tipo dato | Eje x |
|-----------|-----------|-----------|-------|
| `fcQ` | Carga distribuida q(x) | Stepped, por elemento | xs_e (centros) |
| `fcV` | Deflexión v(x) | Continuo | xs_n (nodos) |
| `fcTheta` | Giro θ(x) | Continuo | xs_n |
| `fcM` | Momento flector M(x) | Continuo, con relleno | xs_n |
| `fcV2` | Cortante V(x) | Stepped | xs_v |
| `fcTau` | Esfuerzo cortante τ_máx(x) | Stepped, por elemento | xs_e |
| `fcSig` | Tensión normal σ_crit(x) | Continuo, con relleno | xs_n |
| `fcN` | Fuerza normal N(x) | Stepped, oculto si N≡0 | xs_e |
| `fcRas` | Fuerza rasante q_r(x) | Stepped | xs_e |

### 6.3 Visor de Sección Transversal (`drawFlexSection`)

Canvas `#cvFlexSec`. Para la posición x seleccionada dibuja:
- Perfil geométrico de la sección a escala
- Diagrama de distribución σ(y) como polígono relleno (tensión en función de la altura)
- Línea del eje neutro (dashed)
- Línea de referencia N/A cuando hay carga axial
- Etiquetas σ_top y σ_bot
- Interactividad: hover muestra σ en altura y arbitraria

### 6.4 Diagrama Rasante (`fComputeRasante`)

Canvas `#cvFlexRas`. Muestra distribución τ(y) para la posición x activa:
- Calcula Q(y) integrando desde la fibra extrema hasta y_cut
- Traza τ(y) = V·Q(y) / (Ix · b(y))
- Input `#fRasYcutInp` selecciona la fibra de corte para q_r(x) = τ · b · s

---

## 7. Sistema Undo/Redo

`fSnapState()` serializa el estado completo a JSON:
```javascript
{
  segs: deep_copy(fSegs),
  loads: deep_copy(fLoads),
  supports: deep_copy(fSupports),
  units: { fUnitLen, fUnitE, fUnitSpan, fUnitForce, ... }
}
```

`fPushUndo()` llama a `fSnapState()` y empuja a `fUndoStack` (máx 60). Se invoca **antes** de cualquier operación destructiva (add/delete segmento, carga, apoyo).

`fTrackEdit()` es un debouncer (900ms) que captura cambios en inputs de campo (setters). Permite deshacer ediciones de valores sin generar un snapshot por cada tecla.

`fUndo()` / `fRedo()` mueven entre stacks y llaman `fApplySnap(snap)` que restaura el estado y re-renderiza todo.

---

## 8. Persistencia

**Guardar (`fSaveProject`):** serializa `{fSegs, fLoads, fSupports, units, version}` como JSON y dispara descarga del archivo.

**Cargar (`fLoadProject`):** lee el JSON, valida que existan las claves esperadas, restaura el estado con `fApplySnap`-like y re-renderiza. Compatible con proyectos de versiones anteriores siempre que tengan las claves mínimas.

**Exportar PNG (`fExportPNG`):** combina en un canvas off-screen todos los canvas visibles (`cvBeam` + todos los `fcXxx` con datos) y descarga como PNG.

---

## 9. Convenciones de Signo (Resumen)

| Cantidad | Positivo significa |
|----------|--------------------|
| Desplazamiento v | Hacia arriba |
| Giro θ | Antihorario (↺) |
| Momento M | Sagging (fibra inferior en tracción) |
| Cortante V | Fuerza hacia arriba en cara izquierda del corte |
| Carga puntual P | Hacia arriba |
| Carga distribuida q | Hacia arriba |
| Momento puntual M_ext | Antihorario (↺) — UI: ↺+ |
| ΔT térmico | `T_inf − T_sup`: positivo cuando fibra inferior más caliente → flecha hacia arriba |
| Reacción R | Hacia arriba (igual que v) |
| σ | Positivo = tracción |

---

## 10. Módulo de Torsión (torsion.js)

Solver FEM 1D para barras bajo torsión. Estructura análoga al módulo de flexión pero más simple:
- 1 DOF por nodo: ángulo de giro φ (rad)
- Rigidez elemental: `ke = GJ/le × [1, -1; -1, 1]`
- Cargas: momentos torsores puntuales, distribuidos, triangulares, polinomiales
- Condiciones de borde: φ=0 en extremo(s)
- Resultados: T(x), φ(x), τ_máx(x) = T·r/J
- Solo secciones circulares macizas y huecas

---

## 11. Extensibilidad — Cómo Agregar un Nuevo Módulo

Para agregar un módulo nuevo (ej: Axial):

1. **HTML:** agregar `<div id="moduleAxial" class="main" style="display:none">` con la estructura aside/results, y un botón en `.mod-bar`
2. **JS:** crear `js/axial.js` con el mismo patrón de state + solver + render
3. **main.js:** agregar el módulo al array de módulos en `switchModule()`
4. **shared.js:** las utilidades `luSolve`, `evalExpr`, `parseSci` ya están disponibles

El solver axial FEM ya existe como subrutina dentro de `fSolve()` en flexion.js y puede extraerse directamente.

---

## 12. Dependencias Externas

| Librería | Versión | Uso |
|----------|---------|-----|
| Chart.js | 4.4.1 | Todas las gráficas interactivas |
| chartjs-plugin-annotation | 3.0.1 | Línea y=0 en gráficas |
| Google Fonts (DM Mono, DM Sans) | — | Tipografía |

Sin bundler, sin transpilación, sin node_modules. El proyecto corre directamente en el navegador abriendo `index.html`.

---

*Documentación generada en sesión de desarrollo — Abril 2026*

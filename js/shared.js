// ══════════════════════════════════════════════════════════════
// shared.js — Utilidades comunes para Torsión y Flexión FEM
// Contenido:
//   · UNIT_SYSTEMS + setUnits + funciones de conversión
//   · parseSci, fmtSciPreview, sciField, initSciBadges
//   · evalExpr
//   · luSolve
//   · fmtVal
// ══════════════════════════════════════════════════════════════
// ── UNIT SYSTEM ───────────────────────────────────────────────
// All internal calculations are ALWAYS in SI: N, m, Pa, rad
// The unit system only affects INPUT display labels and OUTPUT display values.
//
// Conversion: userValue * toSI_force gives Newtons
//             userValue * toSI_moment gives N·m
//             userValue * toSI_stress gives Pa (G input)
//             userValue * toSI_springK gives N·m/rad
//
// For display: SIvalue / fromSI_xxx gives user units

const UNIT_SYSTEMS = {
  SI_N: {
    id: 'SI_N',
    label: 'N · m · GPa',
    // lengths stay in m, forces in N, moments in N·m, G in GPa
    toSI_moment: 1,           // N·m → N·m
    toSI_momentPerLen: 1,     // N·m/m → N·m/m
    toSI_G: 1e9,              // GPa → Pa
    toSI_springK: 1,          // N·m/rad → N·m/rad
    fromSI_moment: 1,
    fromSI_momentPerLen: 1,
    fromSI_G: 1e-9,
    fromSI_springK: 1,
    fromSI_stress: 1e-6,      // Pa → MPa
    unitMoment: 'N·m',
    unitMomentPerLen: 'N·m/m',
    unitG: 'GPa',
    unitSpringK: 'N·m/rad',
    unitStress: 'MPa',
    unitGJ: 'kN·m²',
    fromSI_GJ: 1e-3,
    defaultG: 79.3,
    defaultSpringK: 1000,
    hintText: 'Entradas en N, m, GPa. Ángulo en mrad, esfuerzo en MPa.',
  },
  SI_kN: {
    id: 'SI_kN',
    label: 'kN · m · GPa',
    toSI_moment: 1e3,         // kN·m → N·m
    toSI_momentPerLen: 1e3,   // kN·m/m → N·m/m
    toSI_G: 1e9,              // GPa → Pa
    toSI_springK: 1e3,        // kN·m/rad → N·m/rad
    fromSI_moment: 1e-3,
    fromSI_momentPerLen: 1e-3,
    fromSI_G: 1e-9,
    fromSI_springK: 1e-3,
    fromSI_stress: 1e-3,      // Pa → kPa  (but we show in GPa equiv → use MPa/1000 → kPa)
    unitMoment: 'kN·m',
    unitMomentPerLen: 'kN·m/m',
    unitG: 'GPa',
    unitSpringK: 'kN·m/rad',
    unitStress: 'kPa',
    unitGJ: 'kN·m²',
    fromSI_GJ: 1e-3,
    defaultG: 79.3,
    defaultSpringK: 1,
    hintText: 'Entradas en kN, m, GPa. Ángulo en mrad, esfuerzo en kPa.',
  },
  kgf: {
    id: 'kgf',
    label: 'kgf · m · kgf/m²',
    // 1 kgf = 9.80665 N
    toSI_moment: 9.80665,           // kgf·m → N·m
    toSI_momentPerLen: 9.80665,     // kgf·m/m → N·m/m
    toSI_G: 9.80665,                // kgf/m² → Pa
    toSI_springK: 9.80665,          // kgf·m/rad → N·m/rad
    fromSI_moment: 1/9.80665,
    fromSI_momentPerLen: 1/9.80665,
    fromSI_G: 1/9.80665,
    fromSI_springK: 1/9.80665,
    fromSI_stress: 1/9.80665,       // Pa → kgf/m²
    unitMoment: 'kgf·m',
    unitMomentPerLen: 'kgf·m/m',
    unitG: 'kgf/m²',
    unitSpringK: 'kgf·m/rad',
    unitStress: 'kgf/m²',
    unitGJ: 'kgf·m²',
    fromSI_GJ: 1/9.80665,
    defaultG: 79.3e9/9.80665,
    defaultSpringK: 1000/9.80665,
    hintText: 'Entradas en kgf, m, kgf/m². Ángulo en mrad, esfuerzo en kgf/m².',
  },
  tf: {
    id: 'tf',
    label: 'tf · m · tf/m²',
    // 1 tf = 1000 kgf = 9806.65 N
    toSI_moment: 9806.65,
    toSI_momentPerLen: 9806.65,
    toSI_G: 9806.65,
    toSI_springK: 9806.65,
    fromSI_moment: 1/9806.65,
    fromSI_momentPerLen: 1/9806.65,
    fromSI_G: 1/9806.65,
    fromSI_springK: 1/9806.65,
    fromSI_stress: 1/9806.65,
    unitMoment: 'tf·m',
    unitMomentPerLen: 'tf·m/m',
    unitG: 'tf/m²',
    unitSpringK: 'tf·m/rad',
    unitStress: 'tf/m²',
    unitGJ: 'tf·m²',
    fromSI_GJ: 1/9806.65,
    defaultG: 79.3e9/9806.65,
    defaultSpringK: 1000/9806.65,
    hintText: 'Entradas en tf, m, tf/m². Ángulo en mrad, esfuerzo en tf/m².',
  },
  // ── cm² systems: moment in N·m or kN·m, G in pressure/cm²  ──
  // 1 kgf/cm² = 98066.5 Pa
  // 1 kN/cm²  = 10000000 Pa = 10 MPa
  N_cm2: {
    id: 'N_cm2',
    label: 'N · m · kgf/cm²',
    toSI_moment: 1,
    toSI_momentPerLen: 1,
    toSI_G: 98066.5,           // kgf/cm² → Pa
    toSI_springK: 1,
    fromSI_moment: 1,
    fromSI_momentPerLen: 1,
    fromSI_G: 1/98066.5,
    fromSI_springK: 1,
    fromSI_stress: 1/98066.5,  // Pa → kgf/cm²
    unitMoment: 'N·m',
    unitMomentPerLen: 'N·m/m',
    unitG: 'kgf/cm²',
    unitSpringK: 'N·m/rad',
    unitStress: 'kgf/cm²',
    unitGJ: 'N·m²',
    fromSI_GJ: 1,
    defaultG: 79.3e9/98066.5,   // ~808500 kgf/cm²
    defaultSpringK: 1000,
    hintText: 'Entradas en N, m, kgf/cm². Ángulo en mrad, esfuerzo en kgf/cm².',
  },
  kN_cm2: {
    id: 'kN_cm2',
    label: 'kN · m · kN/cm²',
    toSI_moment: 1e3,
    toSI_momentPerLen: 1e3,
    toSI_G: 1e7,               // kN/cm² → Pa  (1 kN/cm² = 10 MPa = 1e7 Pa)
    toSI_springK: 1e3,
    fromSI_moment: 1e-3,
    fromSI_momentPerLen: 1e-3,
    fromSI_G: 1e-7,
    fromSI_springK: 1e-3,
    fromSI_stress: 1e-7,       // Pa → kN/cm²
    unitMoment: 'kN·m',
    unitMomentPerLen: 'kN·m/m',
    unitG: 'kN/cm²',
    unitSpringK: 'kN·m/rad',
    unitStress: 'kN/cm²',
    unitGJ: 'kN·m²',
    fromSI_GJ: 1e-3,
    defaultG: 79.3e9/1e7,      // 7930 kN/cm²  (≈ 79.3 GPa)
    defaultSpringK: 1,
    hintText: 'Entradas en kN, m, kN/cm². Ángulo en mrad, esfuerzo en kN/cm².',
  },
  kgf_cm2: {
    id: 'kgf_cm2',
    label: 'kgf · m · kgf/cm²',
    toSI_moment: 9.80665,
    toSI_momentPerLen: 9.80665,
    toSI_G: 98066.5,
    toSI_springK: 9.80665,
    fromSI_moment: 1/9.80665,
    fromSI_momentPerLen: 1/9.80665,
    fromSI_G: 1/98066.5,
    fromSI_springK: 1/9.80665,
    fromSI_stress: 1/98066.5,
    unitMoment: 'kgf·m',
    unitMomentPerLen: 'kgf·m/m',
    unitG: 'kgf/cm²',
    unitSpringK: 'kgf·m/rad',
    unitStress: 'kgf/cm²',
    unitGJ: 'kgf·m²',
    fromSI_GJ: 1/9.80665,
    defaultG: 79.3e9/98066.5,
    defaultSpringK: 1000/9.80665,
    hintText: 'Entradas en kgf, m, kgf/cm². Ángulo en mrad, esfuerzo en kgf/cm².',
  },
  tf_cm2: {
    id: 'tf_cm2',
    label: 'tf · m · tf/cm²',
    // 1 tf/cm² = 1000 kgf/cm² = 98066500 Pa
    toSI_moment: 9806.65,
    toSI_momentPerLen: 9806.65,
    toSI_G: 98066500,
    toSI_springK: 9806.65,
    fromSI_moment: 1/9806.65,
    fromSI_momentPerLen: 1/9806.65,
    fromSI_G: 1/98066500,
    fromSI_springK: 1/9806.65,
    fromSI_stress: 1/98066500,
    unitMoment: 'tf·m',
    unitMomentPerLen: 'tf·m/m',
    unitG: 'tf/cm²',
    unitSpringK: 'tf·m/rad',
    unitStress: 'tf/cm²',
    unitGJ: 'tf·m²',
    fromSI_GJ: 1/9806.65,
    defaultG: 79.3e9/98066500, // ~0.8085 tf/cm²  → show as ~808.5 to be useful; actually 79.3GPa / 98066500 ≈ 808.5
    defaultSpringK: 1000/9806.65,
    hintText: 'Entradas en tf, m, tf/cm². Ángulo en mrad, esfuerzo en tf/cm².',
  }
};

let currentUnits = UNIT_SYSTEMS.SI_kN;  // overwritten by tBuildUnits() on init

// ── TORSION INDEPENDENT UNIT STATE ───────────────────────────
let tUnitTorque = 'kNm';   // 'Nm'|'kNm'|'kgfm'|'tfm'
let tUnitG      = 'GPa';   // 'GPa'|'MPa'|'kgcm2'|'tcm2'
let tUnitStress = 'MPa';   // 'MPa'|'kPa'|'kgcm2'|'tcm2'

const _tTorqueCfg = {
  Nm:   { toSI:1,          fromSI:1,            unit:'N\u00b7m',   unitPerLen:'N\u00b7m/m',   unitK:'N\u00b7m/rad',   unitGJ:'N\u00b7m\u00b2',   fromSI_GJ:1,         defK:1000 },
  kNm:  { toSI:1e3,        fromSI:1e-3,         unit:'kN\u00b7m',  unitPerLen:'kN\u00b7m/m',  unitK:'kN\u00b7m/rad',  unitGJ:'kN\u00b7m\u00b2',  fromSI_GJ:1e-3,      defK:1 },
  kgfm: { toSI:9.80665,    fromSI:1/9.80665,    unit:'kgf\u00b7m', unitPerLen:'kgf\u00b7m/m', unitK:'kgf\u00b7m/rad', unitGJ:'kgf\u00b7m\u00b2', fromSI_GJ:1/9.80665, defK:102 },
  tfm:  { toSI:9806.65,    fromSI:1/9806.65,    unit:'tf\u00b7m',  unitPerLen:'tf\u00b7m/m',  unitK:'tf\u00b7m/rad',  unitGJ:'tf\u00b7m\u00b2',  fromSI_GJ:1/9806.65, defK:0.1 },
};
const _tGCfg = {
  GPa:   { toSI:1e9,       fromSI:1e-9,       unit:'GPa',       defG:79.3 },
  MPa:   { toSI:1e6,       fromSI:1e-6,       unit:'MPa',       defG:79300 },
  kgcm2: { toSI:98066.5,   fromSI:1/98066.5,  unit:'kgf/cm\u00b2', defG:+(79.3e9/98066.5).toFixed(0) },
  tcm2:  { toSI:98066500,  fromSI:1/98066500, unit:'tf/cm\u00b2',  defG:+(79.3e9/98066500).toFixed(3) },
};
const _tStressCfg = {
  MPa:   { fromSI:1e-6,       unit:'MPa' },
  kPa:   { fromSI:1e-3,       unit:'kPa' },
  kgcm2: { fromSI:1/98066.5,  unit:'kgf/cm\u00b2' },
  tcm2:  { fromSI:1/98066500, unit:'tf/cm\u00b2' },
};

function tBuildUnits() {
  const tc = _tTorqueCfg[tUnitTorque];
  const gc = _tGCfg[tUnitG];
  const sc = _tStressCfg[tUnitStress];
  currentUnits = {
    id: `${tUnitTorque}_${tUnitG}_${tUnitStress}`,
    label: `${tc.unit} · ${gc.unit} · ${sc.unit}`,
    toSI_moment:       tc.toSI,
    toSI_momentPerLen: tc.toSI,
    toSI_G:            gc.toSI,
    toSI_springK:      tc.toSI,
    fromSI_moment:     tc.fromSI,
    fromSI_momentPerLen: tc.fromSI,
    fromSI_G:          gc.fromSI,
    fromSI_springK:    tc.fromSI,
    fromSI_stress:     sc.fromSI,
    fromSI_GJ:         tc.fromSI_GJ,
    unitMoment:        tc.unit,
    unitMomentPerLen:  tc.unitPerLen,
    unitG:             gc.unit,
    unitSpringK:       tc.unitK,
    unitStress:        sc.unit,
    unitGJ:            tc.unitGJ,
    defaultG:          gc.defG,
    defaultSpringK:    tc.defK,
  };
}

function tRefresh() {
  tBuildUnits();
  tRenderUnitPanel();
  renderBCFields();
  renderSegs();
  renderLoads();
  updateChartUnitLabels();
}

function tSetUnitTorque(u) { tUnitTorque = u; tRefresh(); }
function tSetUnitG(u)      { tUnitG = u;      tRefresh(); }
function tSetUnitStress(u) { tUnitStress = u; tRefresh(); }

// Collapsible unit panel for the Torsion aside
let _tUnitOpen = false;
function tRenderUnitPanel() {
  const el = document.getElementById('tUnitPanel');
  if (!el) return;
  function uRow(label, opts, cur, fn) {
    const btns = opts.map(([val, lbl]) =>
      `<button class="sec-type-btn${cur===val?' on':''}" onclick="${fn}('${val}')"
        style="font-size:10px;padding:3px 7px;white-space:nowrap">${lbl}</button>`
    ).join('');
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span style="font-size:9px;color:var(--txt3);white-space:nowrap;flex-shrink:0">${label}</span>
      <div style="display:flex;gap:3px;flex-wrap:nowrap">${btns}</div></div>`;
  }
  const tc = _tTorqueCfg[tUnitTorque], gc = _tGCfg[tUnitG], sc = _tStressCfg[tUnitStress];
  const curLbl = `${tc.unit} · ${gc.unit} · ${sc.unit}`;
  const body = _tUnitOpen ? `
    <div style="padding:2px 12px 10px;display:flex;flex-direction:column;gap:1px">
      ${uRow('Torque / T dist.',  [['Nm','N\u00b7m'],['kNm','kN\u00b7m'],['kgfm','kgf\u00b7m'],['tfm','tf\u00b7m']], tUnitTorque, 'tSetUnitTorque')}
      ${uRow('M\u00f3dulo G',     [['GPa','GPa'],['MPa','MPa'],['kgcm2','kg/cm\u00b2'],['tcm2','t/cm\u00b2']], tUnitG, 'tSetUnitG')}
      ${uRow('Tensi\u00f3n (result.)', [['MPa','MPa'],['kPa','kPa'],['kgcm2','kgf/cm\u00b2'],['tcm2','tf/cm\u00b2']], tUnitStress, 'tSetUnitStress')}
    </div>` : '';
  el.innerHTML = `<div style="border:1px solid var(--brd);border-radius:9px;margin-bottom:8px;overflow:hidden">
    <button onclick="_tUnitOpen=!_tUnitOpen;tRenderUnitPanel()"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:rgba(255,255,255,0.02);border:none;cursor:pointer;font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase">
      <span>\u2699 Unidades &nbsp;\u00b7&nbsp; <span style="color:var(--acc)">${curLbl}</span></span>
      <span style="font-size:11px;display:inline-block;transform:rotate(${_tUnitOpen?'180deg':'0deg'})">\u25be</span>
    </button>
    ${body}
  </div>`;
}

// Legacy — kept so any residual call doesn't crash
function setUnits(id) {
  if (UNIT_SYSTEMS[id]) currentUnits = UNIT_SYSTEMS[id];
  tRenderUnitPanel();
  renderBCFields(); renderSegs(); renderLoads(); updateChartUnitLabels();
}

function updateChartUnitLabels() {
  const u = currentUnits;
  const el = (id,t) => { const e = document.getElementById(id); if(e) e.textContent = t; };
  el('ulQ', u.unitMomentPerLen);
  el('ulT', u.unitMoment);
  el('ulTau', u.unitStress);
  el('ulGJ', u.unitGJ);
}

// Convert from user units to SI (internal)
function u2si_moment(v) { return v * currentUnits.toSI_moment; }
function u2si_momentPerLen(v) { return v * currentUnits.toSI_momentPerLen; }
function u2si_G(v) { return v * currentUnits.toSI_G; }
function u2si_springK(v) { return v * currentUnits.toSI_springK; }

// Convert from SI to user units (display)
function si2u_moment(v) { return v * currentUnits.fromSI_moment; }
function si2u_momentPerLen(v) { return v * currentUnits.fromSI_momentPerLen; }
function si2u_stress(v) { return v * currentUnits.fromSI_stress; }
function si2u_GJ(v) { return v * currentUnits.fromSI_GJ; }
function si2u_springK(v) { return v * currentUnits.fromSI_springK; }

// ── SCIENTIFIC INPUT HELPERS ──────────────────────────────────
// Accepts: 1.5e3  |  5*10^4  |  5×10^4  |  5x10^4  |  plain number
// Returns NaN if unparseable.
function parseSci(raw) {
  if (raw === '' || raw === null || raw === undefined) return NaN;
  const s = String(raw).trim()
    // replace × or x followed by 10 with e notation
    .replace(/[×x\*]\s*10\s*\^\s*(-?\d+)/gi, 'e$1')
    // also handle "10^n" alone with implied × (e.g. "5·10^3" → "5e3")
    .replace(/·\s*10\s*\^\s*(-?\d+)/gi, 'e$1')
    // allow comma as decimal separator
    .replace(/,/g, '.');
  const v = Number(s);
  return isFinite(v) ? v : NaN;
}

function fmtSciPreview(v) {
  if (isNaN(v)) return '?';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || (abs < 1e-3 && abs > 0)) {
    return v.toExponential(2);
  }
  // show up to 4 sig figs
  const s = +v.toPrecision(4);
  return String(s);
}

// Build a scientific-aware text input that stores its parsed value onchange.
// onChangeFn is a JS expression string, e.g. "setSeg(1,'G',__v__)"
// where __v__ gets replaced by the parsed numeric value.
function sciField({label, value, id, dataAttrs='', onChangeFn, min='-Infinity'}) {
  const idAttr = id ? `id="${id}"` : '';
  const valStr = value !== undefined && value !== null ? String(value) : '';
  return `<div class="f">
    <label>${label}</label>
    <div class="sci-wrap">
      <input type="text" class="sci-input" ${idAttr} value="${valStr}" autocomplete="off" spellcheck="false" ${dataAttrs}
        oninput="__sciUpdate(this,${JSON.stringify(min)})"
        onchange="const __v__=parseSci(this.value);if(!isNaN(__v__)){${onChangeFn}}">
      <span class="sci-parsed"></span>
    </div>
  </div>`;
}

// Updates the preview badge inside a sci-wrap
function __sciUpdate(inp, min) {
  const badge = inp.parentElement.querySelector('.sci-parsed');
  if (!badge) return;
  const v = parseSci(inp.value);
  const minV = min === '-Infinity' ? -Infinity : Number(min);
  if (isNaN(v)) {
    badge.textContent = '?';
    badge.className = 'sci-parsed err';
  } else if (v < minV) {
    badge.textContent = '< min';
    badge.className = 'sci-parsed err';
  } else {
    badge.textContent = fmtSciPreview(v);
    badge.className = 'sci-parsed ok';
  }
}

// Initialize all sci badges on page load / re-render
function initSciBadges() {
  document.querySelectorAll('.sci-input').forEach(inp => __sciUpdate(inp, '-Infinity'));
}

// ── SEGMENTS ──────────────────────────────────────────────────

function evalExpr(expr, x, L) {
  try {
    const s = expr
      .replace(/\^/g,'**')
      .replace(/\bPI\b/g,Math.PI)
      .replace(/\bE\b(?![0-9+\-])/g,Math.E);
    return Function('x','L','"use strict";return('+s+')')(x, L);
  } catch(e) {
    return NaN;
  }
}

function getGJ(x, L) {
  const s = segs.find(s => x >= s.xa - 1e-9 && x <= s.xb + 1e-9) || segs[segs.length - 1];
  const len = s.xb - s.xa;
  const t = len > 1e-12 ? (x - s.xa) / len : 0;

  // Outer diameter (interpolated if variable)
  const de2 = (s.d2 !== undefined) ? s.d2 : s.d;
  const de = s.d + (de2 - s.d) * t;

  // Interface / inner diameter
  const di2val = (s.di2 !== undefined) ? s.di2 : (s.di || 0);
  const di = (s.di || 0) + (di2val - (s.di || 0)) * t;

  const ro = de / 2;
  const ri = di / 2;

  if (s.composite && ri > 0) {
    // Composite: GJ_eq = G_core * J_core + G_annulus * J_annulus
    // J_core    = π/2 * ri⁴
    // J_annulus = π/2 * (ro⁴ - ri⁴)
    const J_core    = Math.PI / 2 * ri**4;
    const J_annulus = Math.PI / 2 * (ro**4 - ri**4);
    const G_core    = u2si_G(s.G2 || s.G);   // Material 1 = núcleo
    const G_annulus = u2si_G(s.G);            // Material 2 = anillo
    return G_core * J_core + G_annulus * J_annulus;
  } else {
    // Solid or hollow — single material
    const J = Math.PI / 2 * (ro**4 - ri**4);
    return u2si_G(s.G) * J;
  }
}

function qAt(x, L) {
  let q = 0;
  loads.forEach(l => {
    if (l.tipo === 'dis' && x >= l.xa - 1e-9 && x <= l.xb + 1e-9) q += u2si_momentPerLen(+l.val || 0);
    if (l.tipo === 'pol' && x >= l.xa - 1e-9 && x <= l.xb + 1e-9) {
      const v = evalExpr(l.expr,x,L);
      if (!isNaN(v)) q += u2si_momentPerLen(v);
    }
  });
  return q;
}

function luSolve(A, b) {
  const n = b.length, M = A.map(r => [...r]), x = [...b];
  for (let i = 0; i < n; i++) {
    let mx = Math.abs(M[i][i]), mi = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > mx) {
        mx = Math.abs(M[k][i]);
        mi = k;
      }
    }
    [M[i], M[mi]] = [M[mi], M[i]];
    [x[i], x[mi]] = [x[mi], x[i]];
    if (Math.abs(M[i][i]) < 1e-15) return null;
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      x[k] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

function fmtVal(v, dec) {
  if (Math.abs(v) >= 1000) return v.toFixed(dec > 1 ? 1 : dec);
  if (Math.abs(v) >= 100) return v.toFixed(dec > 2 ? 2 : dec);
  return v.toFixed(dec);
}


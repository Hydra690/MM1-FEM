// ══════════════════════════════════════════════════════════════
// flexion.js — Módulo de Flexión FEM (Euler-Bernoulli)
// Contenido:
//   · Estado: fSegs, fLoads, fCharts, fSelectedPoints, fLastSolveData
//   · Apoyos: fAddSupport, fDelSupport, fSetSupportX, fToggleSupDof, fRenderSupports
//   · UI: fSwitchTab, fShowErr
//   · Segmentos: fAddSeg, fDelSeg, fNormalizeSegs, fSetSegField
//   · Secciones: fSecProps, fGetI, fGetEI2, fGetEI_at, fRenderSegs
//   · Cargas: fAddLoad, fDelLoad, fSetLoad, fRenderLoads
//   · Elemento FEM: fElemK
//   · Solver: fSolve
//   · Gráficas: fMkChart
//   · Visualización: drawBeamDiagram, drawFlexSection, fAttachSecHover
//   · Resize + fInit
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// FLEXION FEM MODULE — Euler-Bernoulli beam element (2 DOF/node)
// DOFs per node: [v_i, θ_i] (deflection in m, rotation in rad)
// Element stiffness: k = EI/L³ * [[12,6L,-12,6L],[6L,4L²,-6L,2L²],...]
// ══════════════════════════════════════════════════════════════

// ── FLEXION STATE ─────────────────────────────────────────────
const fSegs = [];
const fLoads = [];
let fSid = 0, fLid = 0;
const fCharts = {};
const fSelectedPoints = {};
let fLastClickedChart = null;
let fLastSolveData = null;
let fLastSecData   = null;  // stores geometry for hover interaction on σ(y)
let _fSecCache     = null;  // per-solve cache for fSecProps (keyed by segment id)
let fRasYcut     = null;   // y from bottom of section (m); null = not set
let fRasSpacing  = 0;      // connector spacing (m)
const fSupports = [];
let fSpId = 0;

// ── UNDO / REDO ───────────────────────────────────────────────
const fUndoStack = [];
const fRedoStack = [];
const F_MAX_UNDO = 60;
let _fPreEditSnap = null;
let _fEditTimer   = null;

function fSnapState() {
  const nEl = document.getElementById('fN');
  return JSON.stringify({
    segs: JSON.parse(JSON.stringify(fSegs)),
    loads: JSON.parse(JSON.stringify(fLoads)),
    supports: JSON.parse(JSON.stringify(fSupports)),
    sid: fSid, lid: fLid, spid: fSpId,
    n: nEl ? nEl.value : '40',
    units: { fUnitLen, fUnitE, fUnitSpan, fUnitForce, fUnitDefl, fUnitStress, fUnitDeltaV, fUnitDeltaR }
  });
}

function fPushUndo() {
  fUndoStack.push(fSnapState());
  if (fUndoStack.length > F_MAX_UNDO) fUndoStack.shift();
  fRedoStack.length = 0;
  fUpdateUndoUI();
}

function fTrackEdit() {
  if (!_fPreEditSnap) _fPreEditSnap = fSnapState();
  clearTimeout(_fEditTimer);
  _fEditTimer = setTimeout(() => {
    if (_fPreEditSnap) {
      fUndoStack.push(_fPreEditSnap);
      if (fUndoStack.length > F_MAX_UNDO) fUndoStack.shift();
      fRedoStack.length = 0;
      fUpdateUndoUI();
      _fPreEditSnap = null;
    }
  }, 900);
}

function fApplySnap(snap) {
  const s = JSON.parse(snap);
  fSegs.length = 0;     s.segs.forEach(sg => fSegs.push(sg));
  fLoads.length = 0;    s.loads.forEach(l  => fLoads.push(l));
  fSupports.length = 0; s.supports.forEach(sp => fSupports.push(sp));
  fSid = s.sid; fLid = s.lid; fSpId = s.spid;
  const nEl = document.getElementById('fN');
  if (nEl) nEl.value = s.n;
  const u = s.units;
  fUnitLen = u.fUnitLen; fUnitE = u.fUnitE; fUnitSpan = u.fUnitSpan;
  fUnitForce = u.fUnitForce; fUnitDefl = u.fUnitDefl;
  fUnitStress = u.fUnitStress; fUnitDeltaV = u.fUnitDeltaV; fUnitDeltaR = u.fUnitDeltaR;
  fRenderUnitPanel(); fRenderSegs(); fRenderLoads(); fRenderSupports();
  setTimeout(() => { fDrawSegBar(); drawBeamDiagram(); }, 80);
}

function fUndo() {
  if (!fUndoStack.length) return;
  fRedoStack.push(fSnapState());
  fApplySnap(fUndoStack.pop());
  fUpdateUndoUI();
}

function fRedo() {
  if (!fRedoStack.length) return;
  fUndoStack.push(fSnapState());
  fApplySnap(fRedoStack.pop());
  fUpdateUndoUI();
}

function fUpdateUndoUI() {
  const u = document.getElementById('fUndoBtn');
  const r = document.getElementById('fRedoBtn');
  if (u) u.disabled = !fUndoStack.length;
  if (r) r.disabled = !fRedoStack.length;
}

document.addEventListener('keydown', e => {
  if (document.getElementById('moduleFlexion')?.style.display === 'none') return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); fUndo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); fRedo(); }
});

// ── UNIT SELECTORS — sección transversal ──────────────────────
// Dimensiones y E siempre se guardan en SI (m, Pa).
// fUnitLen / fUnitE sólo afectan display e input.
let fUnitLen = 'm';    // 'm' | 'cm' | 'mm'
let fUnitE   = 'MPa';  // 'MPa' | 'GPa' | 'kgcm2' | 'tcm2'
const _fLenFactor = { m: 1, cm: 0.01, mm: 0.001 };
const _fEFactor   = { MPa: 1e6, GPa: 1e9, kgcm2: 98066.5, tcm2: 98066500 };
function fLenToSI(v)   { return (parseFloat(v) || 0) * (_fLenFactor[fUnitLen] || 1); }
function fLenFromSI(v) { return v / (_fLenFactor[fUnitLen] || 1); }
function fEToSI(v)     { return (parseFloat(v) || 0) * (_fEFactor[fUnitE]   || 1e6); }
function fEFromSI(v)   { return v / (_fEFactor[fUnitE]   || 1e6); }
function fLenFmt(v)    { return fLenFromSI(v).toFixed(fUnitLen==='m'?4:fUnitLen==='cm'?2:1); }
function fEFmt(v)      { return fEFromSI(v).toFixed(fUnitE==='GPa'?3:fUnitE==='tcm2'?2:0); }
function fLenStep()    { return fUnitLen==='m'?'0.001':fUnitLen==='cm'?'0.1':'1'; }
function fLenMin()     { return fUnitLen==='m'?'0.001':fUnitLen==='cm'?'0.1':'1'; }
function fEStep()      { return fUnitE==='GPa'?'1':fUnitE==='MPa'?'1000':fUnitE==='kgcm2'?'10000':'10'; }
function fELabel()     { return fUnitE==='kgcm2'?'kg/cm\u00b2':fUnitE==='tcm2'?'t/cm\u00b2':fUnitE; }
function fSetUnitLen(u){ fUnitLen = u; fRenderSegs(); fRenderUnitPanel(); document.querySelectorAll('.fRasUnitLbl').forEach(el => el.textContent = u); }
function fSetUnitE(u)  { fUnitE   = u; fRenderSegs(); fRenderUnitPanel(); }

// ── UNIT SELECTORS — posiciones, fuerzas, resultados ─────────
let fUnitSpan   = 'm';    // 'm'|'cm'|'mm'   — longitud viga y posiciones de carga/apoyo
let fUnitForce  = 'kN';   // 'N'|'kN'|'kgf'|'tf'  — fuerza (momento vinculado = ×m)
let fUnitDefl   = 'mm';   // 'm'|'mm'|'μm'   — flecha (resultados)
let fUnitStress = 'MPa';  // 'MPa'|'kPa'|'kgcm2'|'tcm2' — tensión (resultados)
let fUnitDeltaV = 'mm';   // 'm'|'cm'|'mm'   — asentamiento vertical
let fUnitDeltaR = 'mrad'; // 'rad'|'mrad'    — giro prescrito

const _fForceFactor  = { N:1, kN:1e3, kgf:9.80665, tf:9806.65 };
const _fSpanFactor   = { m:1, cm:0.01, mm:0.001 };
const _fDeflFactor   = { m:1, mm:1e-3, 'μm':1e-6 };
const _fStressFactor = { MPa:1e6, kPa:1e3, kgcm2:98066.5, tcm2:98066500 };
const _fDeltaVFactor = { m:1, cm:0.01, mm:0.001 };
const _fDeltaRFactor = { rad:1, mrad:0.001 };

// Fuerza / Momento (factor idéntico — momento = fuerza × m)
function fForceToSI(v)    { return (parseFloat(v)||0) * (_fForceFactor[fUnitForce]||1e3); }
function fForceFromSI(v)  { return v / (_fForceFactor[fUnitForce]||1e3); }
function fForceFmt(v)     { const d=fUnitForce==='N'?1:3; return fForceFromSI(v).toFixed(d); }
function fForceLabel()    { return fUnitForce; }
function fMomentFromSI(v) { return fForceFromSI(v); }
function fMomentFmt(v)    { return fForceFmt(v); }
function fMomentLabel()   { return fUnitForce + '\u00b7m'; }
function fFpLLabel()      { return fUnitForce + '/m'; }
// Resortes: kV en N/m (= misma base que fuerza), kTheta en N·m/rad (= misma base)
function fSpringKVFromSI(v)  { return fForceFromSI(v); }
function fSpringKTFromSI(v)  { return fForceFromSI(v); }
function fSpringKVToSI(v)    { return fForceToSI(v); }
function fSpringKTToSI(v)    { return fForceToSI(v); }
function fSpringKVLabel()    { return fUnitForce + '/m'; }
function fSpringKTLabel()    { return fUnitForce + '\u00b7m/rad'; }

// Posiciones en la viga (x, xa, xb de cargas/apoyos/segmentos)
function fSpanToSI(v)    { return (parseFloat(v)||0) * (_fSpanFactor[fUnitSpan]||1); }
function fSpanFromSI(v)  { return v / (_fSpanFactor[fUnitSpan]||1); }
function fSpanFmt(v)     { return fSpanFromSI(v).toFixed(fUnitSpan==='m'?4:fUnitSpan==='cm'?2:1); }
function fSpanStep()     { return fUnitSpan==='m'?'0.001':fUnitSpan==='cm'?'0.1':'1'; }

// Flecha (resultados)
function fDeflFromSI(v)  { return v / (_fDeflFactor[fUnitDefl]||1e-3); }
function fDeflFmt(v)     { return fDeflFromSI(v).toFixed(fUnitDefl==='m'?6:fUnitDefl==='mm'?3:1); }
function fDeflLabel()    { return fUnitDefl; }

// Tensión (resultados)
function fStressFromSI(v){ return v / (_fStressFactor[fUnitStress]||1e6); }
function fStressFmt(v)   { return fStressFromSI(v).toFixed(3); }
function fStressLabel()  { const L={MPa:'MPa',kPa:'kPa',kgcm2:'kgf/cm\u00b2',tcm2:'tf/cm\u00b2'}; return L[fUnitStress]||fUnitStress; }

// Asentamiento vertical
function fDeltaVToSI(v)  { return (parseFloat(v)||0) * (_fDeltaVFactor[fUnitDeltaV]||0.001); }
function fDeltaVFromSI(v){ return v / (_fDeltaVFactor[fUnitDeltaV]||0.001); }
function fDeltaVFmt(v)   { return fDeltaVFromSI(v).toFixed(fUnitDeltaV==='m'?5:3); }
function fDeltaVLabel()  { return fUnitDeltaV; }

// Giro prescrito
function fDeltaRToSI(v)  { return (parseFloat(v)||0) * (_fDeltaRFactor[fUnitDeltaR]||0.001); }
function fDeltaRFromSI(v){ return v / (_fDeltaRFactor[fUnitDeltaR]||0.001); }
function fDeltaRFmt(v)   { return fDeltaRFromSI(v).toFixed(fUnitDeltaR==='rad'?6:3); }
function fDeltaRLabel()  { return fUnitDeltaR; }

// Setters de unidad — actualizan UI y re-calculan si ya hay solución
function fSetUnitSpan(u)   { fUnitSpan=u;   fRenderSegs(); fRenderLoads(); fRenderSupports(); fRenderUnitPanel(); }
function fSetUnitForce(u)  { fUnitForce=u;  fRenderLoads(); fRenderSupports(); fRenderUnitPanel(); if(fLastSolveData) fSolve(); }
function fSetUnitDefl(u)   { fUnitDefl=u;   fRenderUnitPanel(); if(fLastSolveData) fSolve(); }
function fSetUnitStress(u) { fUnitStress=u; fRenderUnitPanel(); if(fLastSolveData) fSolve(); }
function fSetUnitDeltaV(u) { fUnitDeltaV=u; fRenderSupports(); drawBeamDiagram(); fRenderUnitPanel(); }
function fSetUnitDeltaR(u) { fUnitDeltaR=u; fRenderSupports(); drawBeamDiagram(); fRenderUnitPanel(); }

let _fUnitOpen = false;
function fRenderUnitPanel() {
  const el = document.getElementById('fUnitPanel');
  if (!el) return;
  function uRow(label, units, current, fn, lbl) {
    const btns = units.map(u =>
      `<button class="sec-type-btn${current===u?' on':''}" onclick="${fn}('${u}')" style="font-size:10px;padding:3px 7px;white-space:nowrap">${lbl?lbl(u):u}</button>`
    ).join('');
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span style="font-size:9px;color:var(--txt3);white-space:nowrap;flex-shrink:0">${label}</span>
      <div style="display:flex;gap:3px;flex-wrap:nowrap">${btns}</div></div>`;
  }
  const eL = k=>({MPa:'MPa',GPa:'GPa',kgcm2:'kg/cm\u00b2',tcm2:'t/cm\u00b2'})[k]||k;
  const sL = k=>({MPa:'MPa',kPa:'kPa',kgcm2:'kgf/cm\u00b2',tcm2:'tf/cm\u00b2'})[k]||k;
  const curLbl = `${fUnitForce} · m · ${fELabel()}`;
  const body = _fUnitOpen ? `
    <div style="padding:2px 12px 10px;display:flex;flex-direction:column;gap:1px">
      ${uRow('Longitud (viga/cargas)',['m','cm','mm'],fUnitSpan,'fSetUnitSpan')}
      ${uRow('Dimensiones secci\u00f3n',['m','cm','mm'],fUnitLen,'fSetUnitLen')}
      ${uRow('Fuerza / Momento',['N','kN','kgf','tf'],fUnitForce,'fSetUnitForce')}
      ${uRow('M\u00f3dulo E',['MPa','GPa','kgcm2','tcm2'],fUnitE,'fSetUnitE',eL)}
      ${uRow('Flecha (result.)','m,mm,μm'.split(','),fUnitDefl,'fSetUnitDefl')}
      ${uRow('Tensi\u00f3n (result.)',['MPa','kPa','kgcm2','tcm2'],fUnitStress,'fSetUnitStress',sL)}
      ${uRow('Asentam. vertical',['m','cm','mm'],fUnitDeltaV,'fSetUnitDeltaV')}
      ${uRow('Giro prescrito',['rad','mrad'],fUnitDeltaR,'fSetUnitDeltaR')}
    </div>` : '';
  el.innerHTML = `<div style="border:1px solid var(--brd);border-radius:9px;margin-bottom:8px;overflow:hidden">
    <button onclick="_fUnitOpen=!_fUnitOpen;fRenderUnitPanel()"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:rgba(255,255,255,0.02);border:none;cursor:pointer;font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase">
      <span>⚙ Unidades &nbsp;·&nbsp; <span style="color:var(--acc)">${curLbl}</span></span>
      <span style="font-size:11px;transition:transform .2s;display:inline-block;transform:rotate(${_fUnitOpen?'180deg':'0deg'})">\u25be</span>
    </button>
    ${body}
  </div>`;
}

// ── APOYOS (condiciones de borde por posición) ─────────────────
function fAddSupport(x, restrictV = true, restrictTheta = false) {
  fPushUndo();
  const L = fGetL();
  fSupports.push({ id: ++fSpId, x: Math.max(0, Math.min(L, parseFloat(x) || 0)), restrictV, restrictU: false, restrictTheta, kV: null, kTheta: null, deltaV: 0, deltaTheta: 0 });
  fRenderSupports();
  drawBeamDiagram();
}

function fDelSupport(id) {
  fPushUndo();
  const i = fSupports.findIndex(s => s.id === id);
  if (i >= 0) fSupports.splice(i, 1);
  fRenderSupports();
  drawBeamDiagram();
}

function fSetSupportX(id, val) {
  fTrackEdit();
  const s = fSupports.find(s => s.id === id);
  if (!s) return;
  const v = parseFloat(val);
  if (!isNaN(v)) s.x = Math.max(0, Math.min(fGetL(), v));
  fRenderSupports();
  drawBeamDiagram();
}

function fToggleSupDof(id, dof) {
  fTrackEdit();
  const s = fSupports.find(s => s.id === id);
  if (!s) return;
  if (dof === 'v') { s.restrictV = !s.restrictV; if (!s.restrictV) s.kV = null; }
  if (dof === 'u') s.restrictU = !s.restrictU;
  if (dof === 't') { s.restrictTheta = !s.restrictTheta; if (!s.restrictTheta) s.kTheta = null; }
  fRenderSupports();
  drawBeamDiagram();
}

function fToggleSpring(id, dof, enabled) {
  const s = fSupports.find(s => s.id === id);
  if (!s) return;
  const defK = 1e6;  // 1 MN/m = 1000 kN/m (SI, N/m)
  if (dof === 'v') s.kV     = enabled ? defK : null;
  if (dof === 't') s.kTheta = enabled ? defK : null;
  fRenderSupports();
  drawBeamDiagram();
}

function fSetSpringK(id, dof, val) {
  const s = fSupports.find(s => s.id === id);
  if (!s) return;
  const k = parseFloat(val);
  if (dof === 'v') s.kV     = (isNaN(k) || k <= 0) ? null : fSpringKVToSI(k);  // store SI (N/m)
  if (dof === 't') s.kTheta = (isNaN(k) || k <= 0) ? null : fSpringKTToSI(k);  // store SI (N·m/rad)
  fRenderSupports();
  drawBeamDiagram();
}

function fSetSettlement(id, dof, val) {
  const s = fSupports.find(s => s.id === id);
  if (!s) return;
  const v = parseFloat(val);
  if (dof === 'v') s.deltaV     = isNaN(v) ? 0 : fDeltaVToSI(v);   // store SI (m)
  if (dof === 't') s.deltaTheta = isNaN(v) ? 0 : fDeltaRToSI(v);   // store SI (rad)
  drawBeamDiagram();
}

function fSupLabel(s) {
  const sv = s.restrictV, su = s.restrictU || false, st = s.restrictTheta;
  const kv = s.kV != null, kt = s.kTheta != null;
  if (!sv && !su && !st) return { icon:'○', name:'Libre', genus:'—', react:'—' };
  // Fully rigid cases (no springs)
  if (sv && su && st && !kv && !kt) return { icon:'▰', name:'Empotrado',      genus:'3° gén.', react:'Rx + Ry + Mr' };
  if (sv && su && !st && !kv)       return { icon:'△', name:'Articulación',   genus:'2° gén.', react:'Rx + Ry'      };
  if (sv && !su && !st && !kv)      return { icon:'△', name:'Apoyo simple',   genus:'1° gén.', react:'Ry'           };
  if (!sv && !su && st && !kt)      return { icon:'↔', name:'Deslizadera',    genus:'1° gén.', react:'Mr'           };
  if (!sv && su && !st)             return { icon:'→', name:'Pasador horiz.', genus:'axial',   react:'Rx'           };
  // Cases with springs / mixed
  const rParts = [];
  if (su) rParts.push('Rx');
  if (sv) rParts.push(kv ? 'Ry~' : 'Ry');
  if (st) rParts.push(kt ? 'Mr~' : 'Mr');
  const hasAnySpring = kv || kt;
  const allSpring    = (sv ? kv : true) && (st ? kt : true);
  return {
    icon: hasAnySpring ? '⌇' : '▰',
    name: allSpring ? 'Con resorte' : hasAnySpring ? 'Emp.+resorte' : 'Mixto',
    genus: hasAnySpring ? 'elástico' : 'mixto',
    react: rParts.join(' + ')
  };
}

function fRenderSupports() {
  const el = document.getElementById('fSupList');
  if (!el) return;
  if (!fSupports.length) {
    el.innerHTML = '<p class="hint" style="margin:4px 0 8px">Sin apoyos — agrega al menos uno.</p>';
    return;
  }
  const kvUnit = fSpringKVLabel();
  const ktUnit = fSpringKTLabel();
  el.innerHTML = fSupports.map(s => {
    const lb = fSupLabel(s);
    // Spring rows shown when the DOF is active
    let springRows = '';
    if (s.restrictV) {
      springRows += `<div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:var(--txt2);white-space:nowrap">
          <input type="checkbox" ${s.kV!=null?'checked':''} onchange="fToggleSpring(${s.id},'v',this.checked)"
                 style="accent-color:var(--orange);cursor:pointer;width:12px;height:12px">
          <span>⌇ resorte ↕</span>
        </label>
        ${s.kV!=null ? `<input type="number" value="${fSpringKVFromSI(s.kV).toFixed(3)}" min="0.001" step="any"
            style="width:80px;font-size:10px;height:24px"
            onchange="fSetSpringK(${s.id},'v',this.value)">
          <span style="font-size:9px;color:var(--txt3)">${kvUnit}</span>` : ''}
      </div>`;
      // Settlement input — only for rigid (no spring) vertical constraint
      if (s.kV == null) {
        springRows += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--txt2);white-space:nowrap">&#x21A7; Asent. &delta;<sub>v</sub></span>
          <input type="number" value="${fDeltaVFmt(s.deltaV||0)}" step="any"
              style="width:72px;font-size:10px;height:24px"
              onchange="fSetSettlement(${s.id},'v',this.value)">
          <span style="font-size:9px;color:var(--txt3)">${fDeltaVLabel()}</span>
        </div>`;
      }
    }
    if (s.restrictTheta) {
      springRows += `<div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:var(--txt2);white-space:nowrap">
          <input type="checkbox" ${s.kTheta!=null?'checked':''} onchange="fToggleSpring(${s.id},'t',this.checked)"
                 style="accent-color:var(--orange);cursor:pointer;width:12px;height:12px">
          <span>⌇ resorte ↻</span>
        </label>
        ${s.kTheta!=null ? `<input type="number" value="${fSpringKTFromSI(s.kTheta).toFixed(3)}" min="0.001" step="any"
            style="width:80px;font-size:10px;height:24px"
            onchange="fSetSpringK(${s.id},'t',this.value)">
          <span style="font-size:9px;color:var(--txt3)">${ktUnit}</span>` : ''}
      </div>`;
      // Settlement input — only for rigid (no spring) rotational constraint
      if (s.kTheta == null) {
        springRows += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
          <span style="font-size:10px;color:var(--txt2);white-space:nowrap">&#x21BB; Asent. &delta;<sub>&theta;</sub></span>
          <input type="number" value="${fDeltaRFmt(s.deltaTheta||0)}" step="any"
              style="width:72px;font-size:10px;height:24px"
              onchange="fSetSettlement(${s.id},'t',this.value)">
          <span style="font-size:9px;color:var(--txt3)">${fDeltaRLabel()}</span>
        </div>`;
      }
    }
    return `<div class="card" style="margin-bottom:8px">
      <div class="card-head">
        <span class="badge b-acc">${lb.icon} ${lb.name}</span>
        <span style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-left:4px;flex:1">${lb.genus}</span>
        <button class="del" onclick="fDelSupport(${s.id})">&#x2715;</button>
      </div>
      <div class="r2" style="margin-top:8px">
        <div class="f">
          <label>Posición x (${fUnitSpan})</label>
          <input type="number" value="${fSpanFmt(s.x)}" step="${fSpanStep()}" min="0"
            onchange="fSetSupportX(${s.id},fSpanToSI(this.value))">
        </div>
        <div class="f">
          <label>Restricciones</label>
          <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">
            <button class="dof-btn${s.restrictV     ? ' on':''}" onclick="fToggleSupDof(${s.id},'v')">↕ v=0</button>
            <button class="dof-btn${s.restrictU     ? ' on':''}" onclick="fToggleSupDof(${s.id},'u')" title="Restringir desplazamiento horizontal (axial)">↔ u=0</button>
            <button class="dof-btn${s.restrictTheta ? ' on':''}" onclick="fToggleSupDof(${s.id},'t')">↻ θ=0</button>
          </div>
          ${springRows}
        </div>
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-top:6px;padding-top:5px;border-top:1px solid var(--brd)">
        Reacciones: <span style="color:var(--blue)">${lb.react}</span>
      </div>
    </div>`;
  }).join('');
}

function fSwitchTab(name, el) {
  document.querySelectorAll('#moduleFlexion .tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('ft-geo').style.display   = name === 'geo'   ? '' : 'none';
  document.getElementById('ft-loads').style.display = name === 'loads' ? '' : 'none';
}

function fShowErr(m) {
  const e = document.getElementById('fErrBox');
  e.textContent = m;
  e.style.display = m ? 'block' : 'none';
}

// L is derived from segments, not an independent input
function fGetL() {
  if (!fSegs.length) return 1.0;
  return fSegs[fSegs.length-1].xb;
}
function fGetN() { return parseInt(document.getElementById('fN').value) || 40; }

// Update the readonly L display
function fUpdateLDisplay() {
  const el = document.getElementById('fL');
  if (el) el.value = fGetL().toFixed(4) + ' m';
}

// ── FLEXION SEGMENTS ──────────────────────────────────────────
// Each segment: { id, xa, xb, secType, b, h, d, E }
// xa is always = xb of previous segment (enforced)
// xb is user-editable — changing it shifts L

function fAddSeg() {
  fPushUndo();
  const id = ++fSid;
  const n = fSegs.length;
  const xa = n > 0 ? fSegs[n-1].xb : 0;
  const xb = +(xa + 1.0).toFixed(4);   // new segment defaults to 1 m length
  fSegs.push({ id, xa, xb, secType:'rect', b:0.05, h:0.10, d:0.05, E: 200e9 }); // E in Pa
  fRenderSegs();
}

function fDelSeg(id) {
  fPushUndo();
  const i = fSegs.findIndex(s => s.id === id);
  if (i < 0 || fSegs.length <= 1) return;
  // Absorb deleted segment into adjacent one
  if (i < fSegs.length - 1) {
    // deleted is not last: next segment takes over its xa
    fSegs[i+1].xa = fSegs[i].xa;
  }
  // if deleted is last: previous segment keeps its xb, L just shrinks
  fSegs.splice(i, 1);
  fSegs[0].xa = 0;
  fUpdateLDisplay();
  fRenderSegs();
}

function fNormalizeSegs() {
  // Ensure chain: each xa = previous xb
  fSegs[0].xa = 0;
  for (let i = 1; i < fSegs.length; i++) fSegs[i].xa = fSegs[i-1].xb;
  fUpdateLDisplay();
}

function fHandleLengthChange() {
  // No-op: L is read-only, computed from segments
}

function fSetSegField(id, field, val) {
  const s = fSegs.find(s => s.id === id);
  if (!s) return;
  s[field] = typeof val === 'string' ? parseSci(val) || +val : val;
}

// Setters con conversión de unidades (display → SI)
function fSetSegDim(id, field, val) {
  fTrackEdit();
  const s = fSegs.find(s => s.id === id);
  if (!s) return;
  s[field] = fLenToSI(val);
}
function fSetSegE(id, val) {
  fTrackEdit();
  const s = fSegs.find(s => s.id === id);
  if (!s) return;
  s.E = fEToSI(val);
}

function fSetSegBoundary(id, field, val) {
  fTrackEdit();
  const s = fSegs.find(s => s.id === id);
  if (!s) return;
  const v = fSpanToSI(val);   // convert from display span unit to SI (m)
  if (isNaN(v) || v <= 0) return;
  const i = fSegs.indexOf(s);

  if (field === 'xb') {
    // Must be > xa of this segment, and > xa of next (if exists) + epsilon
    const minXb = s.xa + 0.001;
    const newXb = Math.max(v, minXb);
    s.xb = +newXb.toFixed(6);
    // Re-chain: all subsequent xa = previous xb
    for (let j = i+1; j < fSegs.length; j++) {
      fSegs[j].xa = fSegs[j-1].xb;
      // Ensure each segment keeps positive length (push xb if needed)
      if (fSegs[j].xb <= fSegs[j].xa + 0.001) {
        fSegs[j].xb = +(fSegs[j].xa + 0.001).toFixed(6);
      }
    }
  }
  // xa is never directly editable by user (always = previous xb)

  fUpdateLDisplay();
  fRenderSegs();
}

function fSetSecType(id, t) {
  fTrackEdit();
  const s = fSegs.find(s => s.id === id);
  if (!s) return;
  s.secType = t;
  if (t === 'composite') {
    if (!s.layers || !s.layers.length) {
      const E0 = s.E || 200e9;  // E already in Pa
      s.layers = [{ type:'rect', b:0.05, h:0.10, d:0.05,
                    bf:0.10, tf:0.01, hw:0.10, tw:0.008,
                    x_center:0, y_center:0.05, E:E0, id:Math.random() }];
    }
  }
  fRenderSegs();
}

// Compute I (moment of inertia) in m⁴ for a segment
// ── COMPOSITE SECTION HELPERS ─────────────────────────────────
// Each layer: { type, dims..., x_center, y_center, E }
// x_center/y_center = geometric center of the shape in user coords
// Uses transformed section method (method n): n_i = E_i / E_ref

function fInitComposite(s) {
  if (!s.layers) s.layers = [];
}

// Auto-arrange: stack layers vertically touching, all centered at x=0
function fCompositeAutoArrange(s) {
  const layers = s.layers || [];
  if (!layers.length) return;
  let y = 0;
  layers.forEach(l => {
    const dims = fLayerDims(l);
    l.x_center = 0;
    l.y_center = y + dims.h / 2;
    y += dims.h;
  });
}

// Bounding box of the composite section in user coords
function fCompositeBounds(layers) {
  if (!layers || !layers.length) return { xMin:-0.05, xMax:0.05, yMin:0, yMax:0.10 };
  let xMin=Infinity, xMax=-Infinity, yMin=Infinity, yMax=-Infinity;
  layers.forEach(l => {
    const dims = fLayerDims(l);
    const xc = l.x_center||0, yc = l.y_center||0;
    xMin = Math.min(xMin, xc - dims.w/2);
    xMax = Math.max(xMax, xc + dims.w/2);
    yMin = Math.min(yMin, yc - dims.h/2);
    yMax = Math.max(yMax, yc + dims.h/2);
  });
  return { xMin, xMax, yMin, yMax };
}

// ── SHEAR HELPERS FOR COMPOSITE ──────────────────────────────

// Effective width b of layer at global height y_global (user coords)
function fLayerWidthAt(lay, y_global) {
  const dims = fLayerDims(lay);
  const yc = lay.y_center || 0;
  if (lay.type === 'rect') return dims.w;
  if (lay.type === 'circ') {
    const r = dims.w / 2, dy = y_global - yc;
    return 2 * Math.sqrt(Math.max(0, r*r - dy*dy));
  }
  const y_loc = y_global - (yc - dims.h/2);   // y from bottom of this layer
  if (lay.type === 'Isym') {
    const tf = lay.tf||0.01, hw = lay.hw||0.10;
    return (y_loc <= tf || y_loc >= tf+hw) ? (lay.bf||0.10) : (lay.tw||0.008);
  }
  if (lay.type === 'Tsec') return y_loc >= (lay.hw||0.10) ? (lay.bf||0.10) : (lay.tw||0.008);
  if (lay.type === 'Tinv') return y_loc <= (lay.tf||0.01) ? (lay.bf||0.10) : (lay.tw||0.008);
  return dims.w;
}

// n · Q*(y_global): transformed first moment of the portion of `lay` ABOVE y_global
// (contribution to Q* for the full composite section at a cut at y_global)
function fLayerQAbove(lay, y_global, yc_global, n) {
  const dims  = fLayerDims(lay);
  const yc_lay = lay.y_center || 0;
  const y_bot  = yc_lay - dims.h / 2;
  const y_top  = yc_lay + dims.h / 2;
  if (y_global >= y_top - 1e-12) return 0;           // layer entirely below cut
  if (y_global <= y_bot + 1e-12)                      // layer entirely above cut
    return n * dims.A * (yc_lay - yc_global);

  // Partial layer
  const y_loc = y_global - y_bot;                     // local y from layer bottom

  if (lay.type === 'rect') {
    const h_ab = y_top - y_global;
    return n * (dims.w * h_ab) * (y_global + h_ab/2 - yc_global);
  }

  if (lay.type === 'circ') {
    const r = dims.w / 2;
    const t  = (y_global - yc_lay) / r;               // −1 to 1
    const sq = Math.sqrt(Math.max(0, 1 - t*t));
    const A_ab = r*r * (Math.PI/2 - t*sq - Math.asin(t));
    if (A_ab < 1e-15) return 0;
    const yc_ab = yc_lay + 2*r**3 * (1 - t*t)**1.5 / (3 * A_ab);
    return n * A_ab * (yc_ab - yc_global);
  }

  // Isym / Tsec / Tinv — sum rectangular sub-pieces above cut
  const pieces = lay.type === 'Isym' ? [
    { y0: 0,                    y1: lay.tf||0.01,                          b: lay.bf||0.10  },
    { y0: lay.tf||0.01,         y1: (lay.tf||0.01)+(lay.hw||0.10),         b: lay.tw||0.008 },
    { y0: (lay.tf||0.01)+(lay.hw||0.10), y1: dims.h,                      b: lay.bf||0.10  }
  ] : lay.type === 'Tsec' ? [
    { y0: 0,                    y1: lay.hw||0.10,                          b: lay.tw||0.008 },
    { y0: lay.hw||0.10,         y1: dims.h,                                b: lay.bf||0.10  }
  ] : /* Tinv */ [
    { y0: 0,                    y1: lay.tf||0.01,                          b: lay.bf||0.10  },
    { y0: lay.tf||0.01,         y1: dims.h,                                b: lay.tw||0.008 }
  ];

  let Q = 0;
  pieces.forEach(p => {
    const lo = Math.max(p.y0, y_loc), hi = p.y1;
    if (lo >= hi) return;
    const yc_piece = y_bot + (lo + hi) / 2;
    Q += n * (p.b * (hi - lo)) * (yc_piece - yc_global);
  });
  return Q;
}

// Numerical scan of τ(y) for simple (non-composite) sections.
// Returns { y_arr, QoB_arr, QoB_max, I }  (same shape as fCompositeShearScan)
// τ(y) = |V| · Q(y) / (I · b(y));  τ_max = |V| · QoB_max / I
function fSimpleShearScan(seg) {
  const type  = seg.secType;
  const props = fSecProps(seg);
  const I     = props.Ix;
  const yc    = props.yc;
  if (!I || !['rect','circ','rectH','circH','Isym','Tsec','Tinv'].includes(type))
    return { y_arr:[], QoB_arr:[], QoB_max:0, I: I || 1 };

  let H;
  if      (type === 'rect')                   H = seg.h || 0.10;
  else if (type === 'circ')                   H = seg.d || 0.05;
  else if (type === 'rectH')                  H = seg.h || 0.20;
  else if (type === 'circH')                  H = seg.d || 0.10;
  else if (type === 'Isym')                   H = 2*(seg.tf||0.01) + (seg.hw||0.10);
  else /* Tsec | Tinv */                      H = (seg.tf||0.01) + (seg.hw||0.10);

  // First moment of a rectangular strip [y0,y1] × width bw above cut y, about yc
  const stripQ = (y, y0, y1, bw) => {
    const lo = Math.max(y, y0), hi = y1;
    if (lo >= hi - 1e-12) return 0;
    return bw * (hi - lo) * ((lo + hi) / 2 - yc);
  };

  const N = 300;
  const y_arr = [], QoB_arr = [];
  let QoB_max = 0;

  for (let i = 0; i <= N; i++) {
    const y = (i / N) * H;
    let Q = 0, b = 0;

    if (type === 'rect') {
      const bw = seg.b || 0.05;
      Q = stripQ(y, 0, H, bw);
      b = bw;

    } else if (type === 'circ') {
      const r    = H / 2;
      const u_sq = Math.max(0, r*r - (y - r)**2);
      Q = 2/3 * u_sq**1.5;
      b = 2 * Math.sqrt(u_sq);

    } else if (type === 'rectH') {
      const bw = seg.b || 0.10, hw = seg.h || 0.20;
      const t  = Math.min(Math.max(seg.t || 0.01, 1e-4), Math.min(bw,hw)/2 - 1e-4);
      const bi = bw - 2*t,  hi = hw - 2*t;
      // Q = outer rect contribution − inner void contribution
      Q = stripQ(y, 0, hw, bw) - (bi > 0 && hi > 0 ? stripQ(y, t, hw - t, bi) : 0);
      // b at cut: full width in flange zones, 2 webs in the void zone
      b = (bi > 0 && hi > 0 && y > t + 1e-9 && y < hw - t - 1e-9) ? 2*t : bw;

    } else if (type === 'circH') {
      const ro   = H / 2;
      const t    = Math.min(Math.max(seg.t || 0.005, 1e-4), ro - 1e-4);
      const ri   = ro - t;
      const uq_o = Math.max(0, ro*ro - (y - ro)**2);
      const uq_i = ri > 0 ? Math.max(0, ri*ri - (y - ro)**2) : 0;
      Q = 2/3 * uq_o**1.5 - (ri > 0 ? 2/3 * uq_i**1.5 : 0);
      b = 2*Math.sqrt(uq_o) - (ri > 0 && uq_i > 0 ? 2*Math.sqrt(uq_i) : 0);

    } else if (type === 'Isym') {
      const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
      Q = stripQ(y, 0, tf, bf) + stripQ(y, tf, tf+hw, tw) + stripQ(y, tf+hw, H, bf);
      b = (y <= tf || y >= tf+hw) ? bf : tw;

    } else if (type === 'Tsec') {
      const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
      Q = stripQ(y, 0, hw, tw) + stripQ(y, hw, H, bf);
      b = y >= hw ? bf : tw;

    } else { // Tinv
      const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
      Q = stripQ(y, 0, tf, bf) + stripQ(y, tf, H, tw);
      b = y <= tf ? bf : tw;
    }

    y_arr.push(y);
    if (b > 1e-10) {
      const QoB = Math.abs(Q) / b;
      QoB_arr.push(QoB);
      if (QoB > QoB_max) QoB_max = QoB;
    } else {
      QoB_arr.push(0);
    }
  }

  return { y_arr, QoB_arr, QoB_max, I };
}

// Numerical scan of τ(y) for composite sections.
// Returns { y_arr, QoB_arr, QoB_max, I_tr }
// τ(y) = |V| · Q*(y) / (I_tr · b(y));  τ_max = |V| · QoB_max / I_tr
function fCompositeShearScan(s) {
  const cp = fCompositeSecProps(s);
  const layers = s.layers || [];
  if (!cp || !cp.Ix || !layers.length)
    return { y_arr:[], QoB_arr:[], QoB_max:0, I_tr:1 };

  const { Ix: I_tr, yc_global, E_ref } = cp;
  const { yMin, yMax } = fCompositeBounds(layers);
  const ns = layers.map(l => (l.E||1) / (E_ref||1));
  const N = 300;

  const y_arr = [], QoB_arr = [];
  let QoB_max = 0;

  for (let i = 0; i <= N; i++) {
    const y = yMin + (i / N) * (yMax - yMin);

    let Q_star = 0;
    layers.forEach((lay, li) => { Q_star += fLayerQAbove(lay, y, yc_global, ns[li]); });

    let b_y = 0;
    layers.forEach(lay => {
      const dims  = fLayerDims(lay);
      const yc_l  = lay.y_center || 0;
      const y_b   = yc_l - dims.h/2, y_t = yc_l + dims.h/2;
      if (y > y_b + 1e-9 && y < y_t - 1e-9) b_y += fLayerWidthAt(lay, y);
    });

    y_arr.push(y);
    if (b_y > 1e-10) {
      const QoB = Math.abs(Q_star) / b_y;
      QoB_arr.push(QoB);
      if (QoB > QoB_max) QoB_max = QoB;
    } else {
      QoB_arr.push(0);
    }
  }
  return { y_arr, QoB_arr, QoB_max, I_tr };
}

// ── LAYER GEOMETRY HELPER ─────────────────────────────────────
// Returns { w, h, A, yc_local, Ix_own, Iy_own }
// w/h = bounding width/height; yc_local = centroid from layer bottom
function fLayerDims(lay) {
  if (lay.type === 'rect') {
    const b = lay.b||0.05, h = lay.h||0.10;
    return { w: b, h, A: b*h, yc_local: h/2,
             Ix_own: b*h**3/12, Iy_own: h*b**3/12 };
  }
  if (lay.type === 'circ') {
    const r = (lay.d||0.05)/2;
    return { w: lay.d||0.05, h: lay.d||0.05, A: Math.PI*r**2, yc_local: r,
             Ix_own: Math.PI*r**4/4, Iy_own: Math.PI*r**4/4 };
  }
  if (lay.type === 'Isym') {
    const bf=lay.bf||0.10, tf=lay.tf||0.01, hw=lay.hw||0.10, tw=lay.tw||0.008;
    const H=2*tf+hw, A_fl=bf*tf, A_web=hw*tw, A=2*A_fl+A_web;
    const d_fl=hw/2+tf/2;
    return { w: bf, h: H, A, yc_local: H/2,
             Ix_own: 2*(bf*tf**3/12+A_fl*d_fl**2)+tw*hw**3/12,
             Iy_own: 2*(tf*bf**3/12)+hw*tw**3/12 };
  }
  if (lay.type === 'Tsec') {
    const bf=lay.bf||0.10, tf=lay.tf||0.01, hw=lay.hw||0.10, tw=lay.tw||0.008;
    const H=tf+hw, A_fl=bf*tf, A_web=hw*tw, A=A_fl+A_web;
    const yc_local=(A_web*(hw/2)+A_fl*(hw+tf/2))/A;
    const d_web=yc_local-hw/2, d_fl=(hw+tf/2)-yc_local;
    return { w: bf, h: H, A, yc_local,
             Ix_own: tw*hw**3/12+A_web*d_web**2+bf*tf**3/12+A_fl*d_fl**2,
             Iy_own: tf*bf**3/12+hw*tw**3/12 };
  }
  if (lay.type === 'Tinv') {
    const bf=lay.bf||0.10, tf=lay.tf||0.01, hw=lay.hw||0.10, tw=lay.tw||0.008;
    const H=tf+hw, A_fl=bf*tf, A_web=hw*tw, A=A_fl+A_web;
    const yc_local=(A_fl*(tf/2)+A_web*(tf+hw/2))/A;
    const d_fl=yc_local-tf/2, d_web=(tf+hw/2)-yc_local;
    return { w: bf, h: H, A, yc_local,
             Ix_own: bf*tf**3/12+A_fl*d_fl**2+tw*hw**3/12+A_web*d_web**2,
             Iy_own: tf*bf**3/12+hw*tw**3/12 };
  }
  return { w: 0.05, h: 0.10, A: 0, yc_local: 0.05, Ix_own: 0, Iy_own: 0 };
}

function fAddCompositeLayer(s, type = 'rect') {
  fInitComposite(s);
  const E_default = 200e9;  // Pa
  // Default center: stack above the last layer
  let y_center = 0.05;
  if (s.layers.length) {
    const last = s.layers[s.layers.length - 1];
    const lastDims = fLayerDims(last);
    y_center = (last.y_center||0) + lastDims.h/2 + fLayerDims({type,b:0.05,h:0.10,d:0.05,bf:0.10,tf:0.01,hw:0.10,tw:0.008}).h/2;
  }
  s.layers.push({
    type,
    b:0.05, h:0.10, d:0.05,
    bf:0.10, tf:0.01, hw:0.10, tw:0.008,
    x_center: 0, y_center,
    E: E_default,
    id: Math.random()
  });
}

function fDelCompositeLayer(s, layerId) {
  fInitComposite(s);
  const i = s.layers.findIndex(l => l.id === layerId);
  if (i >= 0) s.layers.splice(i, 1);
}

function fSetCompositeLayerField(segId, layerId, field, val) {
  const s = fSegs.find(x => x.id === segId);
  if (!s) return;
  const layer = (s.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  const v = typeof val === 'string' ? parseSci(val) || +val : val;
  layer[field] = isNaN(v) ? val : v;
}

function fCompositeAutoArrangeAndRender(segId) {
  const s = fSegs.find(x => x.id === segId);
  if (s) { fCompositeAutoArrange(s); fRenderSegs(); }
}

function fCompositeSecProps(s) {
  fInitComposite(s);
  const layers = s.layers || [];
  if (!layers.length) {
    return { Ix:0, Iy:0, A:0, yc:0, yc_global:0, layers_contribution:[], E_ref:1, H_tot:0, y_min:0 };
  }

  const E_ref = layers[0].E || 1;

  // Step 1: section bounds from layer centers + half-heights
  const bounds = fCompositeBounds(layers);
  const y_min  = bounds.yMin;
  const H_tot  = bounds.yMax - bounds.yMin;

  // Step 2: centroid of transformed section (in global user coords)
  let A_tr = 0, Q_tr = 0;
  const layer_data = [];

  layers.forEach(l => {
    const n    = (l.E || 1) / E_ref;
    const dims = fLayerDims(l);
    const A_l  = dims.A;
    // y_center is the centroid of the layer in global coords
    const yc_l = l.y_center || 0;
    const A_l_tr = A_l * n;
    A_tr += A_l_tr;
    Q_tr += A_l_tr * yc_l;
    layer_data.push({ A_l, yc_l, A_l_tr, n, dims });
  });

  const yc_global = A_tr > 0 ? Q_tr / A_tr : 0;

  // Step 3: Ix/Iy about centroid (parallel-axis theorem)
  let Ix_tr = 0, Iy_tr = 0;
  layer_data.forEach(({ yc_l, A_l_tr, n, dims }) => {
    const d = yc_l - yc_global;
    Ix_tr += n * dims.Ix_own + A_l_tr * d**2;
    Iy_tr += n * dims.Iy_own;
  });

  // yc returned = distance from bottom fiber (y_min) to centroid
  // — keeps compatibility with drawing code that assumes yc is from bottom
  return {
    Ix: Ix_tr, Iy: Iy_tr, A: A_tr,
    yc: yc_global - y_min,   // from bottom fiber (for stress diagrams)
    yc_global,                // in user coords (for overlap/stress per layer)
    layers_contribution: layer_data,
    E_ref, H_tot, y_min
  };
}

function fCompositeMaxStress(s, M_val) {
  // Calculate max stress in a composite section under bending moment M_val
  // Uses transformed section method: σ_i = n * M * y_i / I_transformed
  // where n_i = E_i / E_ref
  
  const props = fCompositeSecProps(s);
  if (!props.E_ref || !props.layers_contribution || !props.layers_contribution.length) return 0;
  
  const M = Math.abs(M_val);
  const I_tr = props.Ix;
  if (I_tr <= 0) return 0;
  
  const layers = s.layers || [];
  let sigmaMax = 0;
  
  layers.forEach((lay, i) => {
    const { A_l, n } = props.layers_contribution[i];
    if (A_l <= 0) return;
    const dims = fLayerDims(lay);
    const yc = lay.y_center || 0;
    // extreme fibers in global coords; stress uses distance from global centroid
    [yc - dims.h/2, yc + dims.h/2].forEach(y => {
      const sigma = n * M * Math.abs(y - props.yc_global) / I_tr;
      sigmaMax = Math.max(sigmaMax, sigma);
    });
  });
  
  return sigmaMax;
}

// ── SECTION PROPERTIES ────────────────────────────────────────
// Returns { Ix, Iy, A, yc } all in SI (m⁴, m²,  m)
// yc = distance from BOTTOM fiber to centroid (for c = max(yc, h-yc))
// Sections:
//   rect : b × h
//   circ : diameter d
//   Isym : symmetric I — bf (flange width), tf (flange thickness), hw (web height), tw (web thickness)
//          total height H = 2*tf + hw
//   Tsec : T-section — flange on top — bf, tf, hw, tw
//          yc measured from bottom of web
//   Tinv : T inverted — flange on bottom — same params, yc from bottom of flange
//   composite : layered section with method n

function fSecProps(s) {
  // Cache per-solve to avoid recomputing fCompositeShearScan (301 iters) for every element
  if (_fSecCache) {
    const cached = _fSecCache.get(s.id);
    if (cached) return cached;
    const result = _fSecPropsCompute(s);
    _fSecCache.set(s.id, result);
    return result;
  }
  return _fSecPropsCompute(s);
}

function _fSecPropsCompute(s) {
  const type = s.secType || 'rect';

  if (type === 'circ') {
    const r = (s.d || 0.05) / 2;
    const I = Math.PI / 4 * r**4;
    return { Ix: I, Iy: I, A: Math.PI * r**2, yc: r,
             // Para esfuerzo cortante τ = VQ/Ib
             // Para círculo macizo, τ_max = 4V/3A en el eje neutro
             // Q_max = 2r³/3, b = 2r
             Qmax: 2 * r**3 / 3,
             b_for_tau_max: 2 * r
           };
  }

  if (type === 'rect') {
    const b = s.b || 0.05, h = s.h || 0.10;
    return {
      Ix: b * h**3 / 12,
      Iy: h * b**3 / 12,
      A:  b * h,
      yc: h / 2,
      Qmax: b * h**2 / 8,
      b_for_tau_max: b
    };
  }

  if (type === 'rectH') {
    const B = s.b || 0.10,  H = s.h || 0.20;
    const t = Math.min(Math.max(s.t || 0.01, 1e-4), Math.min(B, H) / 2 - 1e-4);
    const bi = B - 2*t,  hi = H - 2*t;
    const Ix = B*H**3/12 - bi*hi**3/12;
    const Iy = H*B**3/12 - hi*bi**3/12;
    const A  = B*H - bi*hi;
    return { Ix, Iy, A, yc: H/2,
             Qmax: B*H**2/8 - bi*hi**2/8,
             b_for_tau_max: 2*t };
  }

  if (type === 'circH') {
    const Ro = (s.d || 0.10) / 2;
    const t  = Math.min(Math.max(s.t || 0.005, 1e-4), Ro - 1e-4);
    const Ri = Ro - t;
    const Ix = Math.PI / 4 * (Ro**4 - Ri**4);
    const A  = Math.PI * (Ro**2 - Ri**2);
    return { Ix, Iy: Ix, A, yc: Ro,
             Qmax: 2/3 * (Ro**3 - Ri**3),
             b_for_tau_max: 2*t };
  }

  if (type === 'Isym') {
    const bf = s.bf || 0.10,  tf = s.tf || 0.01;
    const hw = s.hw || 0.10,  tw = s.tw || 0.008;
    const H  = 2 * tf + hw;
    const A_fl = bf * tf;          // one flange area
    const A_web = hw * tw;
    const A = 2 * A_fl + A_web;
    // Centroid at H/2 by symmetry
    const yc = H / 2;
    // Ix: parallel axis theorem
    const d_fl = hw/2 + tf/2;     // distance flange centroid to neutral axis
    const Ix_fl = bf * tf**3 / 12 + A_fl * d_fl**2;
    const Ix_web = tw * hw**3 / 12;
    const Ix = 2 * Ix_fl + Ix_web;
    // Iy: flanges dominate
    const Iy_fl = tf * bf**3 / 12;
    const Iy_web = hw * tw**3 / 12;
    const Iy = 2 * Iy_fl + Iy_web;
    // Q_max en el eje neutro: ala + semialma (tw·hw²/8 = tw·(hw/2)·(hw/4))
    const Qmax = A_fl * d_fl + tw * hw**2 / 8;
    return { Ix, Iy, A, yc, Qmax, b_for_tau_max: tw };
  }

  if (type === 'Tsec' || type === 'Tinv') {
    const bf = s.bf || 0.10,  tf = s.tf || 0.01;
    const hw = s.hw || 0.10,  tw = s.tw || 0.008;
    const H  = tf + hw;
    const A_fl  = bf * tf;
    const A_web = hw * tw;
    const A     = A_fl + A_web;

    let yc, Qmax, b_for_tau_max; // yc desde la fibra inferior
    if (type === 'Tsec') {
      // Flange on TOP: web bottom = 0, flange top = H
      // y_web_centroid from bottom = hw/2
      // y_fl_centroid from bottom  = hw + tf/2
      yc = (A_web * (hw/2) + A_fl * (hw + tf/2)) / A;
      b_for_tau_max = (yc <= hw) ? tw : bf; // Ancho en el eje neutro
      // Q en el EN calculado desde el lado más pequeño:
      //   EN en el alma (caso típico yc≤hw): Q = tw·yc²/2  (solo el alma bajo el EN)
      //   EN en el ala  (caso raro  yc>hw):  Q = bf·(H−yc)²/2
      Qmax = (yc <= hw) ? tw * yc**2 / 2 : bf * (H - yc)**2 / 2;
    } else {
      // Flange on BOTTOM (Tinv): flange bottom = 0, web top = H
      // y_fl_centroid from bottom = tf/2
      // y_web_centroid from bottom = tf + hw/2
      yc = (A_fl * (tf/2) + A_web * (tf + hw/2)) / A;
      b_for_tau_max = (yc >= tf) ? tw : bf; // Ancho en el eje neutro
      // Q en el EN calculado desde el lado más pequeño:
      //   EN en el alma (caso típico yc≥tf): Q = tw·(H−yc)²/2  (solo el alma sobre el EN)
      //   EN en el ala  (caso raro  yc<tf):  Q = bf·yc²/2
      Qmax = (yc >= tf) ? tw * (H - yc)**2 / 2 : bf * yc**2 / 2;
    }

    // Ix via parallel-axis
    let Ix;
    if (type === 'Tsec') {
      const d_web = yc - hw/2;
      const d_fl  = (hw + tf/2) - yc;
      Ix = tw * hw**3 / 12 + A_web * d_web**2
         + bf * tf**3 / 12 + A_fl  * d_fl**2;
    } else {
      const d_fl  = yc - tf/2;
      const d_web = (tf + hw/2) - yc;
      Ix = bf * tf**3 / 12 + A_fl  * d_fl**2
         + tw * hw**3 / 12 + A_web * d_web**2;
    }

    // Iy (about own vertical centroid — both pieces share same centroid x)
    const Iy_fl  = tf * bf**3 / 12;
    const Iy_web = hw * tw**3 / 12;
    const Iy = Iy_fl + Iy_web;

    return { Ix, Iy, A, yc, Qmax, b_for_tau_max };
  }

  if (type === 'composite') {
    const props = fCompositeSecProps(s);
    const scan  = fCompositeShearScan(s);
    // τ_max = V · QoB_max / I_tr  →  equiv. Qmax = QoB_max, b_for_tau_max = 1
    return { ...props, Qmax: scan.QoB_max, b_for_tau_max: 1 };
  }

  // fallback rect
  const b = s.b || 0.05, h = s.h || 0.10;
  return { Ix: b*h**3/12, Iy: h*b**3/12, A: b*h, yc: h/2, Qmax: b*h**2/8, b_for_tau_max: b };
}

function fGetI(s) { return fSecProps(s).Ix; }

function fGetEI2(s) { return s.E * fSecProps(s).Ix; }  // s.E is in Pa


function fGetEI_at(x) {
  const s = fSegs.find(s => x >= s.xa - 1e-9 && x <= s.xb + 1e-9) || fSegs[fSegs.length-1];
  return fGetEI2(s);
}

function fGetEA_at(x) {
  const s = fSegs.find(s => x >= s.xa - 1e-9 && x <= s.xb + 1e-9) || fSegs[fSegs.length-1];
  return s.E * fSecProps(s).A;
}

// Returns axial force N (SI, N) at position x from last solve
function fGetN_at(x) {
  if (!fLastSolveData || !fLastSolveData.N_elem_arr) return 0;
  const { N_elem_arr, le, nEl } = fLastSolveData;
  const e = Math.min(Math.max(Math.floor(x / le), 0), nEl - 1);
  return N_elem_arr[e] || 0;
}

// ── FUERZA RASANTE HELPERS ────────────────────────────────────
// Returns { Q, b_cut } for a cut at y_cut (from bottom of section, m).
// Q = first moment of area ABOVE the cut about the section centroid axis (m³).
// For composite sections uses the transformed section (Q*).
function fGetQcut(seg, y_cut) {
  if (y_cut == null) return { Q: 0, b_cut: 0 };
  const props = fSecProps(seg);
  const type  = seg.secType;
  const yc    = props.yc;
  const I     = props.Ix;

  // ── Composite sections ─────────────────────────────────────
  if (type === 'composite') {
    const cp     = fCompositeSecProps(seg);
    const layers = seg.layers || [];
    const bounds = fCompositeBounds(layers);
    const H      = bounds.yMax - bounds.yMin;
    const y_g    = bounds.yMin + y_cut;   // cut in global composite coords
    if (y_cut < 0 || y_cut > H) return { Q: 0, b_cut: 0 };
    const Q = layers.reduce((sum, lay, li) => {
      const n = cp.layers_contribution[li].n;
      return sum + fLayerQAbove(lay, y_g, cp.yc_global, n);
    }, 0);
    const b_cut = layers.reduce((s, lay) => s + fLayerWidthAt(lay, y_g), 0);
    return { Q: Math.abs(Q), b_cut, I: cp.Ix, yc: cp.yc_global - bounds.yMin };
  }

  // ── Simple sections — analytic or piecewise ────────────────
  let H, localB;
  if (type === 'rect' || type === 'rectH') {
    H = seg.h || 0.10;
    if (type === 'rect') {
      const bw = seg.b || 0.05;
      localB = () => bw;
    } else {
      const bo = seg.b || 0.05, bi = seg.bi || 0.03, hi = seg.hi || 0.06;
      const yi0 = (H - hi) / 2, yi1 = yi0 + hi;
      localB = y => (y >= yi0 - 1e-9 && y <= yi1 + 1e-9) ? (bo - bi) : bo;
    }
  } else if (type === 'circ' || type === 'circH') {
    H = seg.d || 0.05;
    const r = H / 2;
    if (type === 'circ') {
      localB = y => 2 * Math.sqrt(Math.max(0, r*r - (y - r)**2));
    } else {
      const ri = (seg.di || 0) / 2;
      localB = y => {
        const dy = y - r;
        return 2 * (Math.sqrt(Math.max(0, r*r - dy*dy)) - Math.sqrt(Math.max(0, ri*ri - dy*dy)));
      };
    }
  } else if (type === 'Isym') {
    const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
    H = 2*tf + hw;
    localB = y => (y < tf || y > tf + hw) ? bf : tw;
  } else if (type === 'Tsec') {
    const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
    H = tf + hw;
    localB = y => (y > hw) ? bf : tw;
  } else if (type === 'Tinv') {
    const tf = seg.tf||0.01, hw = seg.hw||0.10, bf = seg.bf||0.10, tw = seg.tw||0.008;
    H = tf + hw;
    localB = y => (y < tf) ? bf : tw;
  } else {
    return { Q: 0, b_cut: 0 };
  }

  if (y_cut < 0 || y_cut > H) return { Q: 0, b_cut: 0 };

  // Numerical integration: Q = ∫_{y_cut}^{H} (y−yc)·b(y) dy  (500 strips)
  const N  = 500;
  const dy = H / N;
  let Q = 0;
  for (let i = 0; i < N; i++) {
    const ym = (i + 0.5) * dy;
    if (ym < y_cut) continue;
    Q += localB(ym) * (ym - yc) * dy;
  }
  const b_cut = localB(y_cut);
  return { Q: Math.abs(Q), b_cut, I, yc };
}

// ── RASANTE UI ────────────────────────────────────────────────
function fUpdateRasante() {
  const ycutEl    = document.getElementById('fRasYcutInp');
  const spacingEl = document.getElementById('fRasSpacingInp');
  if (!ycutEl) return;

  // Refresh unit labels
  document.querySelectorAll('.fRasUnitLbl').forEach(el => el.textContent = fUnitLen);

  const ycut_disp    = parseFloat(ycutEl.value);
  const spacing_disp = parseFloat(spacingEl?.value) || 0;
  fRasYcut    = isNaN(ycut_disp) ? null : fLenToSI(ycut_disp);
  fRasSpacing = fLenToSI(spacing_disp);

  fComputeRasante();
}

function fComputeRasante() {
  const card = document.getElementById('fRasCard');
  if (!card || !fLastSolveData) return;
  if (fRasYcut === null) { return; }

  const { V_right, V_left, le, nEl } = fLastSolveData;
  if (!V_right || !V_left) return;

  const q_elem = new Float64Array(nEl);
  for (let e = 0; e < nEl; e++) {
    const xm  = (e + 0.5) * le;
    const seg  = fSegs.find(s => xm >= s.xa - 1e-9 && xm <= s.xb + 1e-9) || fSegs[fSegs.length-1];
    const { Q, I } = fGetQcut(seg, fRasYcut);
    const V_abs = Math.max(Math.abs(V_right[e]), Math.abs(V_left[e+1]));
    q_elem[e] = (I > 0 && Q > 0) ? V_abs * Q / I : 0;
  }

  const q_max = Math.max(...q_elem);
  const qLabel = fForceLabel() + '/m';
  document.getElementById('fUlRas').textContent = qLabel;

  // Info row
  const infoEl = document.getElementById('fRasInfo');
  if (infoEl) {
    let html = `<span style="color:var(--teal)">q<sub>máx</sub></span> = ${fForceFromSI(q_max).toFixed(3)} ${qLabel}`;
    if (fRasSpacing > 0 && q_max > 0) {
      const F_max = q_max * fRasSpacing;
      html += ` &nbsp;·&nbsp; <span style="color:var(--acc)">F/conector</span> = ${fForceFromSI(F_max).toFixed(3)} ${fForceLabel()} &nbsp;<span style="color:var(--txt3);font-size:9px">(a=${fLenFmt(fRasSpacing)} ${fUnitLen})</span>`;
    }
    infoEl.innerHTML = html;
  }

  const xs_e   = Array.from({length: nEl}, (_, i) => ((i + 0.5) * le).toFixed(5));
  const disp_q = Array.from(q_elem).map(v => fForceFromSI(v));
  const decQ   = fForceFromSI(q_max) < 0.01 ? 6 : fForceFromSI(q_max) < 1 ? 4 : 3;
  fMkChart('fcRas', xs_e, disp_q, '#50d4b8', qLabel, true, decQ, false, 0, true);
}

// Total section height (m) at position x — needed for thermal curvature κ_T = α·ΔT/h
function fGetH_at(x) {
  const s = fSegs.find(s => x >= s.xa - 1e-9 && x <= s.xb + 1e-9) || fSegs[fSegs.length-1];
  if (s.secType === 'circ')                         return s.d  || 0.05;
  if (s.secType === 'rect')                         return s.h  || 0.10;
  if (s.secType === 'rectH')                        return s.h  || 0.20;
  if (s.secType === 'circH')                        return s.d  || 0.10;
  if (s.secType === 'Isym')                         return 2*(s.tf||0.01) + (s.hw||0.10);
  if (s.secType === 'Tsec' || s.secType === 'Tinv') return (s.tf||0.01) + (s.hw||0.10);
  if (s.secType === 'composite') {
    const bounds = fCompositeBounds(s.layers || []);
    return (bounds.yMax - bounds.yMin) || 0.10;
  }
  return s.h || 0.10;
}

function fRenderSegs() {
  const cont = document.getElementById('fCSeg');
  if (!cont) return;

  const segsHTML = fSegs.map((s, i) => {
    const isFirst = i === 0, isLast = i === fSegs.length - 1;

    // ── Section type buttons ───────────────────────────────────
    const secTypes = [
      {id:'rect',      label:'Rect.'},
      {id:'rectH',     label:'□ H'},
      {id:'circ',      label:'Circ.'},
      {id:'circH',     label:'○ H'},
      {id:'Isym',      label:'I'},
      {id:'Tsec',      label:'T↑'},
      {id:'Tinv',      label:'T↓'},
      {id:'composite', label:'Comp.'},
    ];
    const secTypeRow = `<div class="sec-type-row">` +
      secTypes.map(t => `<button class="sec-type-btn ${s.secType===t.id?'on':''}" onclick="fSetSecType(${s.id},'${t.id}')">${t.label}</button>`).join('') +
      `</div>`;

    // ── Dimension fields by section type ──────────────────────
    let dimRow = '';
    if (s.secType === 'circ') {
      dimRow = `<div class="r1"><div class="f"><label>Diámetro d (${fUnitLen})</label>
        <input type="number" value="${fLenFmt(s.d||0.05)}" step="${fLenStep()}" min="${fLenMin()}"
          onchange="fSetSegDim(${s.id},'d',this.value);fRenderSegs()">
      </div></div>`;

    } else if (s.secType === 'rectH') {
      dimRow = `
      <div class="r2">
        <div class="f"><label>B — ancho ext. (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.b||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'b',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>H — alto ext. (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.h||0.20)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'h',this.value);fRenderSegs()">
        </div>
      </div>
      <div class="r1">
        <div class="f"><label>t — espesor pared (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.t||0.01)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'t',this.value);fRenderSegs()">
        </div>
      </div>`;

    } else if (s.secType === 'circH') {
      dimRow = `
      <div class="r2">
        <div class="f"><label>D — diámetro ext. (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.d||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'d',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>t — espesor pared (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.t||0.005)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'t',this.value);fRenderSegs()">
        </div>
      </div>`;

    } else if (s.secType === 'Isym') {
      dimRow = `
      <div class="r2">
        <div class="f"><label>b_f — ancho ala (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.bf||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'bf',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>t_f — esp. ala (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.tf||0.01)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'tf',this.value);fRenderSegs()">
        </div>
      </div>
      <div class="r2">
        <div class="f"><label>h_w — altura alma (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.hw||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'hw',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>t_w — esp. alma (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.tw||0.008)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'tw',this.value);fRenderSegs()">
        </div>
      </div>`;

    } else if (s.secType === 'Tsec' || s.secType === 'Tinv') {
      const orient = s.secType === 'Tsec' ? 'ala arriba ↑' : 'ala abajo ↓';
      dimRow = `
      <p class="subhint" style="margin-bottom:4px">${orient}</p>
      <div class="r2">
        <div class="f"><label>b_f — ancho ala (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.bf||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'bf',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>t_f — esp. ala (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.tf||0.01)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'tf',this.value);fRenderSegs()">
        </div>
      </div>
      <div class="r2">
        <div class="f"><label>h_w — altura alma (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.hw||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'hw',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>t_w — esp. alma (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.tw||0.008)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'tw',this.value);fRenderSegs()">
        </div>
      </div>`;

    } else if (s.secType === 'composite') {
      fInitComposite(s);
      const E_ref = (s.layers[0] || {}).E || 1;

      // ── Overlap warning (bounding-box check) ─────────────────
      let warnHTML = '';
      if (s.layers.length > 1) {
        const msgs = [];
        for (let ai = 0; ai < s.layers.length; ai++) {
          for (let bi2 = ai+1; bi2 < s.layers.length; bi2++) {
            const la = s.layers[ai], lb = s.layers[bi2];
            const da = fLayerDims(la), db = fLayerDims(lb);
            const axMin=( la.x_center||0)-da.w/2, axMax=(la.x_center||0)+da.w/2;
            const ayMin=(la.y_center||0)-da.h/2,  ayMax=(la.y_center||0)+da.h/2;
            const bxMin=(lb.x_center||0)-db.w/2,  bxMax=(lb.x_center||0)+db.w/2;
            const byMin=(lb.y_center||0)-db.h/2,  byMax=(lb.y_center||0)+db.h/2;
            const overlapX = axMin < bxMax-1e-4 && bxMin < axMax-1e-4;
            const overlapY = ayMin < byMax-1e-4 && byMin < ayMax-1e-4;
            if (overlapX && overlapY) msgs.push(`Solapamiento capas ${ai+1}–${bi2+1}`);
          }
        }
        if (msgs.length) warnHTML = `<div style="margin-bottom:8px;padding:6px 8px;background:rgba(240,112,112,0.08);border:1px solid rgba(240,112,112,0.3);border-radius:6px;font-family:var(--mono);font-size:9px;color:#f07070">⚠ ${msgs.join(' · ')}</div>`;
      }

      // ── Layer cards ───────────────────────────────────────────
      const layerColors = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];
      const compLayersHTML = (s.layers || []).map((lay, li) => {
        const n_ratio = ((lay.E || 1) / E_ref).toFixed(3);
        const E_disp  = fEFmt(lay.E || 200e9);
        const isRef   = li === 0;
        const col     = layerColors[li % layerColors.length];
        const typeLbl = {rect:'RECT',circ:'CIRC',Isym:'I sim.',Tsec:'T↑',Tinv:'T↓'}[lay.type]||lay.type;

        const dimFields = lay.type==='rect'
          ? `<div class="r2" style="margin-bottom:4px">
               <div class="f"><label>b (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.b||0.05)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'b',fLenToSI(this.value));fRenderSegs()"></div>
               <div class="f"><label>h (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.h||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'h',fLenToSI(this.value));fRenderSegs()"></div>
             </div>`
          : lay.type==='circ'
          ? `<div class="r1" style="margin-bottom:4px">
               <div class="f"><label>d (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.d||0.05)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'d',fLenToSI(this.value));fRenderSegs()"></div>
             </div>`
          : `<div class="r2" style="margin-bottom:2px">
               <div class="f"><label>bf (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.bf||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'bf',fLenToSI(this.value));fRenderSegs()"></div>
               <div class="f"><label>tf (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.tf||0.01)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'tf',fLenToSI(this.value));fRenderSegs()"></div>
             </div>
             <div class="r2" style="margin-bottom:4px">
               <div class="f"><label>hw (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.hw||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'hw',fLenToSI(this.value));fRenderSegs()"></div>
               <div class="f"><label>tw (${fUnitLen})</label><input type="number" value="${fLenFmt(lay.tw||0.008)}" step="${fLenStep()}" min="${fLenMin()}"
                 onchange="fSetCompositeLayerField(${s.id},${lay.id},'tw',fLenToSI(this.value));fRenderSegs()"></div>
             </div>`;

        return `<div class="card" style="margin-bottom:6px;background:linear-gradient(180deg,rgba(176,144,245,0.03),rgba(176,144,245,0.01));border-left:3px solid ${col}60;border-color:rgba(176,144,245,0.2)">
          <div class="card-head">
            <span style="font-family:var(--mono);font-size:10px;color:var(--txt2)">
              <strong style="color:${col}">${li+1}.</strong> ${typeLbl}
              &nbsp;·&nbsp;E = ${E_disp} ${fELabel()}
              &nbsp;·&nbsp;<span style="color:var(--purple)">n = ${n_ratio}</span>
              ${isRef ? `<span style="color:var(--txt3);font-size:9px"> (ref)</span>` : ''}
            </span>
            <button class="del" onclick="fDelCompositeLayer(fSegs.find(x=>x.id===${s.id}),${lay.id});fRenderSegs()">✕</button>
          </div>
          ${dimFields}
          <div class="r2" style="margin-bottom:4px">
            <div class="f"><label>x centro (${fUnitLen})</label>
              <input type="number" value="${fLenFmt(lay.x_center||0)}" step="${fLenStep()}"
                onchange="fSetCompositeLayerField(${s.id},${lay.id},'x_center',fLenToSI(this.value));fRenderSegs()"></div>
            <div class="f"><label>y centro (${fUnitLen})</label>
              <input type="number" value="${fLenFmt(lay.y_center||0)}" step="${fLenStep()}"
                onchange="fSetCompositeLayerField(${s.id},${lay.id},'y_center',fLenToSI(this.value));fRenderSegs()"></div>
          </div>
          <div class="r1">
            <div class="f"><label>E (${fELabel()})</label>
              <input type="number" value="${fEFmt(lay.E||200e9)}" step="${fEStep()}" min="0.001"
                onchange="fSetCompositeLayerField(${s.id},${lay.id},'E',fEToSI(this.value));fRenderSegs()"></div>
          </div>
        </div>`;
      }).join('');

      dimRow = `
      <div class="card" style="background:linear-gradient(180deg,rgba(176,144,245,0.04),rgba(176,144,245,0.01));border-color:rgba(176,144,245,0.25)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <p class="sec-t" style="color:var(--purple);margin:0">Sección compuesta</p>
          <button class="btn btn-g" onclick="fCompositeAutoArrangeAndRender(${s.id})" style="font-size:10px;padding:3px 8px" title="Apila las figuras tocándose, centradas en x=0">⟳ Auto-acomodar</button>
        </div>
        <p style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-bottom:10px;line-height:1.5">
          Definí el centro geométrico de cada figura.<br>
          x=0 es el eje de simetría, y=0 es tu referencia.
        </p>
        ${warnHTML}
        <div style="margin-bottom:8px">${compLayersHTML}</div>
        <div class="brow" style="gap:4px;flex-wrap:wrap">
          <button class="btn btn-g" onclick="fAddCompositeLayer(fSegs.find(x=>x.id===${s.id}),'rect');fRenderSegs()" style="flex:1;font-size:11px;min-width:55px">+ Rect</button>
          <button class="btn btn-g" onclick="fAddCompositeLayer(fSegs.find(x=>x.id===${s.id}),'circ');fRenderSegs()" style="flex:1;font-size:11px;min-width:55px">+ Circ</button>
          <button class="btn btn-g" onclick="fAddCompositeLayer(fSegs.find(x=>x.id===${s.id}),'Isym');fRenderSegs()" style="flex:1;font-size:11px;min-width:55px">+ I</button>
          <button class="btn btn-g" onclick="fAddCompositeLayer(fSegs.find(x=>x.id===${s.id}),'Tsec');fRenderSegs()" style="flex:1;font-size:11px;min-width:55px">+ T↑</button>
          <button class="btn btn-g" onclick="fAddCompositeLayer(fSegs.find(x=>x.id===${s.id}),'Tinv');fRenderSegs()" style="flex:1;font-size:11px;min-width:55px">+ T↓</button>
        </div>
      </div>`;
    } else {
      // rect
      dimRow = `<div class="r2">
        <div class="f"><label>Base b (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.b||0.05)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'b',this.value);fRenderSegs()">
        </div>
        <div class="f"><label>Altura h (${fUnitLen})</label>
          <input type="number" value="${fLenFmt(s.h||0.10)}" step="${fLenStep()}" min="${fLenMin()}"
            onchange="fSetSegDim(${s.id},'h',this.value);fRenderSegs()">
        </div>
      </div>`;
    }

    // ── Section properties panel ───────────────────────────────
    const props = fSecProps(s);
    const Ix_cm4  = (props.Ix * 1e8).toFixed(4);
    const Iy_cm4  = (props.Iy * 1e8).toFixed(4);
    const A_cm2   = (props.A  * 1e4).toFixed(4);
    // c = max distance from centroid to extreme fiber
    // Need total height for each type
    let H_total;
    if      (s.secType==='circ')            H_total = s.d || 0.05;
    else if (s.secType==='rect')            H_total = s.h || 0.10;
    else if (s.secType==='Isym')            H_total = 2*(s.tf||0.01) + (s.hw||0.10);
    else if (s.secType==='Tsec'||s.secType==='Tinv') H_total = (s.tf||0.01) + (s.hw||0.10);
    else if (s.secType==='composite')       H_total = props.H_tot || 0.10;
    else                                    H_total = s.h || 0.10;

    const c_top = H_total - props.yc;   // distance centroid → top fiber
    const c_bot = props.yc;             // distance centroid → bottom fiber
    const c_max = Math.max(c_top, c_bot);
    const yc_cm = (props.yc * 100).toFixed(4);
    const c_cm  = (c_max * 100).toFixed(4);

    const isComp = s.secType === 'composite';
    const compHeader = isComp && props.E_ref
      ? `<div style="font-family:var(--mono);font-size:9px;color:var(--purple);margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(176,144,245,0.15)">
           Método n · E_ref = ${(props.E_ref/1e9).toFixed(2)} GPa (capa 1) · Sección transformada
         </div>` : '';
    const IxLabel = isComp ? 'Ix_tr =' : 'Ix =';
    const propsPanel = `<div style="background:rgba(245,200,66,0.05);border:1px solid rgba(245,200,66,0.15);border-radius:8px;padding:8px 10px;margin-top:6px">
      <p style="font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.09em;text-transform:uppercase;margin-bottom:6px">Propiedades de sección</p>
      ${compHeader}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-family:var(--mono);font-size:10px">
        <span style="color:var(--txt3)">${IxLabel}</span><span style="color:var(--acc)">${Ix_cm4} cm⁴</span>
        <span style="color:var(--txt3)">Iy =</span><span style="color:var(--txt2)">${Iy_cm4} cm⁴</span>
        <span style="color:var(--txt3)">A =</span><span style="color:var(--txt2)">${A_cm2} cm²</span>
        <span style="color:var(--txt3)">ȳ (desde filo inf.) =</span><span style="color:var(--txt2)">${yc_cm} cm</span>
        <span style="color:var(--txt3)">c (fibra ext.) =</span><span style="color:var(--orange)">${c_cm} cm</span>
      </div>
    </div>`;

    return `<div class="card">
      <div class="card-head">
        <span class="badge b-seg">segmento ${i+1}</span>
        ${fSegs.length > 1 ? `<button class="del" onclick="fDelSeg(${s.id})">&#x2715;</button>` : ''}
      </div>
      <div class="r2">
        <div class="f readonly">
          <label>x inicio (${fUnitSpan})</label>
          <input type="number" value="${fSpanFmt(s.xa)}" disabled>
        </div>
        <div class="f">
          <label>x fin (${fUnitSpan})</label>
          <input type="number" value="${fSpanFmt(s.xb)}" step="${fSpanStep()}"
            min="${fSpanFromSI(s.xa + 0.001).toFixed(fUnitSpan==='m'?4:fUnitSpan==='cm'?2:1)}"
            onchange="fSetSegBoundary(${s.id},'xb',this.value)">
        </div>
      </div>
      ${secTypeRow}
      ${dimRow}
      <div class="r1">
        <div class="f">
          <label>E (${fELabel()})</label>
          <input type="number" value="${fEFmt(s.E)}" step="${fEStep()}" min="0.001"
            onchange="fSetSegE(${s.id},this.value);fRenderSegs()">
        </div>
      </div>
      <!-- Mini section preview -->
      <canvas class="seg-sec-preview" id="fSegPrev_${s.id}"></canvas>
      ${propsPanel}
    </div>`;
  }).join('');
  cont.innerHTML = segsHTML;
  fDrawSegBar();
  fUpdateLDisplay();
  fUpdateOverlapWarn();
  setTimeout(() => {
    fSegs.forEach(s => drawSegSecPreview(s));
    initSciBadges();
  }, 0);
}

// ── Global overlap warning (shown near Calcular button) ──────────
function fUpdateOverlapWarn() {
  const box = document.getElementById('fOverlapWarn');
  if (!box) return;
  const allMsgs = [];
  fSegs.forEach(s => {
    if (s.secType !== 'composite' || !s.layers || s.layers.length < 2) return;
    for (let ai = 0; ai < s.layers.length; ai++) {
      for (let bi2 = ai + 1; bi2 < s.layers.length; bi2++) {
        const la = s.layers[ai], lb = s.layers[bi2];
        const da = fLayerDims(la), db = fLayerDims(lb);
        const axMin = (la.x_center||0) - da.w/2, axMax = (la.x_center||0) + da.w/2;
        const ayMin = (la.y_center||0) - da.h/2, ayMax = (la.y_center||0) + da.h/2;
        const bxMin = (lb.x_center||0) - db.w/2, bxMax = (lb.x_center||0) + db.w/2;
        const byMin = (lb.y_center||0) - db.h/2, byMax = (lb.y_center||0) + db.h/2;
        const overlapX = axMin < bxMax - 1e-4 && bxMin < axMax - 1e-4;
        const overlapY = ayMin < byMax - 1e-4 && byMin < ayMax - 1e-4;
        if (overlapX && overlapY)
          allMsgs.push(`Seg.&nbsp;${s.id}&nbsp;— capas&nbsp;${ai+1}–${bi2+1}`);
      }
    }
  });
  if (allMsgs.length) {
    box.innerHTML = `<strong>⚠ Solapamiento de capas detectado:</strong> ${allMsgs.join(', ')}.<br>
      <span style="opacity:.8">Al haber solapamiento entre las figuras, la inercia transformada calculada <em>no</em> es la real; corrige las coordenadas de centro antes de calcular.</span>`;
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

// ── MINI SECTION PREVIEW (inside geometry card) ──────────────
function drawSegSecPreview(s) {
  const cvs = document.getElementById('fSegPrev_'+s.id);
  if (!cvs) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cvs.offsetWidth || 280;
  const H = 100;
  cvs.width  = W * dpr;
  cvs.height = H * dpr;
  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0,0,W,H);

  // Background
  ctx.fillStyle='rgba(25,30,40,0.7)';
  ctx.beginPath(); ctx.roundRect(0,0,W,H,6); ctx.fill();

  const props = fSecProps(s);
  let H_tot, B_tot;
  if      (s.secType==='circ')                        { H_tot=s.d||0.05;  B_tot=s.d||0.05; }
  else if (s.secType==='circH')                       { H_tot=s.d||0.10;  B_tot=s.d||0.10; }
  else if (s.secType==='rect')                        { H_tot=s.h||0.10;  B_tot=s.b||0.05; }
  else if (s.secType==='rectH')                       { H_tot=s.h||0.20;  B_tot=s.b||0.10; }
  else if (s.secType==='Isym')                        { H_tot=2*(s.tf||0.01)+(s.hw||0.10); B_tot=s.bf||0.10; }
  else if (s.secType==='Tsec'||s.secType==='Tinv')    { H_tot=(s.tf||0.01)+(s.hw||0.10); B_tot=s.bf||0.10; }
  else if (s.secType==='composite') {
    const bounds = fCompositeBounds(s.layers||[]);
    H_tot = props.H_tot || (bounds.yMax - bounds.yMin) || 0.10;
    B_tot = Math.max(bounds.xMax - bounds.xMin, 0.02);
  }
  else                                                { H_tot=s.h||0.10; B_tot=s.b||0.05; }

  const pad = 12, labW = 40;
  const drawW = W - pad*2 - labW;
  const drawH = H - pad*2;
  const sc  = Math.min(drawW/B_tot, drawH/H_tot) * 0.82;
  const secW = B_tot*sc, secH = H_tot*sc;
  const cx  = pad + labW + drawW/2;
  const yBot = pad + drawH/2 + secH/2;
  const toY = yf => yBot - yf*sc;

  const col = '#60b8f5';

  function rr(y_bot, h_m, w_m, lbl, side) {
    const px=cx-w_m*sc/2, py=toY(y_bot+h_m), pw=w_m*sc, ph=h_m*sc;
    ctx.fillStyle=col+'20'; ctx.strokeStyle=col+'bb'; ctx.lineWidth=1.2;
    ctx.fillRect(px,py,pw,ph); ctx.strokeRect(px,py,pw,ph);
    if (lbl) {
      ctx.fillStyle='rgba(96,184,245,0.6)'; ctx.font='8px DM Mono,monospace';
      ctx.textAlign = side==='l'?'right':'left';
      ctx.fillText(lbl, side==='l'?px-3:px+pw+3, py+ph/2+3);
    }
  }

  if (s.secType==='circ') {
    const r=(s.d||0.05)/2*sc, pcy=toY((s.d||0.05)/2);
    ctx.beginPath(); ctx.arc(cx,pcy,r,0,Math.PI*2);
    ctx.fillStyle=col+'20'; ctx.fill(); ctx.strokeStyle=col+'bb'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.fillStyle='rgba(96,184,245,0.5)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀'+((H_tot*100).toFixed(1))+'cm', cx, pcy+r+11);

  } else if (s.secType==='circH') {
    const ro=(s.d||0.10)/2*sc;
    const t_px = Math.min(Math.max((s.t||0.005)*sc, 1.5), ro*0.45);
    const ri = ro - t_px;
    const pcy = toY((s.d||0.10)/2);
    // Outer ring fill, then clip out inner
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2); ctx.arc(cx,pcy,ri,0,Math.PI*2,true);
    ctx.fillStyle=col+'28'; ctx.fill('evenodd');
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2);
    ctx.strokeStyle=col+'bb'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,pcy,ri,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(96,184,245,0.5)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀'+((H_tot*100).toFixed(1))+' t='+((s.t||0.005)*100).toFixed(1)+'cm', cx, pcy+ro+11);

  } else if (s.secType==='rect') {
    rr(0, s.h||0.10, s.b||0.05, null, null);
    ctx.fillStyle='rgba(96,184,245,0.5)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((s.b||0.05)*100).toFixed(1)+' × '+((s.h||0.10)*100).toFixed(1)+' cm', cx, yBot+11);

  } else if (s.secType==='rectH') {
    const B=s.b||0.10, Hh=s.h||0.20, t=Math.min(s.t||0.01, Math.min(B,Hh)/2-1e-4);
    // Draw as 4 wall rectangles (2 flanges + 2 webs)
    const t_px = t*sc;
    const ox=cx-B*sc/2, oy=toY(Hh), ow=B*sc, oh=Hh*sc;
    // Bottom flange
    ctx.fillStyle=col+'28'; ctx.strokeStyle=col+'bb'; ctx.lineWidth=1.0;
    ctx.fillRect(ox, oy+oh-t_px, ow, t_px);        // bottom flange
    ctx.fillRect(ox, oy, ow, t_px);                  // top flange
    ctx.fillRect(ox, oy+t_px, t_px, oh-2*t_px);     // left web
    ctx.fillRect(ox+ow-t_px, oy+t_px, t_px, oh-2*t_px); // right web
    // Full outline
    ctx.strokeRect(ox, oy, ow, oh);
    // Inner void outline
    ctx.strokeStyle=col+'55';
    ctx.strokeRect(ox+t_px, oy+t_px, ow-2*t_px, oh-2*t_px);
    ctx.fillStyle='rgba(96,184,245,0.5)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((B*100).toFixed(1))+'×'+((Hh*100).toFixed(1))+' t='+((t*100).toFixed(1))+'cm', cx, yBot+11);

  } else if (s.secType==='Isym') {
    const tf=s.tf||0.01, hw=s.hw||0.10, bf=s.bf||0.10, tw=s.tw||0.008;
    rr(0,     tf, bf, 'ala',  'l');
    rr(tf,    hw, tw, 'alma', 'l');
    rr(tf+hw, tf, bf, 'ala',  'l');

  } else if (s.secType==='Tsec') {
    const tf=s.tf||0.01, hw=s.hw||0.10, bf=s.bf||0.10, tw=s.tw||0.008;
    rr(0,  hw, tw, 'alma', 'l');
    rr(hw, tf, bf, 'ala',  'l');

  } else if (s.secType==='Tinv') {
    const tf=s.tf||0.01, hw=s.hw||0.10, bf=s.bf||0.10, tw=s.tw||0.008;
    rr(0,  tf, bf, 'ala',  'l');
    rr(tf, hw, tw, 'alma', 'l');
  } else if (s.secType==='composite') {
    const layerColors = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];
    const layers = s.layers || [];
    // bounds for coordinate mapping
    const bounds = fCompositeBounds(layers);
    const yRef = bounds.yMin; // y=yRef maps to canvas bottom

    // toYc: global y_center coord → canvas pixel
    const toYc = yg => yBot - (yg - yRef) * sc;

    function compRectP(pxL, pyT, pw, ph, cl) {
      ctx.fillStyle=cl+'22'; ctx.strokeStyle=cl+'bb'; ctx.lineWidth=1.0;
      ctx.fillRect(pxL,pyT,pw,ph); ctx.strokeRect(pxL,pyT,pw,ph);
    }

    layers.forEach((lay, li) => {
      const cl = layerColors[li % layerColors.length];
      const dims = fLayerDims(lay);
      const xc = lay.x_center||0, yc_lay = lay.y_center||0;
      // pixel center of the layer
      const px_c = cx + xc * sc;
      const py_c = toYc(yc_lay);

      if (lay.type === 'rect') {
        compRectP(px_c-dims.w*sc/2, py_c-dims.h*sc/2, dims.w*sc, dims.h*sc, cl);
      } else if (lay.type === 'circ') {
        ctx.beginPath(); ctx.arc(px_c, py_c, dims.w/2*sc, 0, Math.PI*2);
        ctx.fillStyle=cl+'22'; ctx.fill(); ctx.strokeStyle=cl+'bb'; ctx.lineWidth=1.0; ctx.stroke();
      } else if (lay.type === 'Isym') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0 = yc_lay - dims.h/2;
        compRectP(px_c-bf*sc/2, toYc(y0+tf),      bf*sc, tf*sc, cl);
        compRectP(px_c-tw*sc/2, toYc(y0+tf+hw),   tw*sc, hw*sc, cl);
        compRectP(px_c-bf*sc/2, toYc(y0+2*tf+hw), bf*sc, tf*sc, cl);
      } else if (lay.type === 'Tsec') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0 = yc_lay - dims.h/2;
        compRectP(px_c-tw*sc/2, toYc(y0+hw),    tw*sc, hw*sc, cl);
        compRectP(px_c-bf*sc/2, toYc(y0+hw+tf), bf*sc, tf*sc, cl);
      } else if (lay.type === 'Tinv') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0 = yc_lay - dims.h/2;
        compRectP(px_c-bf*sc/2, toYc(y0+tf),    bf*sc, tf*sc, cl);
        compRectP(px_c-tw*sc/2, toYc(y0+tf+hw), tw*sc, hw*sc, cl);
      }
    });
  }

  // Centroid line
  const yc_px = toY(props.yc);
  ctx.strokeStyle='rgba(245,200,66,0.5)'; ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(cx-secW/2-5,yc_px); ctx.lineTo(cx+secW/2+5,yc_px); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='rgba(245,200,66,0.6)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='left';
  ctx.fillText('ȳ', cx+secW/2+7, yc_px+3);

  // Type label bottom-right
  const typeLbl = {rect:'Rect.',circ:'Circ.',Isym:'I',Tsec:'T↑',Tinv:'T↓',composite:'Comp.'}[s.secType]||'';
  ctx.fillStyle='rgba(255,255,255,0.20)'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='right';
  ctx.fillText(typeLbl, W-6, H-6);
}

function fDrawSegBar() {
  const cvs = document.getElementById('fCvSeg');
  if (!cvs) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cvs.offsetWidth || cvs.parentElement?.offsetWidth || 290;
  const H = 56;
  cvs.width = W * dpr; cvs.height = H * dpr;
  cvs.style.height = H + 'px';
  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!fSegs.length) return;

  const L   = fGetL() || 1;
  const pal = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];

  // Beam height: proportional to section total height, longitudinal view
  function secTotH(s) {
    if (s.secType==='circ'  || s.secType==='circH') return s.d||0.05;
    if (s.secType==='rect'  || s.secType==='rectH') return s.h||0.10;
    if (s.secType==='Isym')                         return 2*(s.tf||0.01)+(s.hw||0.10);
    if (s.secType==='Tsec'||s.secType==='Tinv')     return (s.tf||0.01)+(s.hw||0.10);
    return s.h||0.10;
  }
  const maxH = Math.max(...fSegs.map(secTotH));
  const barH = H - 16;   // max bar height in pixels
  const yC   = H / 2;    // vertical center

  fSegs.forEach((s, i) => {
    const x1  = s.xa / L * W;
    const x2  = s.xb / L * W;
    const hh  = Math.max(6, secTotH(s) / maxH * barH);
    const col = pal[i % pal.length];
    const y   = yC - hh / 2;

    // Fill + border
    ctx.fillStyle   = col + '28';
    ctx.strokeStyle = col + 'bb';
    ctx.lineWidth   = 1.2;
    ctx.fillRect(x1, y, x2 - x1, hh);
    ctx.strokeRect(x1, y, x2 - x1, hh);

    // Section type icon top-left of segment
    if (x2 - x1 > 18) {
      const typeLbl = {rect:'▭',circ:'◯',Isym:'I',Tsec:'T↑',Tinv:'T↓'}[s.secType] || '▭';
      ctx.fillStyle = col + 'cc';
      ctx.font = '8px DM Mono,monospace';
      ctx.textAlign = 'left';
      ctx.fillText(typeLbl, x1 + 4, y + 9);
    }

    // Dimension label centered
    if (x2 - x1 > 38) {
      let lbl;
      if      (s.secType==='circ') lbl = '⌀'  + ((s.d||0.05)*100).toFixed(0) + 'cm';
      else if (s.secType==='Isym') lbl = 'I '  + ((s.bf||0.10)*100).toFixed(0) + '×' + (secTotH(s)*100).toFixed(0);
      else if (s.secType==='Tsec'||s.secType==='Tinv') lbl = 'T ' + ((s.bf||0.10)*100).toFixed(0) + '×' + (secTotH(s)*100).toFixed(0);
      else                         lbl = ((s.b||0.05)*100).toFixed(0) + '×' + ((s.h||0.10)*100).toFixed(0);
      ctx.fillStyle = col + 'cc';
      ctx.font = '8px DM Mono,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, (x1 + x2) / 2, yC + 4);
    }

    // Segment divider line
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(x1, y - 2); ctx.lineTo(x1, y + hh + 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // x-axis baseline
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, yC); ctx.lineTo(W, yC); ctx.stroke();

  // x = 0 and x = L labels
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = '8px DM Mono,monospace';
  ctx.textAlign = 'left';  ctx.fillText('0', 2, H - 3);
  ctx.textAlign = 'right'; ctx.fillText('L=' + L.toFixed(2) + 'm', W - 2, H - 3);
}

// ── FLEXION LOADS ─────────────────────────────────────────────
function fAddLoad(tipo) {
  fPushUndo();
  const L = fGetL();
  const id = ++fLid;
  if (tipo==='pun')  fLoads.push({id,tipo,x:+(L/2).toFixed(4),val:-1000});
  else if(tipo==='mom')   fLoads.push({id,tipo,x:+(L/2).toFixed(4),val:500});
  else if(tipo==='dis')   fLoads.push({id,tipo,xa:0,xb:+L.toFixed(4),val:-2000});
  else if(tipo==='tri')   fLoads.push({id,tipo,xa:0,xb:+L.toFixed(4),va:-2000,vb:0});
  else if(tipo==='temp')  fLoads.push({id,tipo,xa:0,xb:+L.toFixed(4),T_inf:20,T_sup:-20,alpha:12e-6});
  else if(tipo==='axial') fLoads.push({id,tipo,x:+(L/2).toFixed(4),val:0});
  else fLoads.push({id,tipo,xa:0,xb:+L.toFixed(4),expr:'-5000*(1+(x/L)^2)'});
  fRenderLoads();
}

function fDelLoad(id) {
  fPushUndo();
  const i = fLoads.findIndex(l => l.id===id);
  if (i>=0) fLoads.splice(i,1);
  fRenderLoads();
}

function fSetLoad(id, field, val) {
  fTrackEdit();
  const l = fLoads.find(l => l.id===id);
  if (!l) return;
  if (field==='expr') { l.expr = val; return; }
  const n = typeof val==='number'?val:parseSci(String(val));
  l[field] = isNaN(n)?+val:n;
}

function fRenderLoads() {
  document.getElementById('fHLoad').style.display = fLoads.length?'none':'block';
  document.getElementById('fCLoad').innerHTML = fLoads.map(l => {
    const bcls = l.tipo==='pun'?'b-pun':l.tipo==='mom'?'b-dis':l.tipo==='pol'?'b-pol':l.tipo==='temp'?'b-acc':l.tipo==='axial'?'b-seg':'b-dis';
    const blbl = l.tipo==='pun'?'Puntual':l.tipo==='mom'?'Momento':l.tipo==='dis'?'Distribuida':l.tipo==='tri'?'Triangular':l.tipo==='temp'?'Grad. térmico':l.tipo==='axial'?'Axial N':'Polinomio';
    // Helpers locales
    const xInp  = (field,val) => `<div class="f"><label>posici\u00f3n x (${fUnitSpan})</label>
      <input type="number" value="${fSpanFmt(val)}" step="${fSpanStep()}"
        onchange="fSetLoad(${l.id},'${field}',fSpanToSI(this.value))"></div>`;
    const xaInp = (val) => `<div class="f"><label>x inicio (${fUnitSpan})</label>
      <input type="number" value="${fSpanFmt(val)}" step="${fSpanStep()}"
        onchange="fSetLoad(${l.id},'xa',fSpanToSI(this.value))"></div>`;
    const xbInp = (val) => `<div class="f"><label>x fin (${fUnitSpan})</label>
      <input type="number" value="${fSpanFmt(val)}" step="${fSpanStep()}"
        onchange="fSetLoad(${l.id},'xb',fSpanToSI(this.value))"></div>`;
    const fInp  = (field,val,lbl) => `<div class="f"><label>${lbl}</label>
      <input type="number" value="${fForceFmt(val)}" step="any"
        onchange="fSetLoad(${l.id},'${field}',fForceToSI(this.value))"></div>`;
    const mInp  = (field,val,lbl) => `<div class="f"><label>${lbl}</label>
      <input type="number" value="${fMomentFmt(val)}" step="any"
        onchange="fSetLoad(${l.id},'${field}',fForceToSI(this.value))"></div>`;
    let body = '';
    if (l.tipo==='pun') {
      body=`<div class="r2">${xInp('x',l.x||0)}${fInp('val',l.val||0,'P ('+fForceLabel()+') \u2191+')}</div>`;
    } else if (l.tipo==='mom') {
      body=`<div class="r2">${xInp('x',l.x||0)}${mInp('val',l.val||0,'M ('+fMomentLabel()+') ↺+')}</div>`;
    } else if (l.tipo==='dis') {
      body=`<div class="r3">${xaInp(l.xa||0)}${xbInp(l.xb||0)}${fInp('val',l.val||0,'q\u2080 ('+fFpLLabel()+') \u2191+')}</div>`;
    } else if (l.tipo==='tri') {
      body=`<div class="r2">${xaInp(l.xa||0)}${xbInp(l.xb||0)}</div>
      <div class="r2">${fInp('va',l.va||0,'q(x inicio) ('+fFpLLabel()+') \u2191+')}${fInp('vb',l.vb||0,'q(x fin) ('+fFpLLabel()+') \u2191+')}</div>`;
    } else if (l.tipo==='temp') {
      const dT = (+l.T_sup||0) - (+l.T_inf||0);
      const dTlbl = dT > 0 ? '\u2192 \u2193 sagging (sup. caliente)' : dT < 0 ? '\u2192 \u2191 hogging (inf. caliente)' : '\u2192 sin gradiente';
      body=`<div class="r2">${xaInp(l.xa||0)}${xbInp(l.xb||0)}</div>
      <div class="r2">
        <div class="f"><label>T inferior (\u00b0C)</label><input type="number" value="${l.T_inf}" step="1" onchange="fSetLoad(${l.id},'T_inf',this.value);fRenderLoads()"></div>
        <div class="f"><label>T superior (\u00b0C)</label><input type="number" value="${l.T_sup}" step="1" onchange="fSetLoad(${l.id},'T_sup',this.value);fRenderLoads()"></div>
      </div>
      <div class="r1">${sciField({label:'Coef. dilat. \u03b1 (1/\u00b0C)', value: l.alpha, onChangeFn:`fSetLoad(${l.id},'alpha',__v__)`})}</div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-top:4px">
        \u0394T = T_sup \u2212 T_inf = ${dT.toFixed(1)} \u00b0C &nbsp; ${dTlbl}
      </div>`;
    } else if (l.tipo==='axial') {
      body=`<div class="r2">${xInp('x',l.x||0)}<div class="f"><label>N (${fForceLabel()}) · + tracci\u00f3n \u2192, \u2212 comp. \u2190</label>
        <input type="number" value="${fForceFmt(l.val||0)}" step="any"
          onchange="fSetLoad(${l.id},'val',fForceToSI(this.value))"></div></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-top:3px">Requiere al menos un apoyo con \u2194 u=0 activado</div>`;
    } else {
      body=`<div class="r2">${xaInp(l.xa||0)}${xbInp(l.xb||0)}</div>
      <div class="r1"><div class="f"><label>expresi\u00f3n q(x) \u2014 en ${fFpLLabel()}, usa: x, L, PI</label>
        <textarea onchange="fSetLoad(${l.id},'expr',this.value)">${l.expr||''}</textarea>
      </div></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--txt3)">ej: -2000*(1-(x/L)) &nbsp; \u2193 positivo</div>`;
    }
    return `<div class="card"><div class="card-head"><span class="badge ${bcls}">${blbl}</span><button class="del" onclick="fDelLoad(${l.id})">&#x2715;</button></div>${body}</div>`;
  }).join('');
  setTimeout(initSciBadges, 0);
}

// ── FLEXION DISTRIBUTED LOAD AT x ────────────────────────────
function fQat(x, L) {
  let q = 0;
  fLoads.forEach(l => {
    if (l.tipo==='dis' && x>=l.xa-1e-9 && x<=l.xb+1e-9) q += (+l.val||0);
    if (l.tipo==='tri' && x>=l.xa-1e-9 && x<=l.xb+1e-9) {
      const span = l.xb - l.xa;
      const t = span > 1e-12 ? (x - l.xa) / span : 0;
      q += (+l.va||0) * (1 - t) + (+l.vb||0) * t;
    }
    if (l.tipo==='pol' && x>=l.xa-1e-9 && x<=l.xb+1e-9) {
      const v = evalExpr(l.expr,x,L);
      if (!isNaN(v)) q += fForceToSI(v);  // expr entered in user units
    }
  });
  return q;  // SI: N/m (force per length)
}

// ── EULER-BERNOULLI ELEMENT STIFFNESS ─────────────────────────
// k = EI/L³ * [[12,6l,-12,6l],[6l,4l²,-6l,2l²],[-12,-6l,12,-6l],[6l,2l²,-6l,4l²]]
function fElemK(EI, le) {
  const a = EI/le**3;
  const L = le;
  return [
    [ 12*a,    6*a*L,   -12*a,    6*a*L ],
    [  6*a*L,  4*a*L**2, -6*a*L,  2*a*L**2 ],
    [-12*a,   -6*a*L,    12*a,   -6*a*L ],
    [  6*a*L,  2*a*L**2, -6*a*L,  4*a*L**2 ]
  ];
}

// ── FLEXION SOLVE ─────────────────────────────────────────────
function fSolveUI() {
  const btn = document.getElementById('fSolveBtn');
  const spin = document.getElementById('fSolveSpinner');
  if (btn)  btn.disabled = true;
  if (spin) spin.style.display = '';
  // Yield to the browser so the spinner renders before the computation starts
  requestAnimationFrame(() => {
    try { fSolve(); } finally {
      _fSecCache = null;    // ensure cache is released even if fSolve returned early
      if (btn)  btn.disabled = false;
      if (spin) spin.style.display = 'none';
    }
  });
}

function fSolve() {
  fShowErr('');
  _fSecCache = new Map();   // activate per-solve cache; cleared after solve
  const L = fGetL(), nps = fGetN();

  if (!L||L<=0)          { fShowErr('Longitud inválida.'); return; }
  if (!fSegs.length)     { fShowErr('Define al menos un segmento.'); return; }
  if (!fLoads.length)    { fShowErr('Agrega al menos una carga.'); return; }
  if (!fSupports.length) { fShowErr('Agrega al menos un apoyo.'); return; }

  fNormalizeSegs();
  for (let i=0;i<fSegs.length;i++) {
    if (fSegs[i].xb<=fSegs[i].xa) { fShowErr(`Segmento ${i+1} con longitud inválida.`); return; }
  }

  // Validate section stiffness
  for (let i=0;i<fSegs.length;i++) {
    const EI = fGetEI2(fSegs[i]);
    if (!isFinite(EI) || EI <= 0) {
      fShowErr(`Segmento ${i+1}: rigidez EI inválida. Verifica el módulo E y las dimensiones de la sección.`);
      return;
    }
  }

  // Validate loads
  for (const l of fLoads) {
    if (l.tipo==='pol') {
      const v = evalExpr(l.expr, L/2, L);
      if (isNaN(v)) { fShowErr(`Expresión inválida: "${l.expr}"`); return; }
    }
  }
  const hasNonZeroLoad = fLoads.some(l => {
    if (l.tipo==='pun'||l.tipo==='dis') return Math.abs(+l.val||0) > 1e-14;
    if (l.tipo==='tri') return Math.abs(+l.va||0)>1e-14 || Math.abs(+l.vb||0)>1e-14;
    if (l.tipo==='mom') return Math.abs(+l.val||0) > 1e-14;
    if (l.tipo==='pol') return true;
    if (l.tipo==='temp') return Math.abs((+l.T_inf||0)-(+l.T_sup||0)) > 1e-14;
    return false;
  });
  if (!hasNonZeroLoad) { fShowErr('Todas las cargas tienen valor cero. Ingresa al menos una carga distinta de cero.'); return; }

  // Validate load positions (point loads and moments)
  for (const l of fLoads) {
    if (l.tipo==='pun'||l.tipo==='mom') {
      const xL = +l.x||0;
      if (xL < -1e-9 || xL > L+1e-9) {
        fShowErr(`Carga en x=${xL.toFixed(3)} m está fuera de la viga [0, ${L.toFixed(3)} m].`);
        return;
      }
    }
  }

  const nEl  = fSegs.length * nps;
  const le   = L / nEl;
  // nNodes = nEl+1; DOFs = 2 per node: [v0,θ0, v1,θ1, ..., vN,θN]
  const nDof = 2 * (nEl + 1);

  // Banded stiffness matrix: Euler-Bernoulli 2 DOF/node → half-bandwidth bw=3
  // KB[i][bw + j - i] = K[i][j] for |j-i| <= bw
  const bw = 3, bw2 = 2 * bw;
  const KB = Array.from({length: nDof}, () => new Float64Array(bw2 + 1));
  const F  = new Float64Array(nDof);
  const EIe = new Float64Array(nEl);
  const qVis = new Float64Array(nEl);

  // Assemble stiffness into banded storage
  for (let e=0;e<nEl;e++) {
    const xm = (e+0.5)*le;
    const EI = fGetEI_at(xm);
    EIe[e] = EI;
    const ke = fElemK(EI, le);
    const dofs = [2*e, 2*e+1, 2*(e+1), 2*(e+1)+1];
    for (let i=0;i<4;i++) {
      const gi = dofs[i];
      for (let j=0;j<4;j++) {
        const off = dofs[j] - gi + bw;
        if (off >= 0 && off <= bw2) KB[gi][off] += ke[i][j];
      }
    }
  }

  // Assemble load vector (distributed + polynomial — consistent load vector)
  // For element e, consistent nodal loads: F = ∫N^T q dx
  // For uniform q over element: Fe = q*le/2 * [1, le/6, 1, -le/6]
  // For general q: use 5-point Gauss quadrature
  for (let e=0;e<nEl;e++) {
    const x1=e*le, x2=(e+1)*le;
    let f0=0,f1=0,f2=0,f3=0;
    const nG=5;
    for (let g=0;g<nG;g++) {
      const xi = x1+(x2-x1)*(g+0.5)/nG;
      let q=0;
      fLoads.forEach(l=>{
        if(l.tipo==='dis'&&xi>=l.xa-1e-9&&xi<=l.xb+1e-9) q+=(+l.val||0);
        if(l.tipo==='tri'&&xi>=l.xa-1e-9&&xi<=l.xb+1e-9){
          const span=l.xb-l.xa; const tt=span>1e-12?(xi-l.xa)/span:0;
          q+=(+l.va||0)*(1-tt)+(+l.vb||0)*tt;
        }
        if(l.tipo==='pol'&&xi>=l.xa-1e-9&&xi<=l.xb+1e-9){
          const v=evalExpr(l.expr,xi,L); if(!isNaN(v)) q+=fForceToSI(v);
        }
      });
      const t=(xi-x1)/le;  // [0,1]
      const dxi=(x2-x1)/nG;
      // Hermite shape functions N1=(1-3t²+2t³), N2=le*t(1-t)², N3=(3t²-2t³), N4=le*t²(t-1)
      f0 += q*(1-3*t**2+2*t**3)*dxi;
      f1 += q*le*t*(1-t)**2*dxi;
      f2 += q*(3*t**2-2*t**3)*dxi;
      f3 += q*le*t**2*(t-1)*dxi;
      qVis[e] += q*(x2-x1)/nG;
    }
    qVis[e] /= le;  // average q
    const d=[2*e,2*e+1,2*(e+1),2*(e+1)+1];
    F[d[0]]+=f0; F[d[1]]+=f1; F[d[2]]+=f2; F[d[3]]+=f3;
  }

  // Point loads and moments
  fLoads.forEach(l => {
    if (l.tipo==='pun') {
      const xi = Math.max(0,Math.min(L,+l.x||0));
      const idx = Math.min(Math.round(xi/le), nEl);
      F[2*idx] += (+l.val||0);  // already SI (N)
    }
    if (l.tipo==='mom') {
      const xi = Math.max(0,Math.min(L,+l.x||0));
      const idx = Math.min(Math.round(xi/le), nEl);
      F[2*idx+1] += (+l.val||0);  // already SI (N·m)
    }
  });

  // Thermal gradient loads — equivalent nodal moments from Hermite shape functions
  // κ_T = α·ΔT/h,  ΔT = T_inf − T_sup  (bottom − top)
  // Physics: T_sup > T_inf → top fiber longer → beam curves UPWARD (hogging)
  // With +v=downward FEM convention: upward deflection = negative v → negate κ_T
  // Equivalent load vector per element: EI·κ_T·[0, +1, 0, -1]
  fLoads.forEach(l => {
    if (l.tipo !== 'temp') return;
    const xa_t  = Math.max(0, +l.xa  || 0);
    const xb_t  = Math.min(L, +l.xb  || L);
    const alpha = Math.abs(+l.alpha   || 12e-6);
    const dT    = (+l.T_inf || 0) - (+l.T_sup || 0);  // ΔT = T_bottom − T_top (sign: top hotter → dT < 0 → upward)
    if (Math.abs(dT) < 1e-14) return;
    for (let e = 0; e < nEl; e++) {
      const xm = (e + 0.5) * le;
      if (xm < xa_t - 1e-9 || xm > xb_t + 1e-9) continue;
      const h = fGetH_at(xm);
      if (h <= 0) continue;
      const kappa_T = alpha * dT / h;
      F[2*e+1]       -= EIe[e] * kappa_T;  // left node moment
      F[2*(e+1)+1]   += EIe[e] * kappa_T;  // right node moment
    }
  });

  // Apply boundary conditions
  // Supported DOF sets per BC type:
  // SS: v(0)=0, v(L)=0
  // FF: v(0)=0,θ(0)=0, v(L)=0,θ(L)=0
  // FC: v(0)=0,θ(0)=0  (cantilever, free at B)
  // SF: v(0)=0, v(L)=0,θ(L)=0
  // SC: v(0)=0  (free at B — same as simply supported at A only, but unusual; treat as SS on left, free right)
  // CF: v(L)=0,θ(L)=0  (cantilever from right)

  // Construir prescribedBCs (DOFs rígidos con valor prescrito) y resortes desde fSupports
  const rawPrescribed = []; // { dof, val } — DOF rígido con desplazamiento prescrito (0 = sin asentamiento)
  const rawSprings = []; // [{dof, k_SI}]
  fSupports.forEach(sup => {
    const ni = Math.min(Math.round(Math.max(0, sup.x) / le), nEl);
    if (sup.restrictV) {
      if (sup.kV != null) rawSprings.push({ dof: 2*ni,   k: sup.kV   });  // already SI (N/m)
      else                rawPrescribed.push({ dof: 2*ni,     val: +(sup.deltaV     || 0) });
    }
    if (sup.restrictTheta) {
      if (sup.kTheta != null) rawSprings.push({ dof: 2*ni+1, k: sup.kTheta });  // already SI (N·m/rad)
      else                    rawPrescribed.push({ dof: 2*ni+1, val: +(sup.deltaTheta || 0) });
    }
  });
  // Deduplicate (same DOF twice → keep last)
  const _bcMap = new Map();
  rawPrescribed.forEach(p => _bcMap.set(p.dof, p.val));
  const prescribedBCs = [..._bcMap.entries()].map(([dof, val]) => ({ dof, val }));
  const fixedDofs = prescribedBCs.map(p => p.dof).sort((a, b) => a - b);
  if (!fixedDofs.length && !rawSprings.length) {
    fShowErr('Los apoyos no restringen ningún DOF. Activa al menos una restricción.');
    return;
  }

  // Añadir rigidez de resortes a la diagonal (banded diagonal = index bw)
  rawSprings.forEach(({ dof, k }) => { KB[dof][bw] += k; });

  // BC application on a copy of the banded matrix
  const KBf = KB.map(r => new Float64Array(r));
  const Ff  = new Float64Array(F);
  prescribedBCs.forEach(({ dof, val }) => {
    const jMin = Math.max(0, dof - bw), jMax = Math.min(nDof - 1, dof + bw);
    if (Math.abs(val) > 1e-15) {
      for (let j = jMin; j <= jMax; j++) {
        if (j !== dof) Ff[j] -= KBf[j][bw + dof - j] * val;
      }
    }
    for (let k = 0; k <= bw2; k++) KBf[dof][k] = 0;
    for (let j = jMin; j <= jMax; j++) KBf[j][bw + dof - j] = 0;
    KBf[dof][bw] = 1;
    Ff[dof] = val;
  });

  const u_vec = bandedSolve(bw, KBf, Ff);
  if (!u_vec) {
    if (fixedDofs.length < 2 && rawSprings.length === 0)
      fShowErr('Estructura inestable: la viga necesita al menos 2 restricciones rígidas para eliminar los modos de cuerpo rígido (traslación y rotación).');
    else if (fixedDofs.length === 0 && rawSprings.length > 0)
      fShowErr('Estructura apoyada solo en resortes: la rigidez combinada es insuficiente. Aumenta las constantes de resorte o agrega un apoyo rígido.');
    else
      fShowErr('Estructura inestable o mal condicionada. Verifica que los apoyos estén dentro de la viga y no haya segmentos superpuestos.');
    return;
  }

  // Post-solve sanity check: catch near-singular (extreme or NaN displacements)
  const maxDefl = u_vec.reduce((m, v, i) => i%2===0 ? Math.max(m, Math.abs(v)) : m, 0);
  if (!isFinite(maxDefl) || maxDefl > 1e5) {
    fShowErr('Resultado inválido: deflexión extrema detectada (posible mecanismo). Verifica que la viga tenga restricciones suficientes en ambos extremos.');
    return;
  }

  // ── RESULT RECOVERY via Hermite shape functions ─────────────
  // DOF vector: u = [v0,θ0, v1,θ1, ..., vN,θN]
  // Hermite shape functions (ξ = x/le ∈ [0,1]):
  //   N1(ξ) =  1 - 3ξ² + 2ξ³       dN1/dξ = (-6ξ + 6ξ²)/le    d²N1/dξ² = (-6 + 12ξ)/le²
  //   N2(ξ) =  le·ξ(1-ξ)²           dN2/dξ = (1-4ξ+3ξ²)        d²N2/dξ² = (-4+6ξ)/le
  //   N3(ξ) =  3ξ² - 2ξ³            dN3/dξ = (6ξ - 6ξ²)/le     d²N3/dξ² = (6 - 12ξ)/le²
  //   N4(ξ) =  le·ξ²(ξ-1)           dN4/dξ = (2ξ-3ξ²+1-1)... = le·ξ(2ξ-1) → (-2+6ξ)/le ... 
  //
  // Exact formulas:
  //   v(ξ)  = N1·vi + N2·θi·le + N3·vj + N4·θj·le    [but N2,N4 absorb le already]
  //   θ(ξ)  = dv/dx = (1/le)·dv/dξ
  //   M(ξ)  = EI·d²v/dx² = (EI/le²)·d²v/dξ²
  //   V     = dM/dx = (EI/le³)·d³v/dξ³  (constant per element for linear shape)
  //
  // d²v/dξ² = (-6+12ξ)·vi + (-4+6ξ)·le·θi + (6-12ξ)·vj + (-2+6ξ)·le·θj
  //
  // V = constant within element (Euler-Bernoulli):
  // d³v/dξ³ = 12·vi + 6·le·θi - 12·vj + 6·le·θj  (coeff of ξ⁰)
  //   → but standard derivation: dV/dx = -q(x), V constant only if q=0
  //   For FEM with consistent load vector the element shear is recovered as:
  //   V_left  = -(EI/le³)·[12·vi + 6·le·θi - 12·vj + 6·le·θj]  (reaction at left node, sign depends on convention)
  //
  // SIGN CONVENTION used here:
  //   +v  = downward (positive load is downward)
  //   +M  = sagging (bottom fiber in tension) — standard structural sign
  //   +V  = beam-left upward / beam-right downward

  // Extract nodal displacements
  const v_nodes  = new Float64Array(nEl+1);  // deflection at nodes (m), positive down
  const th_nodes = new Float64Array(nEl+1);  // rotation at nodes (rad), positive CCW

  for (let i=0;i<=nEl;i++) {
    v_nodes[i]  = u_vec[2*i];
    th_nodes[i] = u_vec[2*i+1];
  }

  // ── BENDING MOMENT: nodal values from Hermite d²v/dx² ────────
  const M_nodes = new Float64Array(nEl+1);
  const M_cnt   = new Float64Array(nEl+1);
  const M_elem  = new Float64Array(nEl);

  for (let e=0;e<nEl;e++) {
    const vi=v_nodes[e], ti=th_nodes[e], vj=v_nodes[e+1], tj=th_nodes[e+1];
    const EI=EIe[e]; const h=le;
    // M at left node (ξ=0):  EI/h² · (-6vi - 4h·θi + 6vj - 2h·θj)
    const M_left_val  = EI/h**2 * (-6*vi - 4*h*ti + 6*vj - 2*h*tj);
    // M at right node (ξ=1): EI/h² · ( 6vi + 2h·θi - 6vj + 4h·θj)
    const M_right_val = EI/h**2 * ( 6*vi + 2*h*ti - 6*vj + 4*h*tj);
    M_nodes[e]   += M_left_val;  M_cnt[e]++;
    M_nodes[e+1] += M_right_val; M_cnt[e+1]++;
    M_elem[e]     = 0.5*(M_left_val + M_right_val);
  }
  for (let i=0;i<=nEl;i++) { if(M_cnt[i]>0) M_nodes[i] /= M_cnt[i]; }

  // ── THERMAL MOMENT CORRECTION ─────────────────────────────────
  // The FEM recovers M_FEM = EI·κ_actual from displacements.
  // Real (stress-generating) moment: M_real = EI·(κ_actual − κ_T) = M_FEM − EI·κ_T
  // Subtract the free thermal curvature contribution from M_nodes and M_elem.
  fLoads.forEach(l => {
    if (l.tipo !== 'temp') return;
    const xa_t  = Math.max(0, +l.xa  || 0);
    const xb_t  = Math.min(L, +l.xb  || L);
    const alpha = Math.abs(+l.alpha   || 12e-6);
    const dT    = (+l.T_inf || 0) - (+l.T_sup || 0);  // mismo signo que ensamblado de cargas
    if (Math.abs(dT) < 1e-14) return;
    // Correct nodal moments
    for (let i = 0; i <= nEl; i++) {
      const x = i * le;
      if (x < xa_t - 1e-9 || x > xb_t + 1e-9) continue;
      const h = fGetH_at(x);
      if (h <= 0) continue;
      // EI at node: average of adjacent elements
      const EI_L = i > 0   ? EIe[i - 1] : EIe[0];
      const EI_R = i < nEl ? EIe[i]     : EIe[nEl - 1];
      M_nodes[i] -= ((EI_L + EI_R) / 2) * (alpha * dT / h);
    }
    // Correct element midpoint moments
    for (let e = 0; e < nEl; e++) {
      const xm = (e + 0.5) * le;
      if (xm < xa_t - 1e-9 || xm > xb_t + 1e-9) continue;
      const h = fGetH_at(xm);
      if (h <= 0) continue;
      M_elem[e] -= EIe[e] * (alpha * dT / h);
    }
  });

  // Reactions: R_i = sum_j(K[i][j]*u[j]) - F[i] — use original banded KB
  const reactions = {};
  fixedDofs.forEach(i=>{
    let r = 0;
    const jMin = Math.max(0, i - bw), jMax = Math.min(nDof - 1, i + bw);
    for (let j = jMin; j <= jMax; j++) r += KB[i][bw + j - i] * u_vec[j];
    reactions[i] = r - F[i];
  });
  // Spring reactions: the spring opposes displacement → R = -k * u
  // (sign convention: +v = upward; downward deflection u < 0 → spring pushes up → R > 0)
  rawSprings.forEach(({ dof, k }) => {
    reactions[dof] = -k * u_vec[dof];
  });

  // ── SHEAR FORCE: equilibrio estático (sin oscilaciones FEM) ──
  // Convenio: +V = fuerza hacia arriba en cara izquierda del corte (convenio estándar).
  // Convenio FEM: +v = arriba, carga hacia abajo = negativa, reacción hacia arriba = positiva.
  const nodeNetV = new Float64Array(nEl + 1);
  fixedDofs.forEach(dof => {
    if (dof % 2 === 0) nodeNetV[dof / 2] += reactions[dof] || 0;
  });
  // Include spring vertical reactions in shear equilibrium
  rawSprings.forEach(({ dof }) => {
    if (dof % 2 === 0) nodeNetV[dof / 2] += reactions[dof] || 0;
  });
  fLoads.forEach(l => {
    if (l.tipo === 'pun') {
      const xi = Math.max(0, Math.min(L, +l.x || 0));
      const ni = Math.min(Math.round(xi / le), nEl);
      nodeNetV[ni] += (+l.val || 0);  // already SI (N)
    }
  });
  // V justo antes (V_left) y justo después (V_right) de cada nodo
  // Integración de izquierda a derecha: V_right[i] = V_left[i] + (fuerzas ↑ en nodo i)
  // qVis[e] < 0 para carga distribuida hacia abajo → V decrece de izq a der ✓
  const V_left  = new Float64Array(nEl + 1);
  const V_right = new Float64Array(nEl + 1);
  V_right[0] = nodeNetV[0];
  for (let e = 0; e < nEl; e++) {
    V_left[e+1]  = V_right[e] + qVis[e] * le;
    V_right[e+1] = V_left[e+1] + nodeNetV[e+1];
  }
  // Datos para el gráfico: un punto por nodo + puntos extra en discontinuidades
  const xs_v   = [];
  const V_data = [];
  xs_v.push((0).toFixed(5)); V_data.push(fForceFromSI(V_right[0]));
  for (let i = 1; i <= nEl; i++) {
    const x = (i * le).toFixed(5);
    xs_v.push(x); V_data.push(fForceFromSI(V_left[i]));
    // Agregar salto en nodos intermedios (no en el último nodo — no hay viga más allá de x=L)
    if (i < nEl && Math.abs(V_right[i] - V_left[i]) > 1e-4) {
      xs_v.push(x); V_data.push(fForceFromSI(V_right[i]));
    }
  }
  const V_nodes = V_left;

  // ── ESFUERZO CORTANTE τ_max en cada elemento ────────────────
  const tau_max_elem = new Float64Array(nEl);
  for (let e = 0; e < nEl; e++) {
    // Usar el cortante de mayor magnitud en el elemento
    const V_max_abs_in_elem = Math.max(Math.abs(V_right[e]), Math.abs(V_left[e+1]));
    const xm = (e + 0.5) * le;
    const s = fSegs.find(s => xm >= s.xa - 1e-9 && xm <= s.xb + 1e-9) || fSegs[fSegs.length - 1];
    const props = fSecProps(s);
    if (props.Ix > 0 && props.b_for_tau_max > 0) {
      tau_max_elem[e] = (V_max_abs_in_elem * props.Qmax) / (props.Ix * props.b_for_tau_max);
    } else {
      tau_max_elem[e] = 0;
    }
  }

  // Maxima
  const vMax  = Math.max(...Array.from(v_nodes).map(Math.abs));
  const thMax = Math.max(...Array.from(th_nodes).map(Math.abs));
  const MMax  = Math.max(...Array.from(M_nodes).map(Math.abs));
  const VMax  = Math.max(...Array.from(V_left).map(Math.abs), ...Array.from(V_right).map(Math.abs));

  // Pre-declare axial results (populated by axial solver below, before first use)
  let N_elem_arr = new Float64Array(nEl);
  let axialReactions = {};
  const hasAxialLoads = fLoads.some(l => l.tipo === 'axial');
  const hasRestrictU  = fSupports.some(s => s.restrictU);

  if (hasAxialLoads && !hasRestrictU) {
    fShowErr('Sistema axial inestable: activa "↔ u=0" en al menos un apoyo para equilibrar las cargas axiales.');
    return;
  }

  if (hasAxialLoads || hasRestrictU) {
    // Axial system: 1 DOF/node → tridiagonal (bw=1)
    const bwAx = 1, bw2Ax = 2;
    const KB_ax = Array.from({length: nEl+1}, () => new Float64Array(3));
    const F_ax  = new Float64Array(nEl+1);
    const EA_e  = new Float64Array(nEl);
    for (let e = 0; e < nEl; e++) {
      const xm = (e + 0.5) * le;
      const EA = fGetEA_at(xm);
      EA_e[e] = EA;
      const k = EA / le;
      KB_ax[e][1]   += k;  KB_ax[e][2]   -= k;
      KB_ax[e+1][0] -= k;  KB_ax[e+1][1] += k;
    }
    fLoads.forEach(l => {
      if (l.tipo === 'axial') {
        const xi = Math.max(0, Math.min(L, +l.x || 0));
        const ni = Math.min(Math.round(xi / le), nEl);
        F_ax[ni] += (+l.val || 0);
      }
    });
    const fixedAxSet = new Set();
    fSupports.forEach(sup => {
      if (sup.restrictU) {
        const ni = Math.min(Math.round(Math.max(0, sup.x) / le), nEl);
        fixedAxSet.add(ni);
      }
    });
    const KBf_ax = KB_ax.map(r => new Float64Array(r));
    const Ff_ax  = new Float64Array(F_ax);
    fixedAxSet.forEach(ni => {
      const jMin = Math.max(0, ni-1), jMax = Math.min(nEl, ni+1);
      for (let k = 0; k <= bw2Ax; k++) KBf_ax[ni][k] = 0;
      for (let j = jMin; j <= jMax; j++) KBf_ax[j][1 + ni - j] = 0;
      KBf_ax[ni][1] = 1;
      Ff_ax[ni] = 0;
    });
    const u_axial = bandedSolve(bwAx, KBf_ax, Ff_ax);
    if (u_axial) {
      for (let e = 0; e < nEl; e++) {
        N_elem_arr[e] = EA_e[e] * (u_axial[e+1] - u_axial[e]) / le;
      }
      fixedAxSet.forEach(ni => {
        let r = 0;
        for (let j = 0; j <= nEl; j++) r += K_ax[ni][j] * u_axial[j];
        axialReactions[ni] = r - F_ax[ni];
      });
    }
  }

  // Flexión compuesta: σ = N/A ± M·c/I
  // Composite per-layer table shown at the M_max node (pedagogical)
  let sigmaMax = 0;
  const MMaxIdx = Array.from(M_nodes).reduce((mi,v,i,a)=>Math.abs(v)>Math.abs(a[mi])?i:mi,0);
  {
    const xm = MMaxIdx * le;
    const s=fSegs.find(s=>xm>=s.xa-1e-9&&xm<=s.xb+1e-9)||fSegs[fSegs.length-1];
    const M_max = M_nodes[MMaxIdx];
    if (s.secType === 'composite') {
      const cp = fCompositeSecProps(s);
      const I_tr = cp.Ix, yc_global = cp.yc_global;
      const layerColors = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];
      if (I_tr > 0 && s.layers && s.layers.length) {
        const N_s = N_elem_arr[Math.min(MMaxIdx, nEl - 1)] || 0;  // N at M_max location from axial solver
        // A_tr = Σ n_i · A_i (transformed area for axial)
        const A_tr = s.layers.reduce((sum, lay, li) => {
          const n = cp.layers_contribution[li].n;
          return sum + n * fLayerDims(lay).A;
        }, 0);
        const sigma_N_tr = A_tr > 0 ? N_s / A_tr : 0;  // axial stress in transformed section
        const rowsHTML = (s.layers || []).map((lay, li) => {
          const ld   = cp.layers_contribution[li];
          const n    = ld.n;
          const dims = fLayerDims(lay);
          const yc_lay = lay.y_center || 0;
          const y_b  = yc_lay - dims.h / 2;
          const y_t  = yc_lay + dims.h / 2;
          // σ_i = n · (N/A_tr + M·(y−ȳ)/I_tr)
          const sb   = fStressFromSI(n * (sigma_N_tr - M_max * (y_b - yc_global) / I_tr));
          const st   = fStressFromSI(n * (sigma_N_tr - M_max * (y_t - yc_global) / I_tr));
          const col  = layerColors[li % layerColors.length];
          const typeLbl = {rect:'Rect',circ:'Circ',Isym:'I',Tsec:'T↑',Tinv:'T↓'}[lay.type]||lay.type;
          return `<div class="ir">
            <span class="ik" style="color:${col}">Capa ${li+1} · ${typeLbl} &nbsp;E=${(lay.E/1e9).toFixed(2)}GPa &nbsp;n=${n.toFixed(3)}</span>
            <span class="iv"></span>
          </div>
          <div class="ir" style="padding-left:14px">
            <span class="ik" style="font-size:9px">σ fibra inf. (y=${(y_b*100).toFixed(1)}cm)</span>
            <span class="iv" style="font-size:9px">${sb.toFixed(3)} ${fStressLabel()}</span>
          </div>
          <div class="ir" style="padding-left:14px">
            <span class="ik" style="font-size:9px">σ fibra sup. (y=${(y_t*100).toFixed(1)}cm)</span>
            <span class="iv" style="font-size:9px">${st.toFixed(3)} ${fStressLabel()}</span>
          </div>`;
        }).join('');
        const nLabel = N_s !== 0 ? ` &nbsp;·&nbsp; N=${fForceFromSI(N_s).toFixed(2)} ${fForceLabel()}` : '';
        document.getElementById('fCompPanel').style.display = '';
        document.getElementById('fCompPanel').innerHTML =
          `<div class="bgrid"><div class="ic" style="grid-column:1/-1">
             <p class="it">σ por capa &nbsp;·&nbsp; M en x=${(MMaxIdx*le).toFixed(3)} m = ${fMomentFromSI(M_max).toFixed(3)} ${fMomentLabel()} &nbsp;·&nbsp; Ȳ = ${(cp.yc*100).toFixed(2)} cm (filo inf.)${nLabel}</p>
             ${rowsHTML}
           </div></div>`;
      }
    } else {
      document.getElementById('fCompPanel').style.display = 'none';
    }
  }

  // σ_max: scan all nodes — σ = N/A ± M·c/I at extreme fibers
  const sigma_crit_nodes = new Float64Array(nEl + 1);
  for (let ni = 0; ni <= nEl; ni++) {
    const xm = ni * le;
    const s = fSegs.find(s => xm >= s.xa-1e-9 && xm <= s.xb+1e-9) || fSegs[fSegs.length-1];
    const M_ni = M_nodes[ni];
    const e_ni = Math.min(Math.max(Math.floor(xm / le), 0), nEl - 1);
    const N_ni = N_elem_arr[e_ni] || 0;
    const props_ni = fSecProps(s);
    const sigma_N_ni = props_ni.A > 0 ? N_ni / props_ni.A : 0;
    let H_total_ni;
    if      (s.secType==='circ')                       H_total_ni = s.d||0.05;
    else if (s.secType==='rect')                       H_total_ni = s.h||0.10;
    else if (s.secType==='Isym')                       H_total_ni = 2*(s.tf||0.01)+(s.hw||0.10);
    else if (s.secType==='Tsec'||s.secType==='Tinv')   H_total_ni = (s.tf||0.01)+(s.hw||0.10);
    else if (s.secType==='composite')                  H_total_ni = props_ni.H_tot||0.10;
    else                                               H_total_ni = s.h||0.10;
    const c_top_ni = H_total_ni - props_ni.yc;
    const c_bot_ni = props_ni.yc;
    const sig_top_ni = (props_ni.Ix > 0 ? -M_ni * c_top_ni / props_ni.Ix : 0) + sigma_N_ni;
    const sig_bot_ni = (props_ni.Ix > 0 ?  M_ni * c_bot_ni / props_ni.Ix : 0) + sigma_N_ni;
    const localMax = Math.max(Math.abs(sig_top_ni), Math.abs(sig_bot_ni));
    if (localMax > sigmaMax) sigmaMax = localMax;
    // Store signed stress of the critical (highest |σ|) fiber
    sigma_crit_nodes[ni] = Math.abs(sig_top_ni) >= Math.abs(sig_bot_ni) ? sig_top_ni : sig_bot_ni;
  }

  // Display conversions — use nodal arrays for smooth diagrams
  const disp_v    = Array.from(v_nodes).map(v => fDeflFromSI(v));
  const disp_th   = Array.from(th_nodes).map(t => t*1000);         // rad → mrad
  const disp_M    = Array.from(M_nodes).map(v => fMomentFromSI(v));
  const disp_qVis = Array.from(qVis).map(v => fForceFromSI(v));
  const disp_tau_max_elem  = Array.from(tau_max_elem).map(v => fStressFromSI(v));
  const disp_sigma_crit    = Array.from(sigma_crit_nodes).map(v => fStressFromSI(v));
  const disp_N    = Array.from(N_elem_arr).map(v => fForceFromSI(v));

  const disp_sigMax = fStressFromSI(sigmaMax);
  const disp_tauMax = fStressFromSI(Math.max(...tau_max_elem));
  const NMax        = Math.max(...Array.from(N_elem_arr).map(Math.abs));

  // Store results
  fLastSolveData = { v_nodes, th_nodes, M_nodes, V_nodes, M_elem, EIe, le, nEl, L, reactions, fixedDofs, rawSprings, N_elem_arr, V_right, V_left };

  // Show results
  document.getElementById('fEmptyState').style.display = 'none';
  document.getElementById('flexResContent').style.display = '';

  // Metric cards
  const MMaxDisp = fMomentFromSI(MMax);
  const VMaxDisp = fForceFromSI(VMax);
  document.getElementById('fMrow').innerHTML = [
    {l:'v máx',   v:fDeflFmt(vMax),            u:fDeflLabel(),    h:false},
    {l:'θ máx',   v:(thMax*1000).toFixed(4),   u:'mrad',          h:false},
    {l:'M máx',   v:MMaxDisp.toFixed(3),        u:fMomentLabel(),  h:false},
    {l:'V máx',   v:VMaxDisp.toFixed(3),        u:fForceLabel(),   h:false},
    {l:'σ_f máx', v:disp_sigMax.toFixed(3),     u:fStressLabel(),  h:true },
    {l:'τ_v máx', v:disp_tauMax.toFixed(3),     u:fStressLabel(),  h:true },
  ].map(m=>`<div class="met${m.h?' hi':''}"><p class="ml">${m.l}</p><p class="mv${m.h?' hi':''}">${m.v}<span class="mu"> ${m.u}</span></p></div>`).join('');

  // All diagrams use nodal coordinates xs_n for smooth continuous curves
  const xs_n = Array.from({length:nEl+1}, (_,i)=>(i*le).toFixed(5));
  const xs_e = Array.from({length:nEl},   (_,i)=>((i+0.5)*le).toFixed(5));

  const decM = MMaxDisp < 0.01 ? 6 : MMaxDisp < 1 ? 4 : 2;
  const decV = VMaxDisp < 0.01 ? 6 : VMaxDisp < 1 ? 4 : 2;
  const decTau = disp_tauMax < 0.01 ? 6 : disp_tauMax < 1 ? 4 : 3;
  const decSig = disp_sigMax < 0.01 ? 6 : disp_sigMax < 1 ? 4 : 3;

  const decN = NMax > 0 ? (fForceFromSI(NMax) < 0.01 ? 6 : fForceFromSI(NMax) < 1 ? 4 : 2) : 2;
  fMkChart('fcQ',    xs_e, disp_qVis, '#50d4b8', fFpLLabel(),      false, 2, false, 0.35, true);
  fMkChart('fcV',    xs_n, disp_v,    '#60b8f5', fDeflLabel(),     false, 4);
  fMkChart('fcTheta',xs_n, disp_th,   '#50d4b8', 'mrad',           false, 4);
  fMkChart('fcM',    xs_n, disp_M,    '#f5c842', fMomentLabel(),   false, decM, true);
  fMkChart('fcV2',   xs_v, V_data,    '#f07070', fForceLabel(),    false, decV, false, 0);
  fMkChart('fcTau',  xs_e, disp_tau_max_elem, '#f0a060', fStressLabel(), false, decTau, false, 0.35, true);
  fMkChart('fcSig',  xs_n, disp_sigma_crit,  '#e06090', fStressLabel(), false, decSig, true);
  // DFN — N(x) per element (stepped, since N is piecewise constant)
  const fcNel = document.getElementById('fcN');
  if (fcNel) {
    if (NMax > 1e-6) {
      fMkChart('fcN', xs_e, disp_N, '#b090f5', fForceLabel(), true, decN, false, 0, true);
    } else if (fCharts['fcN']) { fCharts['fcN'].destroy(); delete fCharts['fcN']; }
    const fUlNel = document.getElementById('fUlN');
    if (fUlNel) fUlNel.textContent = fForceLabel();
    // Show/hide DFN card based on whether there are axial loads or restrictU supports
    const fNCard = document.getElementById('fNCard');
    if (fNCard) fNCard.style.display = (hasAxialLoads || hasRestrictU) ? '' : 'none';
  }

  // Update unit labels in DOM
  document.getElementById('fUlQ').textContent = fFpLLabel();
  document.getElementById('fUlM').textContent = fMomentLabel();
  document.getElementById('fUlV').textContent = fForceLabel();
  document.getElementById('fUlTauV').textContent = fStressLabel();
  document.getElementById('fUlSig').textContent  = fStressLabel();

  // Reactions panel
  let rHTML = '';
  // Axial reactions (Rx) first
  Object.entries(axialReactions).forEach(([ni, R_SI]) => {
    const xPos = (parseInt(ni) * le).toFixed(4);
    rHTML += `<div class="ir"><span class="ik" style="color:var(--purple)">R_x(x=${xPos})</span><span class="iv">${fForceFromSI(R_SI).toFixed(3)} ${fForceLabel()}</span></div>`;
  });
  fixedDofs.forEach(dof => {
    const node = Math.floor(dof/2);
    const isRot = dof%2===1;
    const xPos = (node*le).toFixed(4);
    const R_SI = reactions[dof] || 0;
    if (!isRot) {
      rHTML += `<div class="ir"><span class="ik">R_y(x=${xPos})</span><span class="iv">${fForceFromSI(R_SI).toFixed(3)} ${fForceLabel()}</span></div>`;
    } else {
      rHTML += `<div class="ir"><span class="ik">M_r(x=${xPos})</span><span class="iv">${fMomentFromSI(R_SI).toFixed(3)} ${fMomentLabel()}</span></div>`;
    }
  });
  // Spring reactions
  rawSprings.forEach(({ dof }) => {
    const node = Math.floor(dof/2);
    const isRot = dof%2===1;
    const xPos = (node*le).toFixed(4);
    const R_SI = reactions[dof] || 0;
    if (!isRot) {
      rHTML += `<div class="ir"><span class="ik" style="color:var(--orange)">R_y⌇(x=${xPos})</span><span class="iv">${fForceFromSI(R_SI).toFixed(3)} ${fForceLabel()}</span></div>`;
    } else {
      rHTML += `<div class="ir"><span class="ik" style="color:var(--orange)">M_r⌇(x=${xPos})</span><span class="iv">${fMomentFromSI(R_SI).toFixed(3)} ${fMomentLabel()}</span></div>`;
    }
  });
  document.getElementById('fTReact').innerHTML = rHTML || '<div class="ir"><span class="ik">Sin reacciones</span></div>';

  // Equilibrium check (loads already in SI)
  const totalQ = Array.from(fLoads).reduce((s,l) => {
    if(l.tipo==='pun') return s + (+l.val||0);
    if(l.tipo==='dis') return s + (+l.val||0)*(l.xb-l.xa);
    if(l.tipo==='tri') return s + ((+l.va||0)+(+l.vb||0))/2*(l.xb-l.xa);
    if(l.tipo==='pol') {
      // Integrate q(x) numerically over [xa, xb] with 20-point midpoint rule
      const nI=20, xa_p=+l.xa||0, xb_p=+l.xb||L, dx=(xb_p-xa_p)/nI;
      let sum=0;
      for(let k=0;k<nI;k++){
        const xk=xa_p+(k+0.5)*dx;
        const v=evalExpr(l.expr,xk,L);
        if(!isNaN(v)) sum+=fForceToSI(v)*dx;
      }
      return s + sum;
    }
    return s;
  }, 0);
  const totalR_SI = [
    ...fixedDofs.filter(d=>d%2===0),
    ...rawSprings.filter(sp=>sp.dof%2===0).map(sp=>sp.dof)
  ].reduce((s,d)=>s+(reactions[d]||0),0);
  const hasTransverseLoad = Math.abs(totalQ) > 1e-10;
  if (!hasTransverseLoad) {
    // Solo momentos o gradiente térmico: ΣFy no aplica (no hay fuerzas transversales)
    document.getElementById('fTEq').innerHTML = `
      <div class="ir"><span class="ik">Carga transversal</span><span class="iv">0 ${fForceLabel()}</span></div>
      <div class="ir"><span class="ik">Equilibrio ΣFy</span><span class="iv ok">N/A — carga es momento/térmica</span></div>`;
  } else {
    const eqErr = Math.abs(totalQ+totalR_SI)/(Math.abs(totalQ)+Math.abs(totalR_SI)+1e-10);
    document.getElementById('fTEq').innerHTML = `
      <div class="ir"><span class="ik">Carga total</span><span class="iv">${fForceFromSI(totalQ).toFixed(3)} ${fForceLabel()}</span></div>
      <div class="ir"><span class="ik">Reac. total</span><span class="iv">${fForceFromSI(totalR_SI).toFixed(3)} ${fForceLabel()}</span></div>
      <div class="ir"><span class="ik">Error</span><span class="iv ${eqErr<0.01?'ok':'warn'}">${(eqErr*100).toFixed(3)}%</span></div>`;
    if (eqErr > 0.05) fShowErr(`Advertencia: error de equilibrio = ${(eqErr*100).toFixed(1)}%. Verifica los apoyos y el modelo (esto no impide ver los resultados, pero puede indicar un modelo incorrecto).`);
  }

  const vMaxIdx  = Array.from(v_nodes).reduce((mi,v,i,a)=>Math.abs(v)>Math.abs(a[mi])?i:mi,0);
  const MMaxIdxN = Array.from(M_nodes).reduce((mi,v,i,a)=>Math.abs(v)>Math.abs(a[mi])?i:mi,0);
  document.getElementById('fTMax').innerHTML = `
    <div class="ir"><span class="ik">x(v máx)</span><span class="iv">${(vMaxIdx*le).toFixed(4)} m</span></div>
    <div class="ir"><span class="ik">v máx</span><span class="iv" style="color:var(--blue)">${fDeflFmt(vMax)} ${fDeflLabel()}</span></div>
    <div class="ir"><span class="ik">x(M máx)</span><span class="iv">${(MMaxIdxN*le).toFixed(4)} m</span></div>
    <div class="ir"><span class="ik">M máx</span><span class="iv" style="color:var(--acc)">${MMaxDisp.toFixed(3)} ${fMomentLabel()}</span></div>
    <div class="ir"><span class="ik">σ_f máx</span><span class="iv" style="color:var(--orange)">${disp_sigMax.toFixed(3)} ${fStressLabel()}</span></div>`;

  _fSecCache = null;   // release solve cache so interactive features recompute freely

  setTimeout(() => drawBeamDiagram(), 60);

  // Recompute rasante if a cut was already set
  if (fRasYcut !== null) setTimeout(fComputeRasante, 80);
}

// ── FLEXION CHARTS ─────────────────────────────────────────────
function fMkChart(id, labels, data, color, yLbl, stepped, dec, reverseY = false, tension = 0.35, includeZero = false) {
  if (fCharts[id]) fCharts[id].destroy();
  dec = dec !== undefined ? dec : 3;
  const n = data.length;
  if (!n) return;

  let maxIdx=0, minIdx=0;
  for(let i=1;i<n;i++){if(data[i]>data[maxIdx])maxIdx=i;if(data[i]<data[minIdx])minIdx=i;}

  const threshold = Math.max(...data.map(Math.abs))*0.001;
  const annotations = {};
  const added = new Set();
  [[maxIdx,'center',true],[minIdx,'center',false],[0,'center',data[0]>=0],[n-1,'center',data[n-1]>=0]].forEach(([idx,pos,up],ci)=>{
    if(added.has(idx))return;
    let tooClose=false;
    for(const ai of added){if(Math.abs(ai-idx)<Math.floor(n/8)){tooClose=true;break;}}
    if(tooClose&&ci!==0)return;
    added.add(idx);
    const val=data[idx];
    if(Math.abs(val)<threshold&&threshold>0)return;
    annotations['pt'+idx]={type:'point',xValue:labels[idx],yValue:val,radius:4,backgroundColor:color,borderColor:'#0d0d0d',borderWidth:2,
      label:{display:true,content:fmtVal(val,dec)+' '+yLbl,position:pos,backgroundColor:'#1b1b1b',borderColor:color+'60',borderWidth:1,borderRadius:3,color,font:{family:'DM Mono,monospace',size:10},padding:{x:5,y:3},xAdjust:0,yAdjust:up?-18:18}};
  });

  const hasNeg=data.some(v=>v<-threshold), hasPos=data.some(v=>v>threshold);
  if(hasNeg&&hasPos) annotations['zero']={type:'line',yMin:0,yMax:0,borderColor:'rgba(255,255,255,0.08)',borderWidth:1,borderDash:[4,3]};

  const selIdx = fSelectedPoints[id];
  if(selIdx!==undefined&&selIdx>=0&&selIdx<data.length){
    annotations['selLine']={type:'line',xMin:labels[selIdx],xMax:labels[selIdx],borderColor:color,borderWidth:1,borderDash:[3,3]};
    annotations['selPt']={type:'point',xValue:labels[selIdx],yValue:data[selIdx],radius:5,backgroundColor:'#ffffff',borderColor:color,borderWidth:2};
    annotations['selLbl']={type:'label',xValue:labels[selIdx],yValue:data[selIdx],backgroundColor:'#111',borderColor:color,borderWidth:1,color:'#f1eee8',borderRadius:6,padding:6,
      content:[`x = ${parseFloat(labels[selIdx]).toFixed(4)} m`,`y = ${fmtVal(data[selIdx],dec)} ${yLbl}`],font:{family:'DM Mono,monospace',size:10},position:{x:'start',y:'top'},xAdjust:10,yAdjust:-10};
  }

  const yMin=Math.min(...data),yMax=Math.max(...data),yMid=(yMin+yMax)/2;
  const yAbs=Math.max(Math.abs(yMid),Math.abs(yMax),Math.abs(yMin));
  const relRange=yAbs>1e-30?(yMax-yMin)/yAbs:0;
  const yConfig={grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#505048',font:{family:'DM Mono,monospace',size:10},maxTicksLimit:5}};
  if(relRange<0.001&&yAbs>1e-30){const span=Math.max(yAbs*0.05,1e-6);yConfig.min=yMid-span;yConfig.max=yMid+span;yConfig.ticks.callback=v=>parseFloat(v.toPrecision(6));}
  if(reverseY) yConfig.reverse = true;
  if(includeZero){
    yConfig.min = Math.min(0, yMin);   // hard floor at 0
    delete yConfig.max;                // cancel narrow-range zoom ceiling
    yConfig.suggestedMax = yMax > 0 ? yMax * 1.15 : 0;
  }

  const chart = new Chart(document.getElementById(id), {
    type:'line',
    data:{labels,datasets:[{data,borderColor:color,backgroundColor:color+'14',fill:true,tension:stepped?0:tension,pointRadius:0,pointHoverRadius:4,pointHitRadius:12,borderWidth:1.5,stepped:stepped||false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:280},interaction:{mode:'nearest',intersect:false},
      onClick:(evt,elements,ci)=>{
        const pts=ci.getElementsAtEventForMode(evt,'nearest',{intersect:false},true);
        if(pts.length){
          fSelectedPoints[id]=pts[0].index;
          fLastClickedChart = id;
          fMkChart(id,labels,data,color,yLbl,stepped,dec,reverseY,tension,includeZero);
          drawBeamDiagram();
        }
      },
      onHover:(event,active,ci)=>{ci.canvas.style.cursor=active.length?'crosshair':'default';},
      plugins:{legend:{display:false},annotation:{annotations},
        tooltip:{enabled:true,backgroundColor:'#1b1b1b',borderColor:'rgba(255,255,255,0.07)',borderWidth:1,titleColor:'#8c8880',bodyColor:'#ede9e3',
          titleFont:{family:'DM Mono',size:10},bodyFont:{family:'DM Mono',size:12},
          callbacks:{title:items=>`x = ${parseFloat(items[0].label).toFixed(4)} m`,label:c=>`y = ${fmtVal(c.parsed.y,dec)} ${yLbl}`}}},
      scales:{x:{grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#505048',font:{family:'DM Mono,monospace',size:10},maxTicksLimit:6,callback:v=>parseFloat(v).toFixed(3)}},y:yConfig}
    }
  });
  fCharts[id] = chart;
}

// ── BEAM DIAGRAM CANVAS ────────────────────────────────────────
function drawBeamDiagram() {
  const cvs = document.getElementById('cvBeam');
  if (!cvs) return;
  const W = (cvs.parentElement ? cvs.parentElement.clientWidth : 600) || 600;
  const H = 160;
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const L = fGetL() || 1;
  const PAD = 40;
  const bY = H/2 + 8;   // shifted down slightly for room above
  const bH = 20;
  const bX1 = PAD, bX2 = W - PAD;
  const bW = bX2 - bX1;
  const toX = x => bX1 + (x/L)*bW;

  // Draw beam body
  if (!fSegs.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bX1, bY - bH/2, bW, bH);
  } else {
    const pal = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];
    fSegs.forEach((s,i) => {
      const x1 = toX(s.xa), x2 = toX(s.xb);
      const col = pal[i%pal.length];
      ctx.fillStyle = col+'28';
      ctx.fillRect(x1, bY-bH/2, x2-x1, bH);
      ctx.strokeStyle = col+'80';
      ctx.lineWidth=1;
      ctx.strokeRect(x1, bY-bH/2, x2-x1, bH);
    });
  }

  // Supports (BC)
  // Pin support: upward-pointing triangle △ sitting on the beam
  function drawPinSupport(x) {
    const tip = bY + bH/2;       // triangle tip touches bottom of beam
    const base = tip + 16;       // base of triangle below beam
    const hw = 10;               // half-width of base

    // Filled triangle
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x - hw, base);
    ctx.lineTo(x + hw, base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(96,184,245,0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(96,184,245,0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Base line under triangle
    ctx.beginPath();
    ctx.moveTo(x - hw - 3, base + 2);
    ctx.lineTo(x + hw + 3, base + 2);
    ctx.strokeStyle = 'rgba(96,184,245,0.50)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawFixedSupport(x, side) {
    const w = 9, hh = bH + 14;
    const rx = side === 'left' ? x - w : x;
    ctx.fillStyle = 'rgba(96,184,245,0.18)';
    ctx.fillRect(rx, bY - hh/2, w, hh);
    ctx.strokeStyle = 'rgba(96,184,245,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, bY - hh/2, w, hh);
    // hatching lines
    ctx.strokeStyle = 'rgba(96,184,245,0.35)';
    ctx.lineWidth = 1;
    const step = 5;
    for (let yy = bY - hh/2 + step; yy < bY + hh/2; yy += step) {
      const dx = side === 'left' ? -5 : 5;
      ctx.beginPath();
      ctx.moveTo(side === 'left' ? rx : rx + w, yy);
      ctx.lineTo(side === 'left' ? rx - dx : rx + w + dx, yy + 4);
      ctx.stroke();
    }
  }


// Empotrado en posición intermedia: placa horizontal con rayas debajo
  function drawFixedSupportBelow(x) {
    const tip  = bY + bH / 2;
    const base = tip + 14;
    const hw   = 14;
    ctx.strokeStyle = 'rgba(96,184,245,0.85)';
    ctx.lineWidth   = 1.8;
    ctx.beginPath(); ctx.moveTo(x, tip); ctx.lineTo(x, base); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - hw, base); ctx.lineTo(x + hw, base); ctx.stroke();
    ctx.strokeStyle = 'rgba(96,184,245,0.35)';
    ctx.lineWidth = 1;
    for (let xx = x - hw; xx <= x + hw + 1; xx += 5) {
      ctx.beginPath(); ctx.moveTo(xx, base); ctx.lineTo(xx - 4, base + 5); ctx.stroke();
    }
  }

  // Deslizadera: guías horizontales a los lados + pared con rayas
  function drawGuideSupport(x) {
    const rail = 5;
    const hw   = 11;
    const yTop = bY - bH / 2 - rail;
    const yBot = bY + bH / 2 + rail;
    ctx.strokeStyle = 'rgba(96,184,245,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(x - hw, yTop); ctx.lineTo(x + hw, yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - hw, yBot); ctx.lineTo(x + hw, yBot); ctx.stroke();
    const wx = x + hw + 3;
    ctx.strokeStyle = 'rgba(96,184,245,0.85)';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(wx, yTop - 4); ctx.lineTo(wx, yBot + 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(96,184,245,0.35)';
    ctx.lineWidth = 1;
    for (let yy = yTop - 2; yy <= yBot + 5; yy += 5) {
      ctx.beginPath(); ctx.moveTo(wx, yy); ctx.lineTo(wx + 5, yy - 4); ctx.stroke();
    }
  }

  // Resorte vertical: zigzag naranja bajando desde el nodo
  function drawSpringV(x) {
    const tip  = bY + bH / 2;
    const nCoil = 4, coilH = 4, coilW = 6;
    ctx.strokeStyle = 'rgba(240,160,96,0.90)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x, tip + 3); // short stem
    let yy = tip + 3;
    for (let i = 0; i < nCoil * 2; i++) {
      yy += coilH;
      ctx.lineTo(x + (i % 2 === 0 ? coilW : -coilW), yy);
    }
    ctx.lineTo(x, yy + 3); // bottom stem
    ctx.stroke();
    // ground line
    const gY = yy + 3, hw = 8;
    ctx.beginPath(); ctx.moveTo(x - hw, gY); ctx.lineTo(x + hw, gY); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,160,96,0.35)';
    ctx.lineWidth = 1;
    for (let xx = x - hw; xx <= x + hw; xx += 4) {
      ctx.beginPath(); ctx.moveTo(xx, gY); ctx.lineTo(xx - 3, gY + 5); ctx.stroke();
    }
  }

  // Dibuja el símbolo clásico de resorte rotacional (círculo + espiral interior)
  // yConnect = coordenada Y donde la viga/apoyo conecta con el resorte (arriba del círculo)
  // Retorna la Y inferior del círculo
  function drawRotCoil(x, yConnect) {
    const r = 6;
    const cy = yConnect + r; // centro del círculo
    ctx.strokeStyle = 'rgba(240,160,96,0.90)';
    ctx.lineWidth = 1.5;
    // Círculo exterior
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Espiral interior (sentido antihorario, radio decreciente)
    ctx.beginPath();
    const steps = 90, nTurns = 1.8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = -Math.PI / 2 + t * nTurns * Math.PI * 2;
      const rr = (r - 1.5) * (1 - t * 0.5);
      const px2 = x + rr * Math.cos(angle);
      const py2 = cy + rr * Math.sin(angle);
      if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
    ctx.stroke();
    return cy + r; // Y inferior del círculo
  }

  // Rodillo: triángulo + círculos en la base (solo restringe V)
  function drawRollerSupport(x) {
    const tip  = bY + bH / 2;
    const base = tip + 16;
    const hw   = 10;
    ctx.beginPath();
    ctx.moveTo(x, tip);
    ctx.lineTo(x - hw, base);
    ctx.lineTo(x + hw, base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(96,184,245,0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(96,184,245,0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Círculos pequeños (rodillos)
    const r  = 3;
    const cy = base + r + 2;
    [-6, 0, 6].forEach(dx => {
      ctx.beginPath();
      ctx.arc(x + dx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(96,184,245,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
    // Línea de suelo bajo los rodillos
    ctx.beginPath();
    ctx.moveTo(x - hw - 3, cy + r + 2);
    ctx.lineTo(x + hw + 3, cy + r + 2);
    ctx.strokeStyle = 'rgba(96,184,245,0.50)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Triángulo de apoyo simple con punta en yTip (permite colocarlo debajo del resorte)
  function drawPinFromY(x, yTip) {
    const base = yTip + 14, hw = 10;
    ctx.fillStyle = 'rgba(96,184,245,0.18)';
    ctx.beginPath(); ctx.moveTo(x, yTip); ctx.lineTo(x - hw, base); ctx.lineTo(x + hw, base); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(96,184,245,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - hw - 3, base + 2); ctx.lineTo(x + hw + 3, base + 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(96,184,245,0.35)'; ctx.lineWidth = 1;
    for (let xx = x - hw - 2; xx <= x + hw + 2; xx += 4) {
      ctx.beginPath(); ctx.moveTo(xx, base + 2); ctx.lineTo(xx + 3, base + 7); ctx.stroke();
    }
  }

  // Resorte rotacional standalone (slider + coil): guías horizontales + círculo espiral debajo
  function drawSpringT(x) {
    const rail = 4, hw = 10;
    const yTop = bY - bH / 2 - rail;
    const yBot = bY + bH / 2 + rail;
    // Guías horizontales (libertad de deslizamiento horizontal)
    ctx.strokeStyle = 'rgba(240,160,96,0.50)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - hw, yTop); ctx.lineTo(x + hw, yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - hw, yBot); ctx.lineTo(x + hw, yBot); ctx.stroke();
    // Vástago corto de la viga al resorte
    ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, yBot); ctx.lineTo(x, yBot + 1); ctx.stroke();
    // Símbolo de resorte rotacional
    const yCircBot = drawRotCoil(x, yBot + 1);
    // Placa de suelo
    const gY = yCircBot + 3, ghw = 8;
    ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, yCircBot); ctx.lineTo(x, gY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - ghw, gY); ctx.lineTo(x + ghw, gY); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,160,96,0.35)'; ctx.lineWidth = 1;
    for (let xx = x - ghw; xx <= x + ghw; xx += 4) {
      ctx.beginPath(); ctx.moveTo(xx, gY); ctx.lineTo(xx - 3, gY + 5); ctx.stroke();
    }
  }

  // Dibujar cada apoyo en su posición x real
  fSupports.forEach(sup => {
    const px = toX(sup.x);
    const hasSpringV = sup.restrictV     && sup.kV     != null;
    const hasSpringT = sup.restrictTheta && sup.kTheta != null;
    const rigidV     = sup.restrictV     && sup.kV     == null;
    const rigidT     = sup.restrictTheta && sup.kTheta == null;

    if (rigidV && rigidT) {
      // Empotrado puro — sin resortes
      if      (sup.x < 1e-9)       drawFixedSupport(px, 'left');
      else if (sup.x >= L - 1e-9)  drawFixedSupport(px, 'right');
      else                          drawFixedSupportBelow(px);

    } else if (rigidV && hasSpringT) {
      // Traslación rígida + resorte rotacional: coil entre viga y triángulo
      const beamBot = bY + bH / 2;
      ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, beamBot); ctx.lineTo(px, beamBot + 1); ctx.stroke();
      const yCircBot = drawRotCoil(px, beamBot + 1);
      // vástago corto al triángulo
      ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, yCircBot); ctx.lineTo(px, yCircBot + 2); ctx.stroke();
      drawPinFromY(px, yCircBot + 2);

    } else if (hasSpringV && rigidT) {
      drawSpringV(px);
      drawGuideSupport(px);

    } else if (hasSpringV && hasSpringT) {
      // Resorte vertical + resorte rotacional
      drawSpringV(px);
      // Coil encima del zigzag vertical (en la zona de la viga)
      ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, bY - bH/2 - 14); ctx.lineTo(px, bY - bH/2 - 13); ctx.stroke();
      drawRotCoil(px, bY - bH/2 - 13);

    } else if (rigidV) {
      if (sup.restrictU) drawPinFromY(px, bY + bH / 2);  // pin: triángulo + rayas
      else               drawRollerSupport(px);            // rodillo: triángulo + círculos
    } else if (hasSpringV) {
      drawSpringV(px);
    } else if (rigidT) {
      drawGuideSupport(px);
    } else if (hasSpringT) {
      drawSpringT(px);
    }

    // ── Símbolo de asentamiento ────────────────────────────────
    // Flecha discontinua + etiqueta δ bajo el apoyo si hay asentamiento prescrito
    const dv = sup.deltaV || 0;
    const dt = sup.deltaTheta || 0;
    if (rigidV && Math.abs(dv) > 1e-12) {
      const dvLbl = fDeltaVFmt(Math.abs(dv)) + ' ' + fDeltaVLabel();
      const yBase = bY + bH / 2 + 34;   // debajo del símbolo de apoyo
      const yTip  = yBase + 14;
      const arDir = dv > 0 ? 1 : -1;    // positivo = hacia abajo (hundimiento)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,180,60,0.90)';
      ctx.fillStyle   = 'rgba(255,180,60,0.90)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(px, yBase); ctx.lineTo(px, yTip - arDir * 6); ctx.stroke();
      ctx.setLineDash([]);
      // punta de flecha
      ctx.beginPath();
      ctx.moveTo(px, yTip);
      ctx.lineTo(px - 4, yTip - arDir * 7);
      ctx.lineTo(px + 4, yTip - arDir * 7);
      ctx.closePath(); ctx.fill();
      // etiqueta
      ctx.font = '9px DM Mono,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u03b4\u1d65=' + (dv > 0 ? '' : '-') + dvLbl, px, yTip + arDir * 10);
      ctx.restore();
    }
    if (rigidT && Math.abs(dt) > 1e-12) {
      const dtLbl = fDeltaRFmt(Math.abs(dt)) + ' ' + fDeltaRLabel();
      const yAnn = bY + bH / 2 + 50;
      ctx.save();
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = 'rgba(255,180,60,0.90)';
      ctx.textAlign = 'center';
      ctx.fillText('\u03b4\u03b8=' + (dt > 0 ? '+' : '') + (dt > 0 ? dtLbl : '-' + dtLbl), px, yAnn);
      ctx.restore();
    }
    // ↔ u=0 indicator on beam midline
    if (sup.restrictU) {
      ctx.save();
      ctx.strokeStyle = 'rgba(176,144,245,0.80)';
      ctx.fillStyle   = 'rgba(176,144,245,0.80)';
      ctx.lineWidth = 1.5;
      // Short doubled horizontal bar at beam midline to signify u=0 wall
      ctx.beginPath(); ctx.moveTo(px - 8, bY - 8); ctx.lineTo(px - 8, bY + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 9, bY - 8); ctx.lineTo(px - 9, bY + 8); ctx.stroke();
      // Small horizontal double-headed arrow
      ctx.beginPath(); ctx.moveTo(px - 8, bY); ctx.lineTo(px + 5, bY); ctx.stroke();
      ctx.font = '8px DM Mono,monospace'; ctx.textAlign = 'center';
      ctx.fillText('u=0', px, bY + bH/2 + 13);
      ctx.restore();
    }
  });

  // Draw loads
  fLoads.forEach(l => {
    ctx.strokeStyle='rgba(80,212,184,0.85)'; ctx.fillStyle='rgba(80,212,184,0.85)';
    if (l.tipo==='pun') {
      const x=toX(+l.x||0);
      // ↑+ convention: positive=upward → arrow from below (dir=+1); negative=downward → from above (dir=-1)
      const dir = l.val > 0 ? 1 : -1;
      const surf = bY + dir * bH/2;   // beam surface on the load side
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(x, surf + dir*28); ctx.lineTo(x, surf); ctx.stroke();
      // Arrowhead: point at surf, base away from beam (dir*AH from surf = same side as tail)
      const AH=8;
      ctx.beginPath();
      ctx.moveTo(x, surf);
      ctx.lineTo(x-4, surf + dir*AH);
      ctx.lineTo(x+4, surf + dir*AH);
      ctx.closePath(); ctx.fill();
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle='rgba(80,212,184,0.9)'; ctx.textAlign='center';
      ctx.fillText(fmtSciPreview(l.val), x, surf + dir*40);

    } else if (l.tipo==='mom') {
      const x    = toX(+l.x || 0);
      const R    = 18;
      const surf = bY - bH/2;         // beam top surface
      const pos  = (+l.val || 0) >= 0; // ↺+ convention

      ctx.strokeStyle = 'rgba(176,144,245,0.90)';
      ctx.fillStyle   = 'rgba(176,144,245,0.90)';
      ctx.lineWidth   = 1.8;

      if (pos) {
        // ↺ CCW: arc from right (0) to left (π), over the top
        ctx.beginPath();
        ctx.arc(x, surf, R, 0, Math.PI, true);
        ctx.stroke();
        // Arrowhead at left end (x-R, surf): tip at surf, base 9px above
        ctx.beginPath();
        ctx.moveTo(x - R, surf);
        ctx.lineTo(x - R - 5, surf - 9);
        ctx.lineTo(x - R + 5, surf - 9);
        ctx.closePath(); ctx.fill();
      } else {
        // ↻ CW: arc from left (π) to right (0), over the top
        ctx.beginPath();
        ctx.arc(x, surf, R, Math.PI, 0, false);
        ctx.stroke();
        // Arrowhead at right end (x+R, surf)
        ctx.beginPath();
        ctx.moveTo(x + R, surf);
        ctx.lineTo(x + R - 5, surf - 9);
        ctx.lineTo(x + R + 5, surf - 9);
        ctx.closePath(); ctx.fill();
      }

      // Value label above arc
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = 'rgba(176,144,245,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(fmtSciPreview(Math.abs(+l.val || 0)) + ' ' + fMomentLabel(), x, surf - R - 5);

    } else if (l.tipo==='dis' || l.tipo==='pol') {
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const rawVal = l.tipo==='pol' ? (evalExpr(l.expr,(+l.xa+(+l.xb||L))/2,L)||0) : (+l.val||0);
      // ↑+ convention: positive=upward → from below (dir=+1); negative=downward → from above (dir=-1)
      const dir = rawVal > 0 ? 1 : -1;
      const H_ARR = 30;
      const AH    = 5;
      const surf  = bY + dir * bH/2;
      const tailY = surf + dir * H_ARR;

      // Connecting line along tails
      ctx.strokeStyle='rgba(80,212,184,0.75)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(x1, tailY); ctx.lineTo(x2, tailY); ctx.stroke();

      // Arrows with arrowheads every 10px
      ctx.strokeStyle='rgba(80,212,184,0.55)'; ctx.fillStyle='rgba(80,212,184,0.80)';
      ctx.lineWidth=1;
      for (let px=x1; px<=x2+0.5; px+=10) {
        ctx.beginPath(); ctx.moveTo(px, tailY); ctx.lineTo(px, surf); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px, surf);
        ctx.lineTo(px - AH/2, surf + dir*AH);
        ctx.lineTo(px + AH/2, surf + dir*AH);
        ctx.closePath(); ctx.fill();
      }

      // Value label beyond the connecting line
      const lbl = l.tipo==='pol' ? (l.expr||'q(x)') : fmtSciPreview(l.val);
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle='rgba(80,212,184,0.9)'; ctx.textAlign='center';
      ctx.fillText(lbl, (x1+x2)/2, tailY + dir*11);

    } else if (l.tipo==='tri') {
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const va=+l.va||0, vb=+l.vb||0;
      const H_MAX = 32;
      const AH    = 5;
      const maxAbs = Math.max(Math.abs(va), Math.abs(vb)) || 1;
      // ↑+ convention: dominant positive → from below (domDir=+1)
      const domVal = Math.abs(va) >= Math.abs(vb) ? (va||vb) : (vb||va);
      const domDir = domVal > 0 ? 1 : -1;
      const surf   = bY + domDir * bH/2;
      const haA = H_MAX * Math.abs(va) / maxAbs;
      const haB = H_MAX * Math.abs(vb) / maxAbs;
      const tipA = surf + domDir * haA;
      const tipB = surf + domDir * haB;

      // Filled silhouette polygon
      ctx.beginPath();
      ctx.moveTo(x1, surf); ctx.lineTo(x1, tipA);
      ctx.lineTo(x2, tipB); ctx.lineTo(x2, surf);
      ctx.closePath();
      ctx.fillStyle='rgba(80,212,184,0.12)'; ctx.fill();
      ctx.strokeStyle='rgba(80,212,184,0.60)'; ctx.lineWidth=1; ctx.stroke();

      // Arrows with arrowheads at proportional heights
      const nArr = Math.max(3, Math.round((x2-x1)/10));
      ctx.strokeStyle='rgba(80,212,184,0.50)'; ctx.fillStyle='rgba(80,212,184,0.70)';
      ctx.lineWidth=1;
      for (let i=0; i<=nArr; i++) {
        const frac = i / nArr;
        const px   = x1 + (x2-x1)*frac;
        const qv   = va*(1-frac) + vb*frac;
        if (Math.abs(qv) < 1e-12*maxAbs) continue;
        const h    = H_MAX * Math.abs(qv) / maxAbs;
        const tailY = surf + domDir * h;
        ctx.beginPath(); ctx.moveTo(px, tailY); ctx.lineTo(px, surf); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px, surf);
        ctx.lineTo(px - AH/2, surf + domDir*AH);
        ctx.lineTo(px + AH/2, surf + domDir*AH);
        ctx.closePath(); ctx.fill();
      }

    } else if (l.tipo==='temp') {
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const T_s = +l.T_sup || 0, T_i = +l.T_inf || 0;
      const dT  = T_s - T_i;
      // Colors: hot=orange-red, cold=blue
      const hotC  = 'rgba(240,96,72,0.80)';
      const coldC = 'rgba(72,160,240,0.80)';
      const topC  = dT > 0 ? hotC : (dT < 0 ? coldC : 'rgba(160,160,160,0.5)');
      const botC  = dT > 0 ? coldC : (dT < 0 ? hotC : 'rgba(160,160,160,0.5)');
      const topCSolid = dT > 0 ? 'rgba(240,96,72,1)' : 'rgba(72,160,240,1)';
      const botCSolid = dT > 0 ? 'rgba(72,160,240,1)' : 'rgba(240,96,72,1)';
      // Gradient fill on beam
      const grd = ctx.createLinearGradient(0, bY - bH/2, 0, bY + bH/2);
      grd.addColorStop(0, topC);
      grd.addColorStop(1, botC);
      ctx.fillStyle = grd;
      ctx.fillRect(x1, bY - bH/2, x2 - x1, bH);
      // Border
      ctx.strokeStyle = 'rgba(240,200,100,0.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(x1, bY - bH/2, x2 - x1, bH);

      // ── Labels outside the beam ───────────────────────────────
      const cx2 = (x1 + x2) / 2;
      const yTop = bY - bH/2;
      const yBot = bY + bH/2;
      // Label positions
      const ySupLabel = yTop - 18;   // above beam
      const yInfLabel = yBot + 26;   // below beam (below supports)

      // Tick lines: beam fiber → label
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.moveTo(cx2, yTop); ctx.lineTo(cx2, ySupLabel + 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx2, yBot); ctx.lineTo(cx2, yInfLabel - 10); ctx.stroke();
      ctx.setLineDash([]);

      // T_sup label (above)
      ctx.font = 'bold 11px DM Mono,monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = topCSolid;
      ctx.fillText('T_sup = ' + T_s.toFixed(0) + '\u00B0C', cx2, ySupLabel);

      // T_inf label (below)
      ctx.fillStyle = botCSolid;
      ctx.fillText('T_inf = ' + T_i.toFixed(0) + '\u00B0C', cx2, yInfLabel);

      // Small vertical gradient bar on left edge to reinforce direction
      const barX = x1 - 6, barW = 3, barH2 = bH;
      const grd2 = ctx.createLinearGradient(0, yTop, 0, yBot);
      grd2.addColorStop(0, topC);
      grd2.addColorStop(1, botC);
      ctx.fillStyle = grd2;
      ctx.fillRect(barX, yTop, barW, barH2);
    } else if (l.tipo==='axial') {
      // Horizontal arrow at y = beam midline
      const x = toX(+l.x || 0);
      const val = +l.val || 0;
      const dir = val >= 0 ? 1 : -1;   // +1 = rightward (tracción), -1 = leftward (compresión)
      const AHlen = 28, AHtip = 7;
      const ax1 = x - dir * AHlen, ax2 = x;
      ctx.save();
      ctx.strokeStyle = 'rgba(176,144,245,0.90)';
      ctx.fillStyle   = 'rgba(176,144,245,0.90)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax1, bY); ctx.lineTo(ax2, bY); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax2, bY);
      ctx.lineTo(ax2 - dir * AHtip, bY - AHtip * 0.5);
      ctx.lineTo(ax2 - dir * AHtip, bY + AHtip * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = 'rgba(176,144,245,0.95)';
      ctx.textAlign = dir >= 0 ? 'right' : 'left';
      ctx.fillText('N=' + fmtSciPreview(val), ax1 - dir * 2, bY - 5);
      ctx.restore();
    }
  });

  // Selected x indicator + section viewer
  // Use last clicked chart first so clicking any chart updates the section
  const priorityCharts=['fcN','fcM','fcV2','fcV','fcTheta','fcQ','fcTau','fcSig','fcRas'];
  const orderedCharts = fLastClickedChart
    ? [fLastClickedChart, ...priorityCharts.filter(c=>c!==fLastClickedChart)]
    : priorityCharts;
  let selXm = null;
  for(const cid of orderedCharts){
    if(fSelectedPoints[cid]!==undefined && fLastSolveData){
      const idx=fSelectedPoints[cid];
      const isNode=(cid==='fcV'||cid==='fcTheta'||cid==='fcM');
      selXm = isNode ? idx*fLastSolveData.le : (idx+0.5)*fLastSolveData.le;
      break;
    }
  }
  if(selXm!==null){
    const sx=toX(selXm);
    ctx.strokeStyle='rgba(245,200,66,0.5)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
    ctx.beginPath();ctx.moveTo(sx,4);ctx.lineTo(sx,H-4);ctx.stroke();
    ctx.setLineDash([]);
    document.getElementById('fBeamBadge').textContent='x = '+selXm.toFixed(4)+' m';
    drawFlexSection(selXm);
  } else {
    document.getElementById('fBeamBadge').textContent='—';
    drawFlexSection(null);
  }

  // x-axis labels
  ctx.fillStyle='rgba(255,255,255,0.20)';ctx.font='9px DM Mono,monospace';ctx.textAlign='center';
  ctx.fillText('0',bX1,H-4);ctx.fillText('L='+L.toFixed(3)+'m',bX2,H-4);
}

// ── CROSS-SECTION VIEWER (below cortante, torsion-style) ──────
function fSecGoToX(val) {
  if (!fLastSolveData) return;
  const x = parseFloat(val);
  const L = fLastSolveData.L;
  if (isNaN(x)) return;
  const xClamped = Math.max(0, Math.min(L, x));
  drawFlexSection(xClamped);
}

function drawFlexSection(xPos) {
  const cvs   = document.getElementById('cvFlexSec');
  const info  = document.getElementById('fSecInfo');
  const badge = document.getElementById('fSecBadge');
  const xinput = document.getElementById('fSecXInput');
  if (!cvs || !info) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = cvs.offsetWidth || 600;
  const H   = 280;
  cvs.width  = W * dpr;
  cvs.height = H * dpr;
  cvs.style.height = H + 'px';
  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Background
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'rgba(30,35,45,0.8)');
  bg.addColorStop(1,'rgba(18,22,30,0.8)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0,0,W,H,8); ctx.fill();

  if (!xPos && xPos !== 0) {
    ctx.fillStyle='rgba(255,255,255,0.15)';
    ctx.font='12px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('Haz click en un gráfico para', W/2, H/2-8);
    ctx.fillText('ver la sección transversal', W/2, H/2+10);
    badge.textContent = '—';
    info.innerHTML = '';
    return;
  }

  // Find segment
  const seg   = fSegs.find(s=>xPos>=s.xa-1e-9&&xPos<=s.xb+1e-9) || fSegs[fSegs.length-1];
  const props = fSecProps(seg);
  badge.textContent = 'x = ' + xPos.toFixed(4) + ' m · seg. ' + (fSegs.indexOf(seg)+1);
  if (xinput && document.activeElement !== xinput) xinput.value = xPos.toFixed(4);

  // Section geometry
  let H_tot, B_tot;
  if      (seg.secType==='circ')                         { H_tot=seg.d||0.05;  B_tot=seg.d||0.05; }
  else if (seg.secType==='circH')                        { H_tot=seg.d||0.10;  B_tot=seg.d||0.10; }
  else if (seg.secType==='rect')                         { H_tot=seg.h||0.10;  B_tot=seg.b||0.05; }
  else if (seg.secType==='rectH')                        { H_tot=seg.h||0.20;  B_tot=seg.b||0.10; }
  else if (seg.secType==='Isym')                         { H_tot=2*(seg.tf||0.01)+(seg.hw||0.10); B_tot=seg.bf||0.10; }
  else if (seg.secType==='Tsec'||seg.secType==='Tinv')   { H_tot=(seg.tf||0.01)+(seg.hw||0.10);   B_tot=seg.bf||0.10; }
  else if (seg.secType==='composite') {
    const bounds = fCompositeBounds(seg.layers||[]);
    H_tot = props.H_tot || Math.max(bounds.yMax - bounds.yMin, 0.05);
    B_tot = Math.max(bounds.xMax - bounds.xMin, 0.02);
  }
  else { H_tot=seg.h||0.10; B_tot=seg.b||0.05; }

  // M and V at xPos
  let M_at_x = 0, V_at_x = 0;
  if (fLastSolveData) {
    const { M_nodes, V_nodes, le, nEl } = fLastSolveData;
    const ni = Math.min(Math.round(xPos/le), nEl);
    M_at_x = M_nodes[ni] || 0;
    V_at_x = V_nodes ? (V_nodes[ni] || 0) : 0;
  }

  const isComposite = seg.secType === 'composite';

  // ── 3-zone layout: [ST | σ(y) | τ(y)] ───────────────────────
  const padTop  = 22, padBot = 10, padSide = 8;
  const zW      = W / 3;
  const drawH   = H - padTop - padBot;

  // Scale: fit section entirely in zone 0
  const stAvailW = zW - 2 * padSide;
  let sc = Math.min(stAvailW / B_tot, drawH / H_tot) * 0.85;
  sc = Math.max(sc, 15 / Math.max(B_tot, H_tot));

  const secW = B_tot * sc;
  const secH = H_tot * sc;

  // Common y anchor: vertically centre the section across the full canvas height
  const yBot    = padTop + (drawH + secH) / 2;   // canvas-y at y=0 (bottom fibre)
  const yTop_px = yBot - secH;                    // canvas-y at y=H_tot (top fibre)
  const toY     = yf => yBot - yf * sc;

  // Composite coordinate offset
  const yRef_c = isComposite ? fCompositeBounds(seg.layers||[]).yMin : 0;
  const toYc_d = yg => yBot - (yg - yRef_c) * sc;

  // Section x-centre (zone 0)
  const cx = zW / 2;

  // ── Zone dividers ─────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  [zW, 2*zW].forEach(x => {
    ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, H-2); ctx.stroke();
  });

  // Zone labels
  const lblY = padTop - 6;
  ctx.font = '9px DM Mono,monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillText('sección transversal', zW/2, lblY);
  ctx.fillStyle = 'rgba(96,184,245,0.65)';
  ctx.fillText('σ(y) · esfuerzo normal', zW + zW/2, lblY);
  ctx.fillStyle = 'rgba(240,160,96,0.65)';
  ctx.fillText('τ(y) · esfuerzo tangencial', 2*zW + zW/2, lblY);

  // ── Draw section geometry (zone 0) ────────────────────────────
  const secColor = '#f0a060';

  function drawRectSec(y_bot_m, h_m, w_m, label, labelSide) {
    const px = cx - w_m*sc/2;
    const py = toY(y_bot_m + h_m);
    const pw = w_m*sc, ph = h_m*sc;
    ctx.fillStyle   = secColor+'22';
    ctx.strokeStyle = secColor+'cc';
    ctx.lineWidth   = 1.5;
    ctx.fillRect(px,py,pw,ph); ctx.strokeRect(px,py,pw,ph);
    if (label) {
      ctx.fillStyle='rgba(240,160,96,0.55)'; ctx.font='9px DM Mono,monospace';
      ctx.textAlign = labelSide==='left' ? 'right' : 'left';
      ctx.fillText(label, labelSide==='left' ? px-4 : px+pw+4, py+ph/2+3);
    }
  }

  if (seg.secType==='circ') {
    const r=(seg.d||0.05)/2*sc;
    const pcy=toY((seg.d||0.05)/2);
    ctx.beginPath(); ctx.arc(cx,pcy,r,0,Math.PI*2);
    ctx.fillStyle=secColor+'22'; ctx.fill();
    ctx.strokeStyle=secColor+'cc'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.strokeStyle='rgba(240,160,96,0.4)'; ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(cx-r-8,pcy); ctx.lineTo(cx+r+8,pcy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(240,160,96,0.7)'; ctx.font='10px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀ '+(((seg.d||0.05)*100).toFixed(1))+' cm', cx, Math.min(pcy+r+16, H-6));

  } else if (seg.secType==='circH') {
    const Ro=(seg.d||0.10)/2, t_m=Math.min(Math.max(seg.t||0.005,1e-4), Ro-1e-4);
    const Ri=Ro-t_m;
    const ro_px=Ro*sc, ri_px=Ri*sc;
    const pcy=toY(Ro);
    // Ring: outer filled, inner cleared (evenodd winding)
    ctx.beginPath(); ctx.arc(cx,pcy,ro_px,0,Math.PI*2); ctx.arc(cx,pcy,ri_px,0,Math.PI*2,true);
    ctx.fillStyle=secColor+'28'; ctx.fill('evenodd');
    ctx.strokeStyle=secColor+'cc'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(cx,pcy,ro_px,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,pcy,ri_px,0,Math.PI*2); ctx.stroke();
    // Neutral axis
    ctx.strokeStyle='rgba(240,160,96,0.4)'; ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(cx-ro_px-8,pcy); ctx.lineTo(cx+ro_px+8,pcy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(240,160,96,0.7)'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀'+(Ro*2*100).toFixed(1)+' t='+(t_m*100).toFixed(1)+' cm', cx, Math.min(pcy+ro_px+14,H-6));
    // Thickness annotation
    ctx.strokeStyle=secColor+'90'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cx+ri_px,pcy); ctx.lineTo(cx+ro_px,pcy); ctx.stroke();
    ctx.fillStyle=secColor+'bb'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='left';
    ctx.fillText('t', cx+ro_px+4, pcy+3);

  } else if (seg.secType==='rect') {
    drawRectSec(0, seg.h||0.10, seg.b||0.05, null, null);
    ctx.fillStyle='rgba(240,160,96,0.55)'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('b='+(((seg.b||0.05)*100).toFixed(1))+'cm', cx, Math.min(yBot+14, H-4));
    ctx.textAlign='right';
    ctx.fillText('h='+(((seg.h||0.10)*100).toFixed(1))+'cm', cx-secW/2-5, toY((seg.h||0.10)/2)+3);

  } else if (seg.secType==='rectH') {
    const B=seg.b||0.10, Hh=seg.h||0.20, t_m=Math.min(Math.max(seg.t||0.01,1e-4),Math.min(B,Hh)/2-1e-4);
    const bi=B-2*t_m, hi=Hh-2*t_m;
    const t_px=t_m*sc;
    const ox=cx-B*sc/2, ow=B*sc, oh=Hh*sc, oy_top=toY(Hh);
    // Draw 4 wall strips
    ctx.fillStyle=secColor+'28'; ctx.strokeStyle='rgba(0,0,0,0)'; ctx.lineWidth=0;
    ctx.fillRect(ox,           oy_top,        ow,    t_px);         // top flange
    ctx.fillRect(ox,           oy_top+oh-t_px, ow,   t_px);         // bottom flange
    ctx.fillRect(ox,           oy_top+t_px,   t_px,  oh-2*t_px);    // left web
    ctx.fillRect(ox+ow-t_px,   oy_top+t_px,   t_px,  oh-2*t_px);    // right web
    // Outer outline
    ctx.strokeStyle=secColor+'cc'; ctx.lineWidth=1.5;
    ctx.strokeRect(ox, oy_top, ow, oh);
    // Inner void outline
    ctx.strokeStyle=secColor+'55'; ctx.lineWidth=1;
    ctx.strokeRect(ox+t_px, oy_top+t_px, ow-2*t_px, oh-2*t_px);
    // Dimension labels
    ctx.fillStyle='rgba(240,160,96,0.65)'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('B='+(B*100).toFixed(1)+' H='+(Hh*100).toFixed(1)+' t='+(t_m*100).toFixed(1)+' cm',
                 cx, Math.min(yBot+14, H-4));
    // Inner dims
    ctx.fillStyle='rgba(240,160,96,0.35)'; ctx.font='8px DM Mono,monospace';
    ctx.fillText((bi*100).toFixed(1)+'×'+(hi*100).toFixed(1), cx, toY(Hh/2)+3);

  } else if (seg.secType==='Isym') {
    const tf=seg.tf||0.01, hw=seg.hw||0.10, bf=seg.bf||0.10, tw=seg.tw||0.008;
    drawRectSec(0,     tf, bf, 'ala',  'left');
    drawRectSec(tf,    hw, tw, 'alma', 'left');
    drawRectSec(tf+hw, tf, bf, 'ala',  'left');
    ctx.fillStyle='rgba(240,160,96,0.45)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='left';
    const rx = Math.min(cx+secW/2+4, zW-2);
    ctx.fillText('bf='+((bf*100).toFixed(1))+'cm', rx, toY(tf+hw+tf/2)+3);
    ctx.fillText('hw='+((hw*100).toFixed(1))+'cm', rx, toY(tf+hw/2)+3);
    ctx.fillText('tf='+((tf*100).toFixed(1))+'cm', rx, toY(tf/2)+3);

  } else if (seg.secType==='Tsec') {
    const tf=seg.tf||0.01, hw=seg.hw||0.10, bf=seg.bf||0.10, tw=seg.tw||0.008;
    drawRectSec(0,  hw, tw, 'alma', 'left');
    drawRectSec(hw, tf, bf, 'ala',  'left');
    ctx.fillStyle='rgba(240,160,96,0.45)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='left';
    const rx=Math.min(cx+secW/2+4, zW-2);
    ctx.fillText('bf='+((bf*100).toFixed(1))+'cm', rx, toY(hw+tf/2)+3);
    ctx.fillText('hw='+((hw*100).toFixed(1))+'cm', rx, toY(hw/2)+3);

  } else if (seg.secType==='Tinv') {
    const tf=seg.tf||0.01, hw=seg.hw||0.10, bf=seg.bf||0.10, tw=seg.tw||0.008;
    drawRectSec(0,  tf, bf, 'ala',  'left');
    drawRectSec(tf, hw, tw, 'alma', 'left');
    ctx.fillStyle='rgba(240,160,96,0.45)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='left';
    const rx=Math.min(cx+secW/2+4, zW-2);
    ctx.fillText('bf='+((bf*100).toFixed(1))+'cm', rx, toY(tf/2)+3);
    ctx.fillText('hw='+((hw*100).toFixed(1))+'cm', rx, toY(tf+hw/2)+3);

  } else if (seg.secType==='composite') {
    const layerColors = ['#60b8f5','#f5c842','#50d4b8','#f0a060','#b090f5','#f07070'];
    const layers = seg.layers || [];
    const bounds = fCompositeBounds(layers);
    const yRef   = bounds.yMin;
    const toYc   = yg => yBot - (yg - yRef) * sc;
    const pxCtr  = xc => cx + xc * sc;

    function compBlock(pxL, pyT, pw, ph, col) {
      ctx.fillStyle=col+'22'; ctx.strokeStyle=col+'cc'; ctx.lineWidth=1.5;
      ctx.fillRect(pxL,pyT,pw,ph); ctx.strokeRect(pxL,pyT,pw,ph);
    }
    layers.forEach((lay, li) => {
      const col  = layerColors[li % layerColors.length];
      const dims = fLayerDims(lay);
      const xc_lay = lay.x_center||0, yc_lay = lay.y_center||0;
      const px_c = pxCtr(xc_lay);
      const lbl  = `${li+1}`;
      if (lay.type === 'rect') {
        const pw=dims.w*sc, ph=dims.h*sc;
        const pxL=px_c-pw/2, pyT=toYc(yc_lay+dims.h/2);
        compBlock(pxL,pyT,pw,ph,col);
        ctx.fillStyle=col+'dd'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
        ctx.fillText(((dims.w*100).toFixed(0))+'×'+((dims.h*100).toFixed(0)), pxL+pw/2, pyT+ph/2+3);
        ctx.fillText(lbl, pxL+pw/2, pyT+9);
      } else if (lay.type === 'circ') {
        const r=dims.w/2*sc;
        ctx.beginPath(); ctx.arc(px_c, toYc(yc_lay), r, 0, Math.PI*2);
        ctx.fillStyle=col+'22'; ctx.fill(); ctx.strokeStyle=col+'cc'; ctx.lineWidth=1.5; ctx.stroke();
        ctx.fillStyle=col+'dd'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
        ctx.fillText('⌀'+((dims.w*100).toFixed(0))+'·'+lbl, px_c, toYc(yc_lay)+r+11);
      } else if (lay.type === 'Isym') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0=yc_lay-dims.h/2;
        compBlock(px_c-bf*sc/2, toYc(y0+tf),      bf*sc, tf*sc, col);
        compBlock(px_c-tw*sc/2, toYc(y0+tf+hw),   tw*sc, hw*sc, col);
        compBlock(px_c-bf*sc/2, toYc(y0+2*tf+hw), bf*sc, tf*sc, col);
        ctx.fillStyle=col+'cc'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
        ctx.fillText('I·'+lbl, px_c, toYc(y0+tf+hw/2)+3);
      } else if (lay.type === 'Tsec') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0=yc_lay-dims.h/2;
        compBlock(px_c-tw*sc/2, toYc(y0+hw),    tw*sc, hw*sc, col);
        compBlock(px_c-bf*sc/2, toYc(y0+hw+tf), bf*sc, tf*sc, col);
        ctx.fillStyle=col+'cc'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
        ctx.fillText('T↑·'+lbl, px_c, toYc(y0+hw/2)+3);
      } else if (lay.type === 'Tinv') {
        const {bf,tf,hw,tw}={bf:lay.bf||0.10,tf:lay.tf||0.01,hw:lay.hw||0.10,tw:lay.tw||0.008};
        const y0=yc_lay-dims.h/2;
        compBlock(px_c-bf*sc/2, toYc(y0+tf),    bf*sc, tf*sc, col);
        compBlock(px_c-tw*sc/2, toYc(y0+tf+hw), tw*sc, hw*sc, col);
        ctx.fillStyle=col+'cc'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
        ctx.fillText('T↓·'+lbl, px_c, toYc(y0+tf+hw/2)+3);
      }
    });
  }

  // ── Centroid dashed line (zone 0 only) ────────────────────────
  const yc_px = toY(props.yc);
  ctx.strokeStyle='rgba(245,200,66,0.55)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
  ctx.beginPath();
  ctx.moveTo(Math.max(cx - secW/2 - 10, 2), yc_px);
  ctx.lineTo(Math.min(cx + secW/2 + 10, zW - 4), yc_px);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='rgba(245,200,66,0.75)'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='center';
  ctx.fillText('ȳ='+(props.yc*100).toFixed(2)+'cm (filo inf.)', cx, yc_px - 5);

  // ── σ(y) zone (zone 1) ────────────────────────────────────────
  const c_top = H_tot - props.yc;
  const c_bot = props.yc;
  const c_max = Math.max(c_top, c_bot);
  // Flexión compuesta: σ = N/A + M·(y−ȳ)/I  — N from axial FEM solver
  const N_SI    = fGetN_at(xPos);
  const sigma_N = props.A > 0 ? N_SI / props.A : 0;
  const sig_top_SI = (props.Ix > 0 ? -M_at_x * c_top / props.Ix : 0) + sigma_N;
  const sig_bot_SI = (props.Ix > 0 ?  M_at_x * c_bot / props.Ix : 0) + sigma_N;
  const sig_max_abs = Math.max(Math.abs(sig_top_SI), Math.abs(sig_bot_SI), 1e-12);

  // σ axis is centred in zone 1; diagram extends ± sigRange on each side
  const sigAxisX = zW + zW / 2;          // centre of zone 1
  const sigRange  = zW / 2 - padSide;   // max half-width

  // Axis line (zero-stress line)
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(sigAxisX, yTop_px - 8); ctx.lineTo(sigAxisX, yBot + 8); ctx.stroke();

  // Top / bottom edge ticks
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=0.6;
  [yTop_px, yBot].forEach(py => {
    ctx.beginPath(); ctx.moveTo(sigAxisX-4, py); ctx.lineTo(sigAxisX+4, py); ctx.stroke();
  });

  // N/A reference line (dashed) when axial load is present
  if (N_SI !== 0) {
    const sigma_N_px = sigAxisX + (sigma_N / sig_max_abs) * sigRange;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.8; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(sigma_N_px, yTop_px - 6); ctx.lineTo(sigma_N_px, yBot + 6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '8px DM Mono,monospace'; ctx.textAlign = 'center';
    ctx.fillText('N/A', sigma_N_px, yTop_px - 8);
  }

  // σ polygon — axis at centre, positive right, negative left
  const sig_top_px = sigAxisX + (sig_top_SI/sig_max_abs)*sigRange;
  const sig_bot_px = sigAxisX + (sig_bot_SI/sig_max_abs)*sigRange;

  if (sig_top_SI * sig_bot_SI < 0) {
    // Neutral axis inside section — split into two colored triangles
    const t = -sig_bot_SI / (sig_top_SI - sig_bot_SI);  // fraction from bottom (0→1)
    const na_y = yBot + (yTop_px - yBot) * t;            // canvas y of neutral axis
    const upperIsPos = sig_top_SI > 0;
    // Upper triangle
    ctx.beginPath();
    ctx.moveTo(sigAxisX, yTop_px);
    ctx.lineTo(sig_top_px, yTop_px);
    ctx.lineTo(sigAxisX, na_y);
    ctx.closePath();
    ctx.fillStyle = upperIsPos ? 'rgba(240,100,100,0.18)' : 'rgba(96,184,245,0.18)';
    ctx.fill();
    // Lower triangle
    ctx.beginPath();
    ctx.moveTo(sigAxisX, na_y);
    ctx.lineTo(sig_bot_px, yBot);
    ctx.lineTo(sigAxisX, yBot);
    ctx.closePath();
    ctx.fillStyle = upperIsPos ? 'rgba(96,184,245,0.18)' : 'rgba(240,100,100,0.18)';
    ctx.fill();
    // Neutral axis dashed line
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(sigAxisX - sigRange - 4, na_y); ctx.lineTo(sigAxisX + sigRange + 4, na_y); ctx.stroke();
    ctx.setLineDash([]);
    // Stress diagonal
    ctx.strokeStyle = upperIsPos ? '#f07070dd' : '#60b8f5dd'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sig_top_px, yTop_px); ctx.lineTo(sig_bot_px, yBot); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(sigAxisX, yTop_px);
    ctx.lineTo(sig_top_px, yTop_px);
    ctx.lineTo(sig_bot_px, yBot);
    ctx.lineTo(sigAxisX, yBot);
    ctx.closePath();
    const isPos = sig_top_SI >= 0;
    ctx.fillStyle = isPos ? 'rgba(240,100,100,0.18)' : 'rgba(96,184,245,0.18)';
    ctx.fill();
    ctx.strokeStyle = isPos ? '#f07070dd' : '#60b8f5dd';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sig_top_px, yTop_px); ctx.lineTo(sig_bot_px, yBot); ctx.stroke();
  }

  // σ labels — clipped to stay inside zone 1
  const sig_top_u = fStressFromSI(sig_top_SI);
  const sig_bot_u = fStressFromSI(sig_bot_SI);
  ctx.font='9px DM Mono,monospace';
  ctx.fillStyle = sig_top_SI > 0 ? '#f09090' : '#90b8f5';
  ctx.textAlign = sig_top_px >= sigAxisX ? 'left' : 'right';
  ctx.fillText(sig_top_u.toFixed(2)+' '+fStressLabel(),
    sig_top_px + (sig_top_px>=sigAxisX ? 3 : -3), yTop_px + 10);
  ctx.fillStyle = sig_bot_SI < 0 ? '#f09090' : '#90b8f5';
  ctx.textAlign = sig_bot_px >= sigAxisX ? 'left' : 'right';
  ctx.fillText(sig_bot_u.toFixed(2)+' '+fStressLabel(),
    sig_bot_px + (sig_bot_px>=sigAxisX ? 3 : -3), yBot - 4);

  // ── τ(y) zone (zone 2) ────────────────────────────────────────
  const scan  = isComposite ? fCompositeShearScan(seg) : fSimpleShearScan(seg);
  const scanI = isComposite ? scan.I_tr : scan.I;

  let tau_max_SI_diag = 0;
  if (scan.QoB_max > 0 && scanI > 0)
    tau_max_SI_diag = Math.abs(V_at_x) * scan.QoB_max / scanI;

  const tauAxisX = 2*zW + padSide;
  const tauRange  = 3*zW - tauAxisX - padSide;
  const tauScale  = tau_max_SI_diag > 1e-12 ? tau_max_SI_diag : 1;

  // Axis line
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(tauAxisX, yTop_px - 8); ctx.lineTo(tauAxisX, yBot + 8); ctx.stroke();

  // Top / bottom edge ticks
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=0.6;
  [yTop_px, yBot].forEach(py => {
    ctx.beginPath(); ctx.moveTo(tauAxisX-4, py); ctx.lineTo(tauAxisX+4, py); ctx.stroke();
  });

  if (scan.y_arr.length > 1) {
    const pts = scan.y_arr.map((yg, i) => {
      const tau_SI = scanI > 0 ? Math.abs(V_at_x) * scan.QoB_arr[i] / scanI : 0;
      return [tauAxisX + (tau_SI / tauScale) * tauRange, toYc_d(yg)];
    });

    if (isComposite) {
      (seg.layers || []).forEach(lay => {
        const dims = fLayerDims(lay);
        const yc_l = lay.y_center || 0;
        [yc_l - dims.h/2, yc_l + dims.h/2].forEach(yb => {
          const py = toYc_d(yb);
          ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=0.6; ctx.setLineDash([3,3]);
          ctx.beginPath(); ctx.moveTo(tauAxisX, py); ctx.lineTo(tauAxisX+tauRange+4, py); ctx.stroke();
          ctx.setLineDash([]);
        });
      });
    }

    ctx.beginPath();
    ctx.moveTo(tauAxisX, pts[0][1]);
    pts.forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.lineTo(tauAxisX, pts[pts.length-1][1]);
    ctx.closePath();
    ctx.fillStyle='rgba(240,160,96,0.15)'; ctx.fill();

    ctx.strokeStyle='#f0a060cc'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.stroke();

    // τ_max label at the y of maximum τ
    let y_at_max = isComposite
      ? (props.yc_global != null ? props.yc_global : yRef_c + H_tot/2)
      : props.yc;
    let maxQoB = -Infinity;
    scan.y_arr.forEach((yg, i) => {
      if (scan.QoB_arr[i] > maxQoB) { maxQoB = scan.QoB_arr[i]; y_at_max = yg; }
    });
    const tau_max_u = fStressFromSI(tau_max_SI_diag);
    ctx.fillStyle='#f0a060'; ctx.font='9px DM Mono,monospace'; ctx.textAlign='left';
    const tauLblX = Math.min(tauAxisX + tauRange + 2, W - 60);
    ctx.fillText(tau_max_u.toFixed(2)+' '+fStressLabel(), tauLblX, toYc_d(y_at_max) + 3);
  }

  // ── Save state for hover ──────────────────────────────────────
  fSecDiagState = { xPos, seg, props, M_at_x, V_at_x, H_tot, B_tot,
                    yBot, yTop_px, secH, sc, W, H,
                    sigAxisX, sigRange, sig_max_abs, sigma_N,
                    tauAxisX, tauRange, tauScale,
                    scan, scanI, yRef_c, tau_max_SI_diag };
  fAttachSecHover();

  // ── Info panel (below canvas) ─────────────────────────────────
  const Ix_cm4 = (props.Ix*1e8).toFixed(3), Iy_cm4 = (props.Iy*1e8).toFixed(3);
  const A_cm2  = (props.A*1e4).toFixed(3),  yc_cm  = (props.yc*100).toFixed(3);
  const c_cm   = (c_max*100).toFixed(3);
  const EI_SI  = seg.E * props.Ix;  // seg.E in Pa
  const EI_str = EI_SI > 1e6 ? (EI_SI/1e6).toFixed(3)+' MN·m²' : EI_SI.toExponential(3)+' N·m²';
  const M_u    = fMomentFromSI(M_at_x);
  const V_u    = fForceFromSI(V_at_x);

  const N_u   = fForceFromSI(N_SI);
  const rows = [
    ['Ix',      Ix_cm4+' cm⁴',   'var(--acc)'],
    ['Iy',      Iy_cm4+' cm⁴',   'var(--txt2)'],
    ['A',       A_cm2 +' cm²',   'var(--txt2)'],
    ['ȳ',       yc_cm +' cm',    'var(--txt2)'],
    ['c',       c_cm  +' cm',    'var(--orange)'],
    ['EI',      EI_str,          'var(--blue)'],
    ['M(x)',    M_u.toFixed(3)+' '+fMomentLabel(),                             'var(--acc)'],
    ['V(x)',    V_u.toFixed(3)+' '+fForceLabel(),                              'var(--red)'],
    ...(N_SI !== 0 ? [
      ['N(x)',  N_u.toFixed(3)+' '+fForceLabel(),                              N_SI>0?'var(--red)':'var(--blue)'],
      ['σ_N',   fStressFromSI(sigma_N).toFixed(3)+' '+fStressLabel(),          N_SI>0?'var(--red)':'var(--blue)'],
    ] : []),
    ['σ tope',  sig_top_u.toFixed(3)+' '+fStressLabel(), sig_top_SI>0?'var(--red)':'var(--blue)'],
    ['σ bot',   sig_bot_u.toFixed(3)+' '+fStressLabel(), sig_bot_SI<0?'var(--red)':'var(--blue)'],
    ['τ_v máx', fStressFromSI(tau_max_SI_diag).toFixed(3)+' '+fStressLabel(), 'var(--orange)'],
  ];

  info.innerHTML = rows.map(([k,v,c])=>`
    <div style="display:flex;gap:4px;align-items:baseline;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,0.03);white-space:nowrap">
      <span style="color:var(--txt3);font-size:10px">${k}</span>
      <span style="color:${c};font-weight:600;font-size:11px">${v}</span>
    </div>`).join('');
}

// ── INTERACTIVE σ(y) HOVER ────────────────────────────────────
// Store diagram geometry for hover hit-testing
let fSecDiagState = null;

function fAttachSecHover() {
  const cvs = document.getElementById('cvFlexSec');
  if (!cvs || cvs._secHoverAttached) return;
  cvs._secHoverAttached = true;

  function getYfromEvent(e) {
    if (!fSecDiagState) return null;
    const rect = cvs.getBoundingClientRect();
    const my   = (e.clientY - rect.top) * (cvs.height / rect.height) / (window.devicePixelRatio||1);
    const { yBot, secH, H_tot } = fSecDiagState;
    // Convert pixel y → fiber y (0=bottom, H_tot=top)
    const yf = (yBot - my) / (secH / H_tot);
    if (yf < -H_tot*0.1 || yf > H_tot*1.1) return null;
    return Math.max(0, Math.min(H_tot, yf));
  }

  function showHoverTip(e) {
    const st = fSecDiagState;
    if (!st) return;
    const yf = getYfromEvent(e);
    if (yf === null) { removeHoverTip(); return; }

    const { props, M_at_x, V_at_x, scan, scanI, yRef_c, sigma_N } = st;
    const y_from_centroid = yf - props.yc;
    const sigma_SI = (props.Ix > 0 ? -M_at_x * y_from_centroid / props.Ix : 0) + (sigma_N || 0);
    const sigma_u  = fStressFromSI(sigma_SI);

    // τ at yf: find closest scan point
    let tau_SI = 0;
    if (scan && scan.y_arr.length > 1 && scanI > 0) {
      const yg_target = yRef_c + yf;
      let minD = Infinity, idx = 0;
      scan.y_arr.forEach((yg2, i) => {
        const d = Math.abs(yg2 - yg_target);
        if (d < minD) { minD = d; idx = i; }
      });
      tau_SI = Math.abs(V_at_x) * scan.QoB_arr[idx] / scanI;
    }
    const tau_u = fStressFromSI(tau_SI);

    let tip = document.getElementById('fSecTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'fSecTip';
      tip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(15,18,26,0.95);border:1px solid rgba(240,160,96,0.4);border-radius:7px;padding:6px 10px;font-family:var(--mono);font-size:11px;z-index:100;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
      document.body.appendChild(tip);
    }
    const sigColor = sigma_SI > 0 ? '#f09090' : '#90b8f5';
    const yc_dist  = (y_from_centroid*100).toFixed(2);
    tip.innerHTML =
      `<span style="color:var(--txt3)">y = </span><span style="color:#f0a060">${(yf*100).toFixed(2)} cm</span>` +
      ` <span style="color:var(--txt3)">· Δy = </span><span style="color:var(--txt2)">${yc_dist} cm</span><br>` +
      `<span style="color:var(--txt3)">σ = </span><span style="color:${sigColor};font-weight:700">${sigma_u.toFixed(3)} ${fStressLabel()}</span>` +
      ` &nbsp;·&nbsp; ` +
      `<span style="color:var(--txt3)">τ = </span><span style="color:#f0a060;font-weight:700">${tau_u.toFixed(3)} ${fStressLabel()}</span>`;

    let tx = e.clientX + 14, ty = e.clientY - 20;
    if (tx + 240 > window.innerWidth) tx = e.clientX - 250;
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';

    drawFlexSectionCrosshair(yf);
  }

  function removeHoverTip() {
    const tip = document.getElementById('fSecTip');
    if (tip) tip.style.display = 'none';
    // Redraw without crosshair
    if (fSecDiagState) drawFlexSection(fSecDiagState.xPos);
  }

  cvs.addEventListener('mousemove', e => {
    const tip = document.getElementById('fSecTip');
    if (tip) tip.style.display = '';
    showHoverTip(e);
  });
  cvs.addEventListener('mouseleave', removeHoverTip);
  cvs.addEventListener('touchmove', e => { e.preventDefault(); showHoverTip(e.touches[0]); }, {passive:false});
}

function drawFlexSectionCrosshair(yf) {
  const st = fSecDiagState;
  if (!st) return;
  drawFlexSection(st.xPos);

  const cvs = document.getElementById('cvFlexSec');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const { yBot, sc, W, props, M_at_x, V_at_x,
          sigAxisX, sigRange, sig_max_abs, sigma_N,
          tauAxisX, tauRange, tauScale, scan, scanI, yRef_c } = st;

  const y_px = yBot - yf * sc;

  // σ at yf — flexión compuesta: N/A + M·(y−ȳ)/I
  const sigma_SI = (props.Ix > 0 ? M_at_x * (yf - props.yc) / props.Ix : 0) + (sigma_N || 0);
  const sig_px   = sigAxisX + (sigma_SI / sig_max_abs) * sigRange;

  // τ at yf: find closest scan point
  let tau_SI = 0;
  if (scan && scan.y_arr.length > 1 && scanI > 0) {
    const yg_target = yRef_c + yf;
    let minD = Infinity, idx = 0;
    scan.y_arr.forEach((yg2, i) => {
      const d = Math.abs(yg2 - yg_target);
      if (d < minD) { minD = d; idx = i; }
    });
    tau_SI = Math.abs(V_at_x) * scan.QoB_arr[idx] / scanI;
  }
  const tau_px = tauAxisX + (tau_SI / tauScale) * tauRange;

  ctx.save();
  // Horizontal crosshair across all 3 zones
  ctx.strokeStyle = 'rgba(245,200,66,0.55)';
  ctx.lineWidth = 1; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(0, y_px); ctx.lineTo(W, y_px); ctx.stroke();
  ctx.setLineDash([]);

  // Dot on σ curve (zone 1)
  ctx.beginPath(); ctx.arc(sig_px, y_px, 4, 0, Math.PI*2);
  ctx.fillStyle = sigma_SI > 0 ? '#f07070' : '#60b8f5';
  ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();

  // Dot on τ curve (zone 2)
  ctx.beginPath(); ctx.arc(tau_px, y_px, 4, 0, Math.PI*2);
  ctx.fillStyle = '#f0a060';
  ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();

  ctx.restore();
}

// ── FLEXION INIT ──────────────────────────────────────────────
function fInit() {
  fUndoStack.length = 0; fRedoStack.length = 0;
  fSegs.length = 0; fLoads.length = 0; fSupports.length = 0; fSid=0; fLid=0; fSpId=0;
  const id = ++fSid;
  fSegs.push({ id, xa:0, xb:1.0, secType:'rect', b:0.05, h:0.10, d:0.05, E: 200e9 }); // E in Pa
  // Push initial load directly without undo hook (fInit clears stacks)
  const L0 = fGetL(); const lid0 = ++fLid;
  fLoads.push({id:lid0, tipo:'pun', x:+(L0/2).toFixed(4), val:-1000});
  fRenderUnitPanel();
  fRenderSegs();
  fRenderLoads();
  fSupports.push({ id: ++fSpId, x: 0,       restrictV: true, restrictU: false, restrictTheta: false, kV: null, kTheta: null, deltaV: 0, deltaTheta: 0 });
  fSupports.push({ id: ++fSpId, x: fGetL(), restrictV: true, restrictU: false, restrictTheta: false, kV: null, kTheta: null, deltaV: 0, deltaTheta: 0 });
  fRenderSupports();
  fUpdateUndoUI();
  setTimeout(() => { fDrawSegBar(); drawBeamDiagram(); }, 80);
}

// ── GUARDAR / CARGAR PROYECTO ─────────────────────────────────
function fSaveProject() {
  const nEl = document.getElementById('fN');
  const data = {
    version: '3.5',
    segs: JSON.parse(JSON.stringify(fSegs)),
    loads: JSON.parse(JSON.stringify(fLoads)),
    supports: JSON.parse(JSON.stringify(fSupports)),
    sid: fSid, lid: fLid, spid: fSpId,
    n: nEl ? nEl.value : '40',
    units: { fUnitLen, fUnitE, fUnitSpan, fUnitForce, fUnitDefl, fUnitStress, fUnitDeltaV, fUnitDeltaR }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'proyecto_fem.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function fLoadProject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      fPushUndo();
      fSegs.length = 0;     (data.segs     || []).forEach(sg => fSegs.push(sg));
      fLoads.length = 0;    (data.loads    || []).forEach(l  => fLoads.push(l));
      fSupports.length = 0; (data.supports || []).forEach(sp => fSupports.push(sp));
      fSid  = data.sid  || fSegs.reduce((m,s) => Math.max(m,s.id||0), 0);
      fLid  = data.lid  || fLoads.reduce((m,l) => Math.max(m,l.id||0), 0);
      fSpId = data.spid || fSupports.reduce((m,s) => Math.max(m,s.id||0), 0);
      const nEl = document.getElementById('fN');
      if (nEl && data.n) nEl.value = data.n;
      const u = data.units || {};
      if (u.fUnitLen)    fUnitLen    = u.fUnitLen;
      if (u.fUnitE)      fUnitE      = u.fUnitE;
      if (u.fUnitSpan)   fUnitSpan   = u.fUnitSpan;
      if (u.fUnitForce)  fUnitForce  = u.fUnitForce;
      if (u.fUnitDefl)   fUnitDefl   = u.fUnitDefl;
      if (u.fUnitStress) fUnitStress = u.fUnitStress;
      if (u.fUnitDeltaV) fUnitDeltaV = u.fUnitDeltaV;
      if (u.fUnitDeltaR) fUnitDeltaR = u.fUnitDeltaR;
      // Clear stale results so old charts never linger after a new import
      fLastSolveData = null;
      Object.keys(fCharts).forEach(k => { if (fCharts[k]) { fCharts[k].destroy(); fCharts[k] = null; } });
      document.getElementById('flexResContent').style.display = 'none';
      document.getElementById('fEmptyState').style.display = '';
      fRenderUnitPanel(); fRenderSegs(); fRenderLoads(); fRenderSupports();
      fUpdateUndoUI();
      // Let the DOM settle, then draw diagram + auto-solve (via fSolveUI for proper error handling)
      setTimeout(() => { fDrawSegBar(); drawBeamDiagram(); fSolveUI(); }, 150);
    } catch(err) {
      const box = document.getElementById('fErrBox');
      if (box) { box.textContent = 'Error al cargar: ' + err.message; box.style.display='block'; }
    }
  };
  reader.readAsText(file);
}

// ── EXPORTAR RESULTADOS (PNG) ─────────────────────────────────
function fExportPNG() {
  if (!fLastSolveData) { alert('Calcula primero para exportar resultados.'); return; }
  const BG = '#0d0f10', BG2 = '#14171a', BG3 = '#1b1f23';
  const W = 900, PAD = 24, HEADER = 90, BEAM_H = 160, CHART_H = 190, GAP = 8;

  const chartOrder = ['fcQ','fcV2','fcV','fcTheta','fcM','fcTau','fcSig','fcN','fcRas'];
  const visibleCharts = chartOrder.filter(id => {
    const el = document.getElementById(id);
    return el && el.offsetParent !== null && fCharts[id];
  });

  const totalH = HEADER + BEAM_H + GAP + visibleCharts.length * (CHART_H + GAP) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, totalH);

  // Header band
  ctx.fillStyle = BG2; ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = 'rgba(96,184,245,0.08)'; ctx.fillRect(0, 0, W, HEADER);

  ctx.fillStyle = '#60b8f5';
  ctx.font = 'bold 17px "DM Mono", monospace';
  ctx.fillText('MM1 FEM Libre v3.5 — Flexión Simple FEM', PAD, 32);

  ctx.font = '11px "DM Mono", monospace';
  ctx.fillStyle = '#8a857c';
  const L = fLastSolveData.L || 0;
  ctx.fillText(`L = ${fSpanFmt(L)} ${fUnitSpan}  ·  ${fSegs.length} segmento(s)  ·  ${fLoads.length} carga(s)  ·  ${fSupports.length} apoyo(s)`, PAD, 54);

  // Metric row summary
  const mRow = document.getElementById('fMrow');
  if (mRow) {
    const metrics = mRow.querySelectorAll('.mc');
    let mx = PAD, my = 70;
    ctx.font = '10px "DM Mono", monospace';
    metrics.forEach(mc => {
      const lbl = mc.querySelector('.mc-lbl')?.textContent || '';
      const val = mc.querySelector('.mc-val')?.textContent || '';
      ctx.fillStyle = '#8a857c'; ctx.fillText(lbl + ':', mx, my);
      ctx.fillStyle = '#ffffff'; ctx.fillText(val, mx + ctx.measureText(lbl + ':  ').width, my);
      mx += 145;
      if (mx > W - 145) { mx = PAD; my += 16; }
    });
  }

  let y = HEADER;

  // Beam diagram
  const beamCv = document.getElementById('cvBeam');
  if (beamCv) {
    ctx.fillStyle = BG3; ctx.fillRect(0, y, W, BEAM_H);
    ctx.drawImage(beamCv, 0, y, W, BEAM_H);
    y += BEAM_H + GAP;
  }

  // Charts
  for (const id of visibleCharts) {
    const cv = document.getElementById(id);
    if (!cv) continue;
    ctx.fillStyle = BG3; ctx.fillRect(0, y, W, CHART_H);
    ctx.drawImage(cv, 0, y, W, CHART_H);
    y += CHART_H + GAP;
  }

  const a = document.createElement('a');
  a.download = 'resultados_fem.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

window.addEventListener('resize', () => {
  fDrawSegBar();
  drawBeamDiagram();
});

// ══════════════════════════════════════════════════════════════
// axial.js — Módulo Axial FEM
// Sub-módulos: Ejes (1D barra escalonada) y Barras (2D truss)
// ══════════════════════════════════════════════════════════════

// ── SHARED ────────────────────────────────────────────────────
let aCurSub = 'ejes';

function aShowErr(m) {
  const e = document.getElementById('aErrBox');
  if (!e) return;
  e.textContent = m;
  e.style.display = m ? 'block' : 'none';
}

// ── UNIT SYSTEM ───────────────────────────────────────────────
let aUnitForce  = 'kN';    // 'N'|'kN'|'kgf'|'tf'
let aUnitLen    = 'm';     // 'm'|'cm'|'mm'
let aUnitDim    = 'cm';    // 'm'|'cm'|'mm'  — section cross-section dimensions
let aUnitE      = 'GPa';   // 'GPa'|'MPa'|'kgf/cm2'|'tf/cm2'
let aUnitStress = 'MPa';   // 'MPa'|'kPa'|'kgf/cm2'|'tf/cm2'

const _aForce  = { N:1, kN:1e3, kgf:9.80665, tf:9806.65 };
const _aLen    = { m:1, cm:0.01, mm:0.001 };
const _aDim    = { m:1, cm:0.01, mm:0.001 };
const _aE      = { GPa:1e9, MPa:1e6, 'kgf/cm2':98066.5, 'tf/cm2':98066500 };
const _aStress = { MPa:1e-6, kPa:1e-3, 'kgf/cm2':1/98066.5, 'tf/cm2':1/98066500 };

function aFtoSI(v)        { return v * _aForce[aUnitForce]; }
function aFfromSI(v)      { return v / _aForce[aUnitForce]; }
function aLtoSI(v)        { return v * _aLen[aUnitLen]; }
function aLfromSI(v)      { return v / _aLen[aUnitLen]; }
function aDimToSI(v)      { return v * _aDim[aUnitDim]; }
function aDimFromSI(v)    { return v / _aDim[aUnitDim]; }
function aEtoSI(v)        { return v * _aE[aUnitE]; }
function aEfromSI(v)      { return v / _aE[aUnitE]; }
function aStressFromSI(v) { return v * _aStress[aUnitStress]; }
function aLfmt(v)         { return aLfromSI(v).toFixed(4); }
function aDimFmt(v)       { return aDimFromSI(v).toFixed(4); }
function aFfmt(v)         { return aFfromSI(v).toFixed(4); }
function aAreaFromSI(v)   { const f = _aLen[aUnitLen]; return v / (f*f); }
function aAreaToSI(v)     { const f = _aLen[aUnitLen]; return v * f*f; }

let _aUnitOpen = false;
function aRenderUnitPanel() {
  const el = document.getElementById('aUnitPanel');
  if (!el) return;
  function row(lbl, opts, cur, fn) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
      <span style="font-size:9px;color:var(--txt3);white-space:nowrap;flex-shrink:0">${lbl}</span>
      <div style="display:flex;gap:3px;flex-wrap:nowrap">${opts.map(([v,l])=>
        `<button class="sec-type-btn${cur===v?' on':''}" onclick="${fn}('${v}')" style="font-size:10px;padding:3px 7px">${l}</button>`
      ).join('')}</div></div>`;
  }
  const body = _aUnitOpen ? `<div style="padding:2px 12px 10px;display:flex;flex-direction:column;gap:1px">
    ${row('Fuerza',   [['N','N'],['kN','kN'],['kgf','kgf'],['tf','tf']], aUnitForce, 'aSetUnitForce')}
    ${row('Longitud', [['m','m'],['cm','cm'],['mm','mm']], aUnitLen, 'aSetUnitLen')}
    ${row('Sección',  [['m','m'],['cm','cm'],['mm','mm']], aUnitDim, 'aSetUnitDim')}
    ${row('Módulo E', [['GPa','GPa'],['MPa','MPa'],['kgf/cm2','kgf/cm²'],['tf/cm2','tf/cm²']], aUnitE, 'aSetUnitE')}
    ${row('Tensión',  [['MPa','MPa'],['kPa','kPa'],['kgf/cm2','kgf/cm²'],['tf/cm2','tf/cm²']], aUnitStress, 'aSetUnitStress')}
  </div>` : '';
  const cur = `${aUnitForce} · ${aUnitLen} · ${aUnitDim} · ${aUnitE} · ${aUnitStress}`;
  el.innerHTML = `<div style="border:1px solid var(--brd);border-radius:9px;margin-bottom:8px;overflow:hidden">
    <button onclick="_aUnitOpen=!_aUnitOpen;aRenderUnitPanel()"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:rgba(255,255,255,0.02);border:none;cursor:pointer;font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase">
      <span>⚙ Unidades &nbsp;·&nbsp; <span style="color:var(--acc)">${cur}</span></span>
      <span style="font-size:11px;transform:rotate(${_aUnitOpen?180:0}deg);display:inline-block">▾</span>
    </button>${body}</div>`;
}
function aSetUnitForce(v)  { aUnitForce=v;  aRefresh(); }
function aSetUnitLen(v)    { aUnitLen=v;    aRefresh(); }
function aSetUnitDim(v)    { aUnitDim=v;    aRefresh(); }
function aSetUnitE(v)      { aUnitE=v;      aRefresh(); }
function aSetUnitStress(v) { aUnitStress=v; aRefresh(); }
function aRefresh() {
  aRenderUnitPanel();
  eRenderSegs(); eRenderLoads(); eRenderBCFields();
  bRenderNodes(); bRenderBars(); bRenderSupports(); bRenderLoads();
  if (aCurSub === 'ejes') eDrawDiagram(); else bDrawTruss();
}

// ══════════════════════════════════════════════════════════════
// SUB-MODULE SWITCHER
// ══════════════════════════════════════════════════════════════
function switchAxialSub(sub) {
  aCurSub = sub;
  document.getElementById('aEjesAside').style.display    = sub === 'ejes'   ? 'flex' : 'none';
  document.getElementById('aBarrasAside').style.display  = sub === 'barras' ? 'flex' : 'none';
  document.getElementById('aSubBtnEjes').className   = 'sub-mod-btn' + (sub === 'ejes'   ? ' on' : '');
  document.getElementById('aSubBtnBarras').className = 'sub-mod-btn' + (sub === 'barras' ? ' on' : '');
  document.getElementById('aEjesRes').style.display    = sub === 'ejes'   ? '' : 'none';
  document.getElementById('aBarrasRes').style.display  = sub === 'barras' ? '' : 'none';
  aShowErr('');
  setTimeout(() => { sub === 'ejes' ? eDrawDiagram() : bDrawTruss(); }, 60);
}

// ══════════════════════════════════════════════════════════════
// EJES — 1D AXIAL BAR
// ══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
let eSegs = [], eLoads = [];
let eSid = 0, eLid = 0;
let eGaps = [];   // gap[i] = holgura SI (m) entre segmento i y i+1
let eGapA = 0, eGapB = 0;  // holguras de extremo (m SI)
let eCharts = {};
let eLastSolveData = null;
let _eRedrawTimer = null;

function eGetL() { return eSegs.length ? eSegs[eSegs.length-1].xb : 1; }
function eGetN() { return parseInt(document.getElementById('eN')?.value)||20; }
function eIBC()  { return document.getElementById('eBC')?.value || 'FC'; }

// ── Segments ──────────────────────────────────────────────────
function eMkSeg(id, xa, xb) {
  return { id, xa, xb,
    secType:'circ', variable:false,
    d:0.05, di:0,     d2:undefined, di2:undefined,
    b:0.05, h:0.08,   b2:undefined, h2:undefined,
    t:0.005,          t2:undefined,
    bI:0.03, hI:0.05,
    E:200e9, E2:70e9, A:1.963e-3 };
}

function eAddSeg() {
  const n = eSegs.length;
  if (n === 0) {
    const s = eMkSeg(++eSid, 0, 1);
    eSegs.push(s);
  } else {
    const last = eSegs[n-1];
    const len  = last.xb - last.xa;
    const s    = { ...last, id:++eSid,
      xa:+last.xb.toFixed(6), xb:+(last.xb+len).toFixed(6) };
    eSegs.push(s);
    eGaps.push(0);  // new interface starts with no gap
  }
  eUpdateL(); eRenderSegs();
}

function eDelSeg(id) {
  if (eSegs.length <= 1) return;
  const i = eSegs.findIndex(s => s.id===id);
  if (i < 0) return;
  if (i < eSegs.length-1) eSegs[i+1].xa = eSegs[i].xa;
  eSegs.splice(i, 1);
  // Remove gap: if deleting last segment → remove last gap; else remove gap at i (interface before next segment)
  eGaps.splice(Math.min(i, eGaps.length-1), 1);
  eSegs[0].xa = 0;
  eUpdateL(); eRenderSegs();
}

function eSetGap(i, val) {
  const v = parseFloat(val);
  eGaps[i] = isNaN(v) || v < 0 ? 0 : aLtoSI(v);
  eDrawDiagram();
}

function eGetGapA() {
  const el = document.getElementById('eGapAInput');
  if (!el) return eGapA;
  const v = parseFloat(el.value);
  return isNaN(v) || v < 0 ? 0 : aLtoSI(v);
}
function eGetGapB() {
  const el = document.getElementById('eGapBInput');
  if (!el) return eGapB;
  const v = parseFloat(el.value);
  return isNaN(v) || v < 0 ? 0 : aLtoSI(v);
}

function eUpdateL() {
  const el = document.getElementById('eL');
  if (el) el.value = aLfmt(eGetL()) + ' ' + aUnitLen;
}

function eSetSegBoundary(id, val) {
  const v = parseFloat(val);
  if (isNaN(v)) return;
  const vSI = aLtoSI(v);
  const s = eSegs.find(s => s.id===id); if (!s) return;
  const i = eSegs.indexOf(s);
  s.xb = Math.max(s.xa+1e-6, Math.min(i<eSegs.length-1 ? eSegs[i+1].xb-1e-6 : Infinity, vSI));
  if (i < eSegs.length-1) eSegs[i+1].xa = s.xb;
  eUpdateL(); eRenderSegs();
}

// All length-type fields → SI via aLtoSI. E fields → Pa via _aE factor.
function eSetSeg(id, field, rawVal) {
  const s = eSegs.find(s => s.id===id); if (!s) return;
  const v = typeof rawVal==='number' ? rawVal : (parseSci ? parseSci(String(rawVal)) : parseFloat(rawVal));
  if (isNaN(v)) return;
  const lenFields = ['d','di','d2','di2','b','h','b2','h2','t','t2','bI','hI'];
  if (lenFields.includes(field)) {
    s[field] = aDimToSI(v);
    // Safety clamps
    if (field==='di'  && s.di  >= s.d)              s.di  = s.d  * 0.8;
    if (field==='di2' && s.di2 >= (s.d2||s.d))      s.di2 = (s.d2||s.d) * 0.8;
    if (field==='bI'  && s.bI  >= s.b)              s.bI  = s.b  * 0.7;
    if (field==='hI'  && s.hI  >= s.h)              s.hI  = s.h  * 0.7;
    if (field==='t') {
      const tMax = Math.min(s.b, s.h) / 2 - 1e-4;
      if (s.t > tMax) s.t = Math.max(1e-4, tMax);
    }
  } else if (field === 'E')  { s.E  = v * _aE[aUnitE]; }
  else if   (field === 'E2') { s.E2 = v * _aE[aUnitE]; }
  else if   (field === 'A')  { s.A  = aAreaToSI(v); }
  s.A = eComputeA(s);
  clearTimeout(_eRedrawTimer);
  _eRedrawTimer = setTimeout(() => { eDrawDiagram(); eDrawSegPreview(s); }, 120);
}

// Area of the section at its START dimensions
function eComputeA(s) {
  const st = s.secType || 'circ';
  if (st === 'rect')      return (s.b||0.05) * (s.h||0.08);
  if (st === 'rectH') {
    const b=s.b||0.05, h=s.h||0.08, t=Math.min(s.t||0.005, b/2-1e-4, h/2-1e-4);
    return b*h - (b-2*t)*(h-2*t);
  }
  if (st === 'circ')      return Math.PI*(s.d||0.05)**2/4;
  if (st === 'circH')     return Math.PI*((s.d||0.05)**2-(s.di||0.03)**2)/4;
  if (st === 'compRect')  return (s.b||0.05)*(s.h||0.08);
  if (st === 'compCirc')  return Math.PI*(s.d||0.05)**2/4;
  return s.A || 1e-4;
}

// Effective EA (composite-aware)
function eComputeEA(s) {
  const st = s.secType || 'circ';
  const E = s.E || 200e9;
  if (st === 'compRect') {
    const A_tot = (s.b||0.05)*(s.h||0.08);
    const A_in  = Math.min((s.bI||0.03)*(s.hI||0.05), A_tot*0.9);
    return E*(A_tot-A_in) + (s.E2||E)*A_in;
  }
  if (st === 'compCirc') {
    const A_tot = Math.PI*(s.d||0.05)**2/4;
    const A_in  = Math.min(Math.PI*(s.di||0.03)**2/4, A_tot*0.9);
    return E*(A_tot-A_in) + (s.E2||E)*A_in;
  }
  return E * eComputeA(s);
}

// Area at element midpoint (handles variable sections, not composite-aware)
function eGetAAtXm(s, xm) {
  if (!s.variable) return eComputeA(s);
  const segL = s.xb - s.xa;
  if (segL < 1e-12) return eComputeA(s);
  const t  = Math.max(0, Math.min(1, (xm - s.xa) / segL));
  const ip = (a, b) => a + (b !== undefined ? b - a : 0) * t;
  const si = { ...s,
    d:  ip(s.d||0.05,  s.d2),
    di: ip(s.di||0,    s.di2),
    b:  ip(s.b||0.05,  s.b2),
    h:  ip(s.h||0.08,  s.h2),
    t:  ip(s.t||0.005, s.t2),
  };
  return eComputeA(si);
}

// Interpolated EA at position xm (handles variable sections)
function eGetEAAt(s, xm) {
  if (!s.variable) return eComputeEA(s);
  const segL = s.xb - s.xa;
  const t = segL > 1e-12 ? Math.max(0, Math.min(1, (xm-s.xa)/segL)) : 0;
  const interp = (a, b) => a + (b !== undefined ? b-a : 0)*t;
  const si = { ...s,
    d:  interp(s.d||0.05, s.d2),
    di: interp(s.di||0,   s.di2),
    b:  interp(s.b||0.05, s.b2),
    h:  interp(s.h||0.08, s.h2),
    t:  interp(s.t||0.005,s.t2),
  };
  return eComputeEA(si);
}

function eGetSecType(s) { return s.secType || 'circ'; }

function eSetSecType(id, type) {
  const s = eSegs.find(s => s.id===id); if (!s) return;
  s.secType = type;
  // Sensible defaults when switching into composite types
  if (type==='compCirc' && !(s.di>0)) s.di = s.d * 0.5;
  if (type==='compRect' && !(s.bI>0)) { s.bI = s.b*0.6; s.hI = s.h*0.6; }
  s.A = eComputeA(s);
  eRenderSegs();
}

function eToggleVariable(id) {
  const s = eSegs.find(s => s.id===id); if (!s) return;
  s.variable = !s.variable;
  if (s.variable) {
    if (s.d2  === undefined) s.d2  = s.d;
    if (s.b2  === undefined) s.b2  = s.b;
    if (s.h2  === undefined) s.h2  = s.h;
    if (s.t2  === undefined) s.t2  = s.t || 0.005;
    if (s.di2 === undefined) s.di2 = s.di || 0;
  } else {
    delete s.d2; delete s.di2; delete s.b2; delete s.h2; delete s.t2;
  }
  eRenderSegs();
}

function eRenderSegs() {
  const cont = document.getElementById('eCSeg');
  if (!cont) return;

  const mainTypes = [
    {id:'rect',     label:'Rect.'},
    {id:'rectH',    label:'Rect.H'},
    {id:'circ',     label:'Circ.'},
    {id:'circH',    label:'Circ.H'},
    {id:'compRect', label:'C.Rect'},
    {id:'compCirc', label:'C.Circ'},
  ];

  function lenInp(sid, field, val, lbl, step) {
    return `<div class="f"><label>${lbl} (${aUnitDim})</label>
      <input type="number" value="${aDimFmt(val)}" step="${step||0.01}" min="0.0001"
        onchange="eSetSeg(${sid},'${field}',this.value);eRenderSegs()"></div>`;
  }
  function lenInpOpt(sid, field, val, lbl) {  // nullable (0 allowed)
    return `<div class="f"><label>${lbl} (${aUnitDim})</label>
      <input type="number" value="${aDimFmt(val||0)}" step="0.01" min="0"
        onchange="eSetSeg(${sid},'${field}',this.value);eRenderSegs()"></div>`;
  }

  cont.innerHTML = eSegs.map((s, i) => {
    const cur = eGetSecType(s);
    const v   = s.variable;

    // ── Section type buttons (3×2 grid) ───────────────────────
    const secTypeRow = `<div class="sec-type-row" style="grid-template-columns:repeat(3,1fr)">${
      mainTypes.map(t => `<button class="sec-type-btn${cur===t.id?' on':''}" onclick="eSetSecType(${s.id},'${t.id}')">${t.label}</button>`).join('')
    }</div>`;

    // ── Variable toggle ────────────────────────────────────────
    const canBeVar = !cur.startsWith('comp');
    const varBtn = canBeVar ? `<button class="sec-type-btn${v?' on':''}"
      onclick="eToggleVariable(${s.id})"
      style="width:100%;margin-bottom:6px;font-size:9px">
      ${v ? '◀▶ Variable activo' : '◀▶ Sección variable'}
    </button>` : '';

    // ── Dimension fields ───────────────────────────────────────
    let dimRow = '';
    if (cur === 'rect') {
      if (v) {
        dimRow = `
        <p class="subhint" style="margin-bottom:3px">Inicio (x = ${aLfmt(s.xa)} ${aUnitLen})</p>
        <div class="r2">${lenInp(s.id,'b',s.b,'b — ancho')}${lenInp(s.id,'h',s.h,'h — alto')}</div>
        <p class="subhint" style="margin-bottom:3px">Fin (x = ${aLfmt(s.xb)} ${aUnitLen})</p>
        <div class="r2">${lenInp(s.id,'b2',s.b2??s.b,'b fin')}${lenInp(s.id,'h2',s.h2??s.h,'h fin')}</div>`;
      } else {
        dimRow = `<div class="r2">${lenInp(s.id,'b',s.b,'b — ancho')}${lenInp(s.id,'h',s.h,'h — alto')}</div>`;
      }
    } else if (cur === 'rectH') {
      const lbl = v ? 'Inicio — ' : '';
      dimRow = `<div class="r2">${lenInp(s.id,'b',s.b,lbl+'B ext.')}${lenInp(s.id,'h',s.h,lbl+'H ext.')}</div>
        <div class="r1">${lenInp(s.id,'t',s.t||0.005,'t — espesor pared',0.0005)}</div>`;
      if (v) dimRow += `
        <p class="subhint" style="margin-bottom:3px">Fin</p>
        <div class="r2">${lenInp(s.id,'b2',s.b2??s.b,'B fin')}${lenInp(s.id,'h2',s.h2??s.h,'H fin')}</div>
        <div class="r1">${lenInp(s.id,'t2',s.t2??s.t??0.005,'t fin',0.0005)}</div>`;
    } else if (cur === 'circ') {
      if (v) {
        dimRow = `
        <div class="r2">
          ${lenInp(s.id,'d',s.d,'d inicio')}
          ${lenInp(s.id,'d2',s.d2??s.d,'d fin')}
        </div>`;
      } else {
        dimRow = `<div class="r1">${lenInp(s.id,'d',s.d,'d — diámetro')}</div>`;
      }
    } else if (cur === 'circH') {
      if (v) {
        dimRow = `
        <div class="r2">${lenInp(s.id,'d',s.d,'D inicio')}${lenInp(s.id,'d2',s.d2??s.d,'D fin')}</div>
        <div class="r2">${lenInpOpt(s.id,'di',s.di,'d_i inicio')}${lenInpOpt(s.id,'di2',s.di2??s.di,'d_i fin')}</div>`;
      } else {
        dimRow = `<div class="r2">${lenInp(s.id,'d',s.d,'D — ext.')}${lenInpOpt(s.id,'di',s.di,'d — int.')}</div>`;
      }
    } else if (cur === 'compRect') {
      dimRow = `
        <p class="subhint" style="margin-bottom:3px">Sección exterior (material 1)</p>
        <div class="r2">${lenInp(s.id,'b',s.b,'B ext.')}${lenInp(s.id,'h',s.h,'H ext.')}</div>
        <p class="subhint" style="margin-bottom:3px">Sección interior (material 2)</p>
        <div class="r2">${lenInp(s.id,'bI',s.bI||s.b*0.6,'b int.')}${lenInp(s.id,'hI',s.hI||s.h*0.6,'h int.')}</div>`;
    } else if (cur === 'compCirc') {
      dimRow = `<div class="r2">${lenInp(s.id,'d',s.d,'D — ext.')}${lenInpOpt(s.id,'di',s.di,'d — int. (interfaz)')}</div>`;
    }

    // ── E fields ────────────────────────────────────────────────
    const isComp = cur.startsWith('comp');
    const Eval  = +aEfromSI(s.E).toFixed(6);
    const E2val = +aEfromSI(s.E2).toFixed(6);
    let eRows = `<div class="r1"><div class="f">
      <label>${isComp ? 'E₁ — material exterior' : 'E — módulo de elasticidad'} (${aUnitE})</label>
      <input type="number" value="${Eval}" step="any" min="0.0001"
        onchange="eSetSeg(${s.id},'E',this.value);eRenderSegs()">
    </div></div>`;
    if (isComp) {
      eRows += `<div class="r1"><div class="f">
        <label>E₂ — material interior (${aUnitE})</label>
        <input type="number" value="${E2val}" step="any" min="0.0001"
          onchange="eSetSeg(${s.id},'E2',this.value);eRenderSegs()">
      </div></div>`;
    }

    // ── Properties panel ────────────────────────────────────────
    const A_cm2 = (eComputeA(s) * 1e4).toFixed(4);
    const EA_eff = eComputeEA(s);
    const Eeff_GPa = (EA_eff / eComputeA(s) / 1e9).toFixed(2);
    const props = `
    <div style="background:rgba(245,200,66,0.05);border:1px solid rgba(245,200,66,0.15);border-radius:8px;padding:7px 10px;margin-top:6px">
      <p style="font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px">Propiedades</p>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-family:var(--mono);font-size:10px">
        <span style="color:var(--txt3)">A =</span><span style="color:var(--acc)">${A_cm2} cm²</span>
        ${isComp ? `<span style="color:var(--txt3)">E_ef =</span><span style="color:var(--txt2)">${aEfromSI(EA_eff/eComputeA(s)).toFixed(4)} ${aUnitE}</span>` :
                   `<span style="color:var(--txt3)">E =</span><span style="color:var(--txt2)">${aEfromSI(s.E).toFixed(4)} ${aUnitE}</span>`}
        <span style="color:var(--txt3)">L =</span><span style="color:var(--txt2)">${aLfmt(s.xb-s.xa)} ${aUnitLen}</span>
      </div>
    </div>`;

    return `<div class="card">
      <div class="card-head">
        <span class="badge b-seg">segmento ${i+1}</span>
        ${eSegs.length>1 ? `<button class="del" onclick="eDelSeg(${s.id})">&#x2715;</button>` : ''}
      </div>
      <div class="r2">
        <div class="f readonly"><label>x inicio (${aUnitLen})</label><input type="number" value="${aLfmt(s.xa)}" disabled></div>
        <div class="f"><label>x fin (${aUnitLen})</label>
          <input type="number" value="${aLfmt(s.xb)}" step="0.001"
            min="${(aLfromSI(s.xa)+0.001).toFixed(4)}"
            onchange="eSetSegBoundary(${s.id},this.value)">
        </div>
      </div>
      ${secTypeRow}
      ${varBtn}
      ${dimRow}
      ${eRows}
      <canvas class="seg-sec-preview" id="eSegPrev_${s.id}"></canvas>
      ${props}
    </div>`;

    // ── Gap separator before next segment ─────────────────────────
    if (i < eSegs.length - 1) {
      const gapVal = aLfromSI(eGaps[i] || 0).toFixed(4);
      const hasGap = (eGaps[i] || 0) > 1e-12;
      return card + `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;margin:2px 0;
          background:${hasGap?'rgba(96,184,245,0.07)':'rgba(255,255,255,0.02)'};
          border-radius:7px;border:1px dashed ${hasGap?'rgba(96,184,245,0.4)':'rgba(255,255,255,0.1)'}">
          <span style="font-size:10px">↔</span>
          <span style="font-size:9px;color:var(--txt3);flex:1">Δ holgura (${aUnitLen})</span>
          <input type="number" value="${gapVal}" step="0.0001" min="0"
            style="width:80px;font-family:var(--mono);font-size:10px;
              background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);
              border-radius:4px;padding:3px 6px;color:${hasGap?'#60b8f5':'var(--txt2)'}"
            onchange="eSetGap(${i},this.value);eRenderSegs()">
        </div>`;
    }
    return card;
  }).join('');

  eUpdateL();
  eDrawDiagram();
  setTimeout(() => eSegs.forEach(s => eDrawSegPreview(s)), 0);
}

// ── BCs ───────────────────────────────────────────────────────
function eRenderBCFields() {
  const bc  = eIBC();
  const box = document.getElementById('eBCExtra');
  if (!box) return;
  let html = '';
  if (bc[0]==='S') html += sciField({label:`K_A (${aUnitForce}/${aUnitLen})`, id:'eKA', value:1e4, min:0, onChangeFn:'/*eKA*/'});
  if (bc[1]==='S') html += sciField({label:`K_B (${aUnitForce}/${aUnitLen})`, id:'eKB', value:1e4, min:0, onChangeFn:'/*eKB*/'});
  if (bc[0]==='F') html += `<div class="f"><label>Δ_A — holgura extremo izq. (${aUnitLen})</label>
    <input id="eGapAInput" type="number" value="${aLfromSI(eGapA).toFixed(4)}" step="0.001" min="0"
      onchange="eGapA=aLtoSI(parseFloat(this.value)||0);eDrawDiagram()"></div>`;
  if (bc[1]==='F') html += `<div class="f"><label>Δ_B — holgura extremo der. (${aUnitLen})</label>
    <input id="eGapBInput" type="number" value="${aLfromSI(eGapB).toFixed(4)}" step="0.001" min="0"
      onchange="eGapB=aLtoSI(parseFloat(this.value)||0);eDrawDiagram()"></div>`;
  box.innerHTML = html;
  box.style.display = html ? '' : 'none';
  setTimeout(initSciBadges, 0);
  eDrawDiagram();   // update canvas whenever BC changes
}
// Spring K in user units (force/length) → SI N/m
function eGetKA() {
  const el = document.getElementById('eKA'); if (!el) return 0;
  const v  = parseSci(el.value); if (isNaN(v)) return 0;
  return Math.max(0, aFtoSI(v) / aLtoSI(1));
}
function eGetKB() {
  const el = document.getElementById('eKB'); if (!el) return 0;
  const v  = parseSci(el.value); if (isNaN(v)) return 0;
  return Math.max(0, aFtoSI(v) / aLtoSI(1));
}

// ── Loads ─────────────────────────────────────────────────────
function eAddLoad(tipo) {
  const L = eGetL();
  tipo = tipo || 'pun';
  if      (tipo==='pun')  eLoads.push({id:++eLid, tipo:'pun',  x:L/2, val:0});
  else if (tipo==='dis')  eLoads.push({id:++eLid, tipo:'dis',  xa:0, xb:L, val:0});
  else if (tipo==='tri')  eLoads.push({id:++eLid, tipo:'tri',  xa:0, xb:L, va:0, vb:0});
  else if (tipo==='temp') eLoads.push({id:++eLid, tipo:'temp', xa:0, xb:L, alpha:12e-6, DT:20, alphaUnit:'micro'});
  eRenderLoads();
}

function eDelLoad(id) {
  eLoads.splice(eLoads.findIndex(l=>l.id===id), 1);
  eRenderLoads();
}

function eSetLoad(id, field, rawVal) {
  const l = eLoads.find(l => l.id===id); if (!l) return;
  const posFields = ['x','xa','xb'];
  if (posFields.includes(field)) {
    const v = parseFloat(rawVal); if (!isNaN(v)) l[field] = aLtoSI(v);
  } else if (field === 'DT') {
    l.DT = parseFloat(rawVal) || 0;
  } else if (field === 'alpha') {
    const v = typeof rawVal==='number' ? rawVal : parseSci(String(rawVal));
    const factor = l.alphaUnit === 'si' ? 1 : 1e-6;
    l.alpha = isNaN(v) ? 12e-6 : v * factor;
  } else {
    const v = typeof rawVal==='number' ? rawVal : parseSci(String(rawVal));
    l[field] = isNaN(v) ? 0 : v;             // val/va/vb in user units
  }
  clearTimeout(_eRedrawTimer);
  _eRedrawTimer = setTimeout(eDrawDiagram, 120);
}

function eRenderLoads() {
  eDrawDiagram();
  const hint = document.getElementById('eHLoad');
  if (hint) hint.style.display = eLoads.length ? 'none' : 'block';
  const cont = document.getElementById('eCLoad'); if (!cont) return;

  const qUnit = `${aUnitForce}/${aUnitLen}`;
  cont.innerHTML = eLoads.map(l => {
    const tipo = l.tipo || 'pun';
    const badge = {pun:'b-pun', dis:'b-dis', tri:'b-dis', temp:'b-pol'}[tipo] || 'b-pun';
    const label = {pun:'Puntual', dis:'Distribuida', tri:'Triangular', temp:'Temperatura'}[tipo];
    let body = '';

    if (tipo === 'pun') {
      body = `<div class="r2">
        <div class="f"><label>x (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.x||0)}" step="0.01"
            onchange="eSetLoad(${l.id},'x',this.value)">
        </div>
        ${sciField({label:`P (${aUnitForce}) <span style="font-size:8px;color:var(--txt3)">→+</span>`,
          value:l.val||0, onChangeFn:`eSetLoad(${l.id},'val',__v__)`})}
      </div>`;

    } else if (tipo === 'dis') {
      body = `<div class="r2">
        <div class="f"><label>x inicio (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xa||0)}" step="0.01"
            onchange="eSetLoad(${l.id},'xa',this.value)">
        </div>
        <div class="f"><label>x fin (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xb||eGetL())}" step="0.01"
            onchange="eSetLoad(${l.id},'xb',this.value)">
        </div>
      </div>
      <div class="r1">
        ${sciField({label:`q (${qUnit}) <span style="font-size:8px;color:var(--txt3)">→+</span>`,
          value:l.val||0, onChangeFn:`eSetLoad(${l.id},'val',__v__)`})}
      </div>`;

    } else if (tipo === 'tri') {
      body = `<div class="r2">
        <div class="f"><label>x inicio (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xa||0)}" step="0.01"
            onchange="eSetLoad(${l.id},'xa',this.value)">
        </div>
        <div class="f"><label>x fin (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xb||eGetL())}" step="0.01"
            onchange="eSetLoad(${l.id},'xb',this.value)">
        </div>
      </div>
      <div class="r2">
        ${sciField({label:`q_a (${qUnit})`, value:l.va||0, onChangeFn:`eSetLoad(${l.id},'va',__v__)`})}
        ${sciField({label:`q_b (${qUnit})`, value:l.vb||0, onChangeFn:`eSetLoad(${l.id},'vb',__v__)`})}
      </div>
      <p class="subhint" style="margin-top:2px">q_a = intensidad en x inicio · q_b = intensidad en x fin · →+</p>`;

    } else if (tipo === 'temp') {
      body = `<div class="r2">
        <div class="f"><label>x inicio (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xa||0)}" step="0.01"
            onchange="eSetLoad(${l.id},'xa',this.value)">
        </div>
        <div class="f"><label>x fin (${aUnitLen})</label>
          <input type="number" value="${aLfmt(l.xb||eGetL())}" step="0.01"
            onchange="eSetLoad(${l.id},'xb',this.value)">
        </div>
      </div>
      <div class="r2">
        <div style="display:flex;gap:4px;align-items:flex-end;margin-bottom:4px">
          <div style="flex:1">${sciField({
            label: `α (${l.alphaUnit==='si'?'1/°C':'µ/°C'})`,
            value: l.alphaUnit==='si' ? +(l.alpha||12e-6).toFixed(8) : +((l.alpha||12e-6)*1e6).toFixed(3),
            onChangeFn:`eSetLoad(${l.id},'alpha',__v__)`
          })}</div>
          <div style="display:flex;flex-direction:column;gap:2px;padding-bottom:2px">
            <button class="sec-type-btn${l.alphaUnit!=='si'?' on':''}" style="font-size:9px;padding:2px 6px"
              onclick="eLoads.find(l=>l.id===${l.id}).alphaUnit='micro';eRenderLoads()">µ/°C</button>
            <button class="sec-type-btn${l.alphaUnit==='si'?' on':''}" style="font-size:9px;padding:2px 6px"
              onclick="eLoads.find(l=>l.id===${l.id}).alphaUnit='si';eRenderLoads()">1/°C</button>
          </div>
        </div>
        <div class="f"><label>ΔT (°C) &nbsp;<span style="font-size:8px;color:var(--txt3)">+ = calentamiento</span></label>
          <input type="number" value="${l.DT??20}" step="1"
            onchange="eSetLoad(${l.id},'DT',this.value)">
        </div>
      </div>
      <p class="subhint" style="margin-top:2px">N_T = EA·α·ΔT · expansión libre bloqueda por apoyos</p>`;
    }

    return `<div class="card">
      <div class="card-head">
        <span class="badge ${badge}">${label}</span>
        <button class="del" onclick="eDelLoad(${l.id})">&#x2715;</button>
      </div>
      ${body}
    </div>`;
  }).join('');
  setTimeout(initSciBadges, 0);
}

// ── Solver helpers ────────────────────────────────────────────
// Solve K·u = F with prescribed DOFs; returns full u or null.
function eSolveSystem(K, F, prescribed, ndof) {
  const u = new Array(ndof).fill(0);
  const presMap = new Map(prescribed.map(p => [p.dof, p.val]));
  prescribed.forEach(p => { u[p.dof] = p.val; });
  const free = [];
  for (let i = 0; i < ndof; i++) if (!presMap.has(i)) free.push(i);
  if (free.length === 0) return u;
  const nF = free.length;
  const Kf = Array.from({length:nF}, () => new Array(nF).fill(0));
  const Ff = new Array(nF).fill(0);
  free.forEach((gi, i) => {
    Ff[i] = F[gi];
    presMap.forEach((val, dof) => { Ff[i] -= K[gi][dof] * val; });
    free.forEach((gj, j) => { Kf[i][j] = K[gi][gj]; });
  });
  const uf = luSolve(Kf, Ff);
  if (!uf) return null;
  free.forEach((gi, i) => { u[gi] = uf[i]; });
  return u;
}

// ── Solver ────────────────────────────────────────────────────
function eSolve() {
  aShowErr('');
  if (!eSegs.length) { aShowErr('Agrega al menos un segmento.'); return; }
  const bc = eIBC();
  const L = eGetL(), nEl = eSegs.length * eGetN();
  const le = L / nEl, ndof = nEl + 1;

  // Build EA per element
  const EAe = [];
  for (let e = 0; e < nEl; e++) {
    const xm = (e+0.5)*le;
    const s = eSegs.find(s=>xm>=s.xa-1e-9&&xm<=s.xb+1e-9)||eSegs[eSegs.length-1];
    EAe.push(eGetEAAt(s, xm));
  }

  // ── Internal gap nodes ────────────────────────────────────────
  // Each active gap at a segment interface splits a mesh node into two DOFs (k_L, k_R).
  // dofL(j) = left-side expanded DOF of node j
  // dofR(j) = right-side expanded DOF of node j (= dofL(j)+1 if j is a gap node)
  const gapEntries = [];
  eGaps.forEach((delta, i) => {
    if (i >= eSegs.length - 1 || delta <= 1e-15) return;
    const k = Math.max(1, Math.min(nEl-1, Math.round(eSegs[i].xb / le)));
    gapEntries.push({k, delta});
  });
  gapEntries.sort((a, b) => a.k - b.k);
  const gapSet = new Set(gapEntries.map(g => g.k));

  const dofOffset = new Array(ndof).fill(0);
  let gOff = 0;
  for (let j = 0; j < ndof; j++) {
    dofOffset[j] = gOff;
    if (gapSet.has(j)) gOff++;
  }
  const dofL = j => j + dofOffset[j];
  const dofR = j => j + dofOffset[j] + (gapSet.has(j) ? 1 : 0);
  const ndof_exp = ndof + gapEntries.length;

  // ── Assemble expanded stiffness and load vector ───────────────
  const K = Array.from({length:ndof_exp}, () => new Array(ndof_exp).fill(0));
  const Fv = new Array(ndof_exp).fill(0);

  for (let e = 0; e < nEl; e++) {
    const k = EAe[e]/le;
    const iL = dofR(e), iR = dofL(e+1);
    K[iL][iL]+=k; K[iL][iR]-=k; K[iR][iL]-=k; K[iR][iR]+=k;
  }
  if (bc[0]==='S') K[dofR(0)][dofR(0)]         += eGetKA();
  if (bc[1]==='S') K[dofL(ndof-1)][dofL(ndof-1)] += eGetKB();

  eLoads.forEach(l => {
    const tipo = l.tipo || 'pun';
    if (tipo === 'pun') {
      const Fsi = aFtoSI(l.val||0);
      const i   = Math.max(0, Math.min(ndof-1, Math.round((l.x||0)/le)));
      Fv[dofL(i)] += Fsi;
    } else if (tipo === 'dis') {
      const q = aFtoSI(l.val||0) / aLtoSI(1);
      const xa = l.xa||0, xb = l.xb||L;
      for (let e = 0; e < nEl; e++) {
        const xe=e*le, xep1=(e+1)*le;
        const x1=Math.max(xa,xe), x2=Math.min(xb,xep1);
        if (x2<=x1+1e-15) continue;
        Fv[dofR(e)]   += q/le * (xep1*(x2-x1) - (x2**2-x1**2)/2);
        Fv[dofL(e+1)] += q/le * ((x2**2-x1**2)/2 - xe*(x2-x1));
      }
    } else if (tipo === 'tri') {
      const va_si = aFtoSI(l.va||0) / aLtoSI(1);
      const vb_si = aFtoSI(l.vb||0) / aLtoSI(1);
      const xa=l.xa||0, xb=l.xb||L;
      const span = xb-xa; if (Math.abs(span)<1e-12) return;
      const A_c = va_si - (vb_si-va_si)*xa/span;
      const B_c = (vb_si-va_si)/span;
      for (let e = 0; e < nEl; e++) {
        const xe=e*le, xep1=(e+1)*le;
        const x1=Math.max(xa,xe), x2=Math.min(xb,xep1);
        if (x2<=x1+1e-15) continue;
        const Ii = x => A_c*xep1*x + B_c*xep1*x**2/2 - A_c*x**2/2 - B_c*x**3/3;
        const Ij = x => A_c*x**2/2 + B_c*x**3/3 - A_c*xe*x - B_c*xe*x**2/2;
        Fv[dofR(e)]   += (Ii(x2)-Ii(x1))/le;
        Fv[dofL(e+1)] += (Ij(x2)-Ij(x1))/le;
      }
    } else if (tipo === 'temp') {
      const alpha = l.alpha || 12e-6, DT = l.DT || 0;
      const xa=l.xa||0, xb=l.xb||L;
      for (let e = 0; e < nEl; e++) {
        const xe=e*le, xep1=(e+1)*le;
        const x1=Math.max(xa,xe), x2=Math.min(xb,xep1);
        if (x2<=x1+1e-15) continue;
        const fT = EAe[e]*alpha*DT*(x2-x1)/le;
        Fv[dofR(e)]   -= fT;
        Fv[dofL(e+1)] += fT;
      }
    }
  });

  // ── Phase 1: solve with gaps OPEN (no contact) ───────────────
  const gapA = eGetGapA(), gapB = eGetGapB();
  const pres1 = [];
  if (bc[0]==='F' && gapA <= 1e-15) pres1.push({dof: dofR(0),      val: 0});
  if (bc[1]==='F' && gapB <= 1e-15) pres1.push({dof: dofL(ndof-1), val: 0});

  // Check minimum stability (need at least one fixed DOF or spring)
  const hasFixedA = bc[0]==='F' || bc[0]==='S';
  const hasFixedB = bc[1]==='F' || bc[1]==='S';
  if (!hasFixedA && !hasFixedB) { aShowErr('Estructura inestable (sin apoyos).'); return; }

  const u1 = eSolveSystem(K, Fv, pres1, ndof_exp);
  if (!u1) { aShowErr('Estructura inestable (sistema singular).'); return; }

  // ── Contact check ─────────────────────────────────────────────
  const contactInfo = [];
  const pres2 = [...pres1];
  const K2 = K.map(row => [...row]);
  const Fv2 = [...Fv];

  // End gap right
  if (bc[1]==='F' && gapB > 1e-15) {
    const rightDof = dofL(ndof-1);
    if (u1[rightDof] >= gapB - 1e-12) {
      pres2.push({dof: rightDof, val: gapB});
      contactInfo.push({label:'Tope B', state:'CONTACTO', delta: gapB, u_free: u1[rightDof]});
    } else {
      contactInfo.push({label:'Tope B', state:'libre', delta: gapB, u_free: u1[rightDof]});
    }
  }
  // End gap left
  if (bc[0]==='F' && gapA > 1e-15) {
    const leftDof = dofR(0);
    if (u1[leftDof] <= -gapA + 1e-12) {
      pres2.push({dof: leftDof, val: -gapA});
      contactInfo.push({label:'Tope A', state:'CONTACTO', delta: gapA, u_free: u1[leftDof]});
    } else {
      contactInfo.push({label:'Tope A', state:'libre', delta: gapA, u_free: u1[leftDof]});
    }
  }

  // Internal gaps: master-slave substitution if contact (u[k_L] - u[k_R] ≥ Δ)
  const slaves = [];  // {slave, master, delta}
  gapEntries.forEach((g, gi) => {
    const kL = dofL(g.k), kR = dofR(g.k);
    const diff = u1[kL] - u1[kR];
    if (diff >= g.delta - 1e-12) {
      // Contact: u_slave (kR) = u_master (kL) - delta
      for (let i = 0; i < ndof_exp; i++) {
        Fv2[i] += K[i][kR] * g.delta;
        K2[i][kL] += K[i][kR];
      }
      slaves.push({slave: kR, master: kL, delta: g.delta});
      pres2.push({dof: kR, val: 0});  // eliminated via master-slave
      contactInfo.push({label:`Holgura ${gi+1}`, state:'CONTACTO', delta: g.delta, u_free: diff});
    } else {
      contactInfo.push({label:`Holgura ${gi+1}`, state:'libre', delta: g.delta, u_free: diff});
    }
  });

  // ── Phase 2: re-solve if any contact occurred ─────────────────
  let u_exp = u1;
  if (pres2.length > pres1.length) {
    const u2 = eSolveSystem(K2, Fv2, pres2, ndof_exp);
    if (!u2) { aShowErr('Estructura inestable con contacto (sistema singular).'); return; }
    slaves.forEach(s => { u2[s.slave] = u2[s.master] - s.delta; });
    u_exp = u2;
  }

  // ── Map expanded DOFs → original nodes ───────────────────────
  const u = new Array(ndof).fill(0);
  for (let j = 0; j < ndof; j++) u[j] = u_exp[dofL(j)];

  // ── Post-process N, σ, ε ─────────────────────────────────────
  const N_raw = EAe.map((ea, e) => ea*(u_exp[dofL(e+1)] - u_exp[dofR(e)])/le);

  const N_thermal = new Array(nEl).fill(0);
  eLoads.forEach(l => {
    if ((l.tipo||'pun') !== 'temp') return;
    const alpha = l.alpha||12e-6, DT = l.DT||0;
    const xa = l.xa||0, xb = l.xb||L;
    for (let e = 0; e < nEl; e++) {
      const xe=e*le, xep1=(e+1)*le;
      const x1=Math.max(xa,xe), x2=Math.min(xb,xep1);
      if (x2<=x1+1e-15) continue;
      N_thermal[e] += EAe[e]*alpha*DT*(x2-x1)/le;
    }
  });
  const N = N_raw.map((n, e) => n - N_thermal[e]);

  const Ae_arr = Array.from({length:nEl}, (_, e) => {
    const xm = (e+0.5)*le;
    const s = eSegs.find(s=>xm>=s.xa-1e-9&&xm<=s.xb+1e-9)||eSegs[eSegs.length-1];
    return eGetAAtXm(s, xm);
  });
  const Eeff_arr = Array.from({length:nEl}, (_, e) => {
    const xm = (e+0.5)*le;
    const s = eSegs.find(s=>xm>=s.xa-1e-9&&xm<=s.xb+1e-9)||eSegs[eSegs.length-1];
    const A = Ae_arr[e];
    return A > 1e-20 ? eGetEAAt(s, xm) / A : s.E;
  });
  const sig = N.map((n, e) => n / (Ae_arr[e] || 1e-12));
  const eps = sig.map((sv, e) => sv / (Eeff_arr[e] || 1e9));

  // ── Reactions ─────────────────────────────────────────────────
  const reacA = bc[0]==='F' ? -N_raw[0] - Fv[dofR(0)]
              : bc[0]==='S' ? -(eGetKA()*u_exp[dofR(0)])
              : null;
  const reacB = bc[1]==='F' ? N_raw[nEl-1] - Fv[dofL(ndof-1)]
              : bc[1]==='S' ? -(eGetKB()*u_exp[dofL(ndof-1)])
              : null;

  eLastSolveData = { u, N, sig, eps, le, nEl, L, EAe, Ae_arr };
  eShowResults(u, N, sig, eps, le, nEl, L, reacA, reacB, contactInfo);
}

function eShowResults(u, N, sig, eps, le, nEl, L, reacA, reacB, contactInfo) {
  document.getElementById('aEmptyState').style.display  = 'none';
  document.getElementById('aResContent').style.display  = '';
  document.getElementById('aEjesRes').style.display     = '';
  document.getElementById('aBarrasRes').style.display   = 'none';

  const uMax  = Math.max(...u.map(Math.abs));
  const NMax  = Math.max(...N.map(Math.abs));
  const sMax  = Math.max(...sig.map(Math.abs));
  const epsMax= Math.max(...eps.map(Math.abs));

  document.getElementById('eMrow').innerHTML = [
    {l:'u máx', v:(uMax*1e3).toFixed(4), u:'mm'},
    {l:'N máx', v:aFfmt(NMax), u:aUnitForce},
    {l:'σ máx', v:aStressFromSI(sMax).toFixed(3), u:aUnitStress},
    {l:'ε máx', v:(epsMax*1e6).toFixed(2), u:'µε'},
  ].map(m=>`<div class="met"><p class="ml">${m.l}</p><p class="mv">${m.v}<span class="mu"> ${m.u}</span></p></div>`).join('');

  const xs  = Array.from({length:nEl+1},(_,i)=>+(i*le).toFixed(5));
  const xsE = Array.from({length:nEl},  (_,i) => +((i+0.5)*le).toFixed(5));

  const disp_u   = u.map(v=>v*1e3);
  const disp_N   = N.map(v=>aFfromSI(v));
  const disp_sig = sig.map(v=>aStressFromSI(v));
  const disp_eps = eps.map(v=>v*1e6);

  eMkChart('ecU',   xs,  disp_u,   '#60b8f5', 'mm',        true,  false, 5);
  eMkChart('ecN',   xsE, disp_N,   '#f5c842', aUnitForce,  true,  true,  3);
  eMkChart('ecSig', xsE, disp_sig, '#f0a060', aUnitStress, true,  true,  3);
  eMkChart('ecEps', xsE, disp_eps, '#50d4b8', 'µε',        true,  true,  2);

  // Reactions
  const fmtR = v => v===null?'libre':aFfromSI(v).toFixed(3)+' '+aUnitForce;
  document.getElementById('eReact').innerHTML =
    `<div class="ir"><span class="ik">R_A</span><span class="iv">${fmtR(reacA)}</span></div>
     <div class="ir"><span class="ik">R_B</span><span class="iv">${fmtR(reacB)}</span></div>`;

  // Contact / gap status
  const gapBox = document.getElementById('eGapStatus');
  if (gapBox) {
    if (contactInfo && contactInfo.length) {
      gapBox.style.display = '';
      gapBox.innerHTML = contactInfo.map(c => {
        const inContact = c.state === 'CONTACTO';
        const col = inContact ? '#f5c842' : '#60b8f5';
        const icon = inContact ? '⚡' : '↔';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0">
          <span style="font-size:9px;color:var(--txt3)">${icon} ${c.label}</span>
          <span style="font-family:var(--mono);font-size:9px;color:${col}">${c.state}
            <span style="color:var(--txt3);font-size:8px"> (Δ=${aLfromSI(c.delta).toFixed(4)} ${aUnitLen}, u_libre=${(c.u_free*1e3).toFixed(3)} mm)</span>
          </span>
        </div>`;
      }).join('');
    } else {
      gapBox.style.display = 'none';
    }
  }

  const totF = eLoads.reduce((s,l)=>s+aFtoSI(l.val||0),0);
  const totR = (reacA||0)+(reacB||0);
  const err  = totF+totR===0 ? 0 : Math.abs((totF+totR)/(Math.abs(totF)||1));
  document.getElementById('eEq').innerHTML =
    `<div class="ir"><span class="ik">ΣF ext</span><span class="iv">${aFfmt(totF)} ${aUnitForce}</span></div>
     <div class="ir"><span class="ik">ΣR</span><span class="iv">${aFfmt(-totR)} ${aUnitForce}</span></div>
     <div class="ir"><span class="ik">Error</span><span class="iv" style="color:${err<1e-4?'#50d4b8':'#f07070'}">${(err*100).toFixed(4)}%</span></div>`;
}

// ── Section preview (flexion-quality) ────────────────────────
function eDrawSegPreview(s) {
  const cvs = document.getElementById('eSegPrev_' + s.id);
  if (!cvs) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cvs.offsetWidth || 280;
  const H = 100;
  cvs.width  = W * dpr; cvs.height = H * dpr;
  const ctx  = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(25,30,40,0.7)';
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 6); ctx.fill();

  const st = eGetSecType(s);
  const col = '#50d4b8';  // teal for axial

  // Compute bounding box of the section
  let H_tot, B_tot;
  if      (st==='circ'||st==='circH'||st==='compCirc') { H_tot=s.d||0.05; B_tot=s.d||0.05; }
  else if (st==='rect'||st==='rectH'||st==='compRect') { H_tot=s.h||0.08; B_tot=s.b||0.05; }
  else                                                   { H_tot=s.h||0.08; B_tot=s.b||0.05; }

  const pad=10, labW=36;
  const drawW = W - pad*2 - labW;
  const drawH = H - pad*2;
  const sc    = Math.min(drawW/B_tot, drawH/H_tot) * 0.78;
  const cx    = pad + labW + drawW/2;
  const yBot  = pad + drawH/2 + H_tot*sc/2;
  const toY   = yf => yBot - yf*sc;

  function fillStroke(fc, sc2) {
    ctx.fillStyle=fc||col+'22'; ctx.strokeStyle=sc2||col+'bb'; ctx.lineWidth=1.2;
  }

  if (st==='circ' || st==='compCirc') {
    const r = (s.d||0.05)/2*sc;
    const pcy = toY((s.d||0.05)/2);
    fillStroke(col+'22', col+'bb');
    ctx.beginPath(); ctx.arc(cx, pcy, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle=col+'88'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀'+((s.d||0.05)*100).toFixed(1)+'cm', cx, pcy+r+11);
    if (st==='compCirc' && (s.di||0)>0) {
      const ri = (s.di||0)/2*sc;
      ctx.fillStyle='rgba(245,200,66,0.20)'; ctx.strokeStyle='rgba(245,200,66,0.80)'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.arc(cx, pcy, Math.max(2,ri), 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
  } else if (st==='circH') {
    const ro = (s.d||0.05)/2*sc;
    const ri = Math.max(2, (s.di||0)/2*sc);
    const pcy = toY((s.d||0.05)/2);
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2); ctx.arc(cx,pcy,ri,0,Math.PI*2,true);
    ctx.fillStyle=col+'28'; ctx.fill('evenodd');
    ctx.strokeStyle=col+'bb'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,pcy,ri,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle=col+'88'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('D='+((s.d||0.05)*100).toFixed(1)+' d='+((s.di||0)*100).toFixed(1)+'cm', cx, pcy+ro+11);
  } else if (st==='rect') {
    const pw=(s.b||0.05)*sc, ph=(s.h||0.08)*sc;
    const ox=cx-pw/2, oy=toY(s.h||0.08);
    fillStroke(col+'22', col+'bb');
    ctx.fillRect(ox,oy,pw,ph); ctx.strokeRect(ox,oy,pw,ph);
    // Label: variable section shows taper
    if (s.variable && s.b2!==undefined) {
      const pw2=(s.b2)*sc, ph2=(s.h2??s.h)*sc;
      ctx.fillStyle=col+'10'; ctx.strokeStyle=col+'44'; ctx.lineWidth=1;
      ctx.strokeRect(cx-pw2/2, toY(s.h2??s.h), pw2, ph2);
    }
    ctx.fillStyle=col+'88'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((s.b||0.05)*100).toFixed(1)+'×'+((s.h||0.08)*100).toFixed(1)+'cm', cx, oy+ph+11);
  } else if (st==='rectH') {
    const B=s.b||0.05, Hh=s.h||0.08;
    const t=Math.min(s.t||0.005, B/2-1e-4, Hh/2-1e-4);
    const t_px=t*sc;
    const ox=cx-B*sc/2, oy=toY(Hh), ow=B*sc, oh=Hh*sc;
    fillStroke(col+'28', col+'bb');
    ctx.fillRect(ox,oy+oh-t_px,ow,t_px); ctx.fillRect(ox,oy,ow,t_px);
    ctx.fillRect(ox,oy+t_px,t_px,oh-2*t_px); ctx.fillRect(ox+ow-t_px,oy+t_px,t_px,oh-2*t_px);
    ctx.strokeRect(ox,oy,ow,oh);
    ctx.strokeStyle=col+'55';
    ctx.strokeRect(ox+t_px,oy+t_px,ow-2*t_px,oh-2*t_px);
    ctx.fillStyle=col+'88'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((B*100).toFixed(1))+'×'+((Hh*100).toFixed(1))+' t='+((t*100).toFixed(1))+'cm', cx, oy+oh+11);
  } else if (st==='compRect') {
    const B=s.b||0.05, Hh=s.h||0.08, bI=s.bI||B*0.6, hI=s.hI||Hh*0.6;
    const ox=cx-B*sc/2, oy=toY(Hh), ow=B*sc, oh=Hh*sc;
    // Outer (material 1)
    fillStroke(col+'22', col+'bb');
    ctx.fillRect(ox,oy,ow,oh); ctx.strokeRect(ox,oy,ow,oh);
    // Inner (material 2)
    const oxi=cx-bI*sc/2, oyi=toY(Hh/2+hI/2), owi=bI*sc, ohi=hI*sc;
    ctx.fillStyle='rgba(245,200,66,0.22)'; ctx.strokeStyle='rgba(245,200,66,0.80)'; ctx.lineWidth=1.2;
    ctx.fillRect(oxi,oyi,owi,ohi); ctx.strokeRect(oxi,oyi,owi,ohi);
    ctx.fillStyle=col+'88'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((B*100).toFixed(1))+'×'+((Hh*100).toFixed(1))+'cm', cx, oy+oh+11);
  }

  // Variable indicator (if active)
  if (s.variable) {
    ctx.fillStyle='rgba(245,200,66,0.70)'; ctx.font='bold 8px DM Mono,monospace'; ctx.textAlign='left';
    ctx.fillText('VAR', pad+labW-1, pad+9);
  }
}

// ── Section viewer (results panel, flexion-quality) ───────────
function eDrawSectionAt(eIdx) {
  const cvs = document.getElementById('cvESection');
  if (!cvs || !eLastSolveData) return;
  const { N, sig, le } = eLastSolveData;
  const eN = eLastSolveData.N.length;
  const i   = Math.max(0, Math.min(eIdx, eN-1));
  const xm  = (i + 0.5) * le;

  // Find segment (and interpolate for variable)
  const seg = eSegs.find(s => xm >= s.xa-1e-9 && xm <= s.xb+1e-9) || eSegs[eSegs.length-1];
  let sEff = seg;
  if (seg.variable) {
    const t = (seg.xb-seg.xa) > 1e-12 ? (xm-seg.xa)/(seg.xb-seg.xa) : 0;
    const ip = (a,b) => a + (b!==undefined?b-a:0)*t;
    sEff = { ...seg, d:ip(seg.d,seg.d2), di:ip(seg.di||0,seg.di2),
              b:ip(seg.b,seg.b2), h:ip(seg.h,seg.h2), t:ip(seg.t||0.005,seg.t2) };
  }

  const Nval = N[i] || 0;
  const sv   = sig[i] || 0;
  const sigMax = Math.max(...eLastSolveData.sig.map(Math.abs), 1e-15);
  const rel  = Math.min(1, Math.abs(sv)/sigMax);
  const alpha = 0.18 + rel*0.65;
  const isZero = Math.abs(sv) < sigMax*1e-4;
  const isTen  = sv > 0;
  const fCol   = isZero ? `rgba(80,212,184,${alpha})` : isTen ? `rgba(240,100,80,${alpha})` : `rgba(80,160,240,${alpha})`;
  const sCol   = isZero ? '#50d4b8' : isTen ? '#f06450' : '#50a0f0';

  const dpr = window.devicePixelRatio || 1;
  const W = cvs.offsetWidth || 150, H = cvs.offsetHeight || 150;
  cvs.width = W*dpr; cvs.height = H*dpr;
  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Same scaling logic as preview
  const st = eGetSecType(sEff);
  let H_tot, B_tot;
  if (st==='circ'||st==='circH'||st==='compCirc') { H_tot=sEff.d||0.05; B_tot=sEff.d||0.05; }
  else { H_tot=sEff.h||0.08; B_tot=sEff.b||0.05; }
  const pad=14, labW=0;
  const drawW=W-pad*2, drawH=H-pad*2-18;
  const sc = Math.min(drawW/B_tot, drawH/H_tot)*0.82;
  const cx  = W/2;
  const yBot = pad + drawH/2 + H_tot*sc/2;
  const toY  = yf => yBot - yf*sc;

  // Draw shape with stress color
  if (st==='circ'||st==='compCirc') {
    const r=(sEff.d||0.05)/2*sc, pcy=toY((sEff.d||0.05)/2);
    ctx.fillStyle=fCol; ctx.strokeStyle=sCol; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(cx,pcy,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    if (st==='compCirc'&&(sEff.di||0)>0) {
      const ri=(sEff.di||0)/2*sc;
      const f2=isZero?'rgba(245,200,66,0.20)':'rgba(245,200,66,0.30)';
      ctx.fillStyle=f2; ctx.strokeStyle='rgba(245,200,66,0.90)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(cx,pcy,Math.max(2,ri),0,Math.PI*2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('⌀'+((sEff.d||0.05)*100).toFixed(2)+'cm', cx, pcy+r+12);
  } else if (st==='circH') {
    const ro=(sEff.d||0.05)/2*sc, ri=Math.max(2,(sEff.di||0)/2*sc);
    const pcy=toY((sEff.d||0.05)/2);
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2); ctx.arc(cx,pcy,ri,0,Math.PI*2,true);
    ctx.fillStyle=fCol; ctx.fill('evenodd');
    ctx.strokeStyle=sCol; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(cx,pcy,ro,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,pcy,ri,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText('D='+((sEff.d||0.05)*100).toFixed(2)+' d='+((sEff.di||0)*100).toFixed(2)+'cm', cx, pcy+ro+12);
  } else if (st==='rect') {
    const pw=(sEff.b||0.05)*sc, ph=(sEff.h||0.08)*sc;
    const ox=cx-pw/2, oy=toY(sEff.h||0.08);
    ctx.fillStyle=fCol; ctx.strokeStyle=sCol; ctx.lineWidth=2;
    ctx.fillRect(ox,oy,pw,ph); ctx.strokeRect(ox,oy,pw,ph);
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((sEff.b||0.05)*100).toFixed(2)+'×'+((sEff.h||0.08)*100).toFixed(2)+'cm', cx, oy+ph+12);
  } else if (st==='rectH') {
    const B=sEff.b||0.05, Hh=sEff.h||0.08, t=Math.min(sEff.t||0.005,B/2-1e-4,Hh/2-1e-4);
    const tp=t*sc, ox=cx-B*sc/2, oy=toY(Hh), ow=B*sc, oh=Hh*sc;
    ctx.fillStyle=fCol; ctx.strokeStyle=sCol; ctx.lineWidth=2;
    ctx.fillRect(ox,oy+oh-tp,ow,tp); ctx.fillRect(ox,oy,ow,tp);
    ctx.fillRect(ox,oy+tp,tp,oh-2*tp); ctx.fillRect(ox+ow-tp,oy+tp,tp,oh-2*tp);
    ctx.strokeRect(ox,oy,ow,oh);
    ctx.strokeStyle=sCol+'80'; ctx.lineWidth=1;
    ctx.strokeRect(ox+tp,oy+tp,ow-2*tp,oh-2*tp);
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((B*100).toFixed(2))+'×'+((Hh*100).toFixed(2))+' t='+((t*100).toFixed(2))+'cm', cx, oy+oh+12);
  } else if (st==='compRect') {
    const B=sEff.b||0.05, Hh=sEff.h||0.08;
    const bI=sEff.bI||B*0.6, hI=sEff.hI||Hh*0.6;
    const ox=cx-B*sc/2, oy=toY(Hh), ow=B*sc, oh=Hh*sc;
    ctx.fillStyle=fCol; ctx.strokeStyle=sCol; ctx.lineWidth=2;
    ctx.fillRect(ox,oy,ow,oh); ctx.strokeRect(ox,oy,ow,oh);
    const oxi=cx-bI*sc/2, oyi=toY(Hh/2+hI/2), owi=bI*sc, ohi=hI*sc;
    ctx.fillStyle='rgba(245,200,66,0.25)'; ctx.strokeStyle='rgba(245,200,66,0.90)'; ctx.lineWidth=1.5;
    ctx.fillRect(oxi,oyi,owi,ohi); ctx.strokeRect(oxi,oyi,owi,ohi);
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px DM Mono,monospace'; ctx.textAlign='center';
    ctx.fillText(((B*100).toFixed(2))+'×'+((Hh*100).toFixed(2))+'cm', cx, oy+oh+12);
  }

  // Stress info
  const stateStr = isZero ? '—' : isTen ? 'Tracción' : 'Compresión';
  document.getElementById('eSecXBadge').textContent = 'x = ' + xm.toFixed(4) + ' m';
  document.getElementById('eSecInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-family:var(--mono);font-size:10px">
      <span style="color:var(--txt3)">x</span><span>${xm.toFixed(4)} m</span>
      <span style="color:var(--txt3)">N</span><span style="color:${isTen?'#f09060':'#60a0f0'}">${aFfmt(Nval)} ${aUnitForce}</span>
      <span style="color:var(--txt3)">σ</span><span style="color:${sCol}">${aStressFromSI(sv).toFixed(4)} ${aUnitStress}</span>
      <span style="color:var(--txt3)">A</span><span>${((eLastSolveData.Ae_arr?.[i] ?? eComputeA(sEff))*1e4).toFixed(4)} cm²</span>
      <span style="color:var(--txt3)">Estado</span><span style="color:${sCol}">${stateStr}</span>
    </div>`;
}

function eMkChart(id, xs, ys, color, unit, fill, stepped, dec) {
  const cvs = document.getElementById(id);
  if (!cvs) return;
  if (eCharts[id]) { eCharts[id].destroy(); delete eCharts[id]; }

  const n = ys.length;
  if (!n) return;

  // ── min/max annotations ────────────────────────────────────────
  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < n; i++) {
    if (ys[i] > ys[maxIdx]) maxIdx = i;
    if (ys[i] < ys[minIdx]) minIdx = i;
  }

  const threshold = Math.max(...ys.map(Math.abs)) * 0.001;
  const annotations = {};

  function mkAnn(idx, isMax) {
    const val = ys[idx];
    if (Math.abs(val) < threshold && threshold > 0) return null;
    return {
      type: 'point',
      xValue: xs[idx],
      yValue: val,
      radius: 4,
      backgroundColor: color,
      borderColor: '#0d0d0d',
      borderWidth: 2,
      label: {
        display: true,
        content: fmtVal(val, dec) + ' ' + unit,
        position: 'center',
        backgroundColor: '#1b1b1b',
        borderColor: color + '60',
        borderWidth: 1,
        borderRadius: 3,
        color: color,
        font: { family: 'DM Mono, monospace', size: 10 },
        padding: { x: 5, y: 3 },
        xAdjust: 0,
        yAdjust: isMax ? -18 : 18,
      }
    };
  }

  const added = new Set();
  const midIdx = Math.floor(n / 2);
  const candidates = [
    [maxIdx, true],
    [minIdx, false],
    [0,      ys[0] >= 0],
    [n - 1,  ys[n-1] >= 0],
    [midIdx, ys[midIdx] >= 0],
  ];
  candidates.forEach(([idx, up], ci) => {
    if (added.has(idx)) return;
    let tooClose = false;
    for (const ai of added) {
      if (Math.abs(ai - idx) < Math.floor(n / 8)) { tooClose = true; break; }
    }
    if (tooClose && ci > 1) return;
    added.add(idx);
    const ann = mkAnn(idx, up);
    if (ann) annotations['pt' + idx] = ann;
  });

  const hasNeg = ys.some(v => v < -threshold);
  const hasPos = ys.some(v => v >  threshold);
  if (hasNeg && hasPos) {
    annotations['zero'] = {
      type: 'line', yMin: 0, yMax: 0,
      borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderDash: [4, 3]
    };
  }

  // ── nearly-constant y-axis fix ─────────────────────────────────
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yMid = (yMin + yMax) / 2;
  const yAbs = Math.max(Math.abs(yMid), Math.abs(yMax), Math.abs(yMin));
  const relRange = yAbs > 1e-30 ? (yMax - yMin) / yAbs : 0;

  const yConfig = {
    grid: { color: 'rgba(255,255,255,0.03)' },
    ticks: { color: '#505048', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 5 }
  };
  if (relRange < 0.001 && yAbs > 1e-30) {
    const span = Math.max(yAbs * 0.05, 1e-6);
    yConfig.min = yMid - span;
    yConfig.max = yMid + span;
    yConfig.ticks.callback = v => parseFloat(v.toPrecision(6));
  }

  eCharts[id] = new Chart(cvs, {
    type: 'line',
    data: {
      labels: xs,
      datasets: [{ data: ys, borderColor: color, backgroundColor: color + '14',
        fill: fill, tension: 0, pointRadius: 0,
        pointHoverRadius: 4, pointHitRadius: 12, borderWidth: 1.5,
        stepped: stepped ? 'before' : false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 280 },
      interaction: { mode: 'nearest', intersect: false },
      onClick: (evt, _items, chartInstance) => {
        const points = chartInstance.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
        if (!points.length || !eLastSolveData) return;
        const eIdx = Math.min(points[0].index, eLastSolveData.N.length - 1);
        eDrawSectionAt(eIdx);
      },
      onHover: (evt, active, ci) => {
        ci.canvas.style.cursor = active.length ? 'crosshair' : 'default';
      },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        tooltip: {
          enabled: true,
          backgroundColor: '#1b1b1b',
          borderColor: 'rgba(255,255,255,0.07)',
          borderWidth: 1,
          titleColor: '#8c8880',
          bodyColor: '#ede9e3',
          titleFont: { family: 'DM Mono', size: 10 },
          bodyFont:  { family: 'DM Mono', size: 12 },
          callbacks: {
            title: items => 'x = ' + parseFloat(items[0].label).toFixed(4) + ' m',
            label: c => 'y = ' + fmtVal(c.parsed.y, dec) + ' ' + unit
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#505048', font: { family: 'DM Mono', size: 10 },
            maxTicksLimit: 6, callback: v => parseFloat(v).toFixed(3) }
        },
        y: yConfig
      }
    }
  });
}

// ── Ejes Diagram Canvas ────────────────────────────────────────
function eDrawDiagram() {
  if (aCurSub !== 'ejes') return;
  const cvs = document.getElementById('cvAxial');
  if (!cvs) return;
  const W = (cvs.parentElement?.clientWidth||600);
  const H = 120;
  cvs.width=W; cvs.height=H;
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,W,H);

  if (!eSegs.length) return;
  const L=eGetL(), PAD=46;
  const sY=Math.round(H*0.55);
  const bX1=PAD, bX2=W-PAD, bW=bX2-bX1;
  const toX=x=>bX1+(x/L)*bW;

  const maxDim = Math.max(...eSegs.map(s=>{
    if (s.secType==='rect') return Math.max(s.b,s.h);
    return s.d||0.05;
  }));
  const maxH = H*0.38;
  const pal=['#f5c842','#60b8f5','#f0a060','#50d4b8','#b090f5','#f07070'];

  eSegs.forEach((s,i)=>{
    const x1=toX(s.xa), x2=toX(s.xb);
    const dim = s.secType==='rect' ? Math.max(s.b,s.h) : (s.d||0.05);
    const hh = Math.max(6, dim/maxDim*maxH);
    const col=pal[i%pal.length];
    ctx.fillStyle=col+'28'; ctx.fillRect(x1,sY-hh/2,x2-x1,hh);
    ctx.strokeStyle=col+'80'; ctx.lineWidth=1; ctx.strokeRect(x1,sY-hh/2,x2-x1,hh);
    // hollow cutout
    if ((s.secType==='circH')&&s.di>0) {
      const hi=Math.max(3,s.di/maxDim*maxH);
      ctx.fillStyle='rgba(13,15,16,0.92)';
      ctx.fillRect(x1,sY-hi/2,x2-x1,hi);
      ctx.strokeStyle=col+'30'; ctx.lineWidth=0.5;
      ctx.strokeRect(x1,sY-hi/2,x2-x1,hi);
    }
  });

  // centerline
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.lineWidth=0.8;
  ctx.setLineDash([4,3]); ctx.beginPath(); ctx.moveTo(bX1,sY); ctx.lineTo(bX2,sY); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  // BCs
  const bc=eIBC();
  function drawWall(x,side){
    const w=9,hh2=maxH+14,rx=side==='left'?x-w:x;
    ctx.fillStyle='rgba(96,184,245,0.16)'; ctx.fillRect(rx,sY-hh2/2,w,hh2);
    ctx.strokeStyle='rgba(96,184,245,0.80)'; ctx.lineWidth=1.4; ctx.strokeRect(rx,sY-hh2/2,w,hh2);
    ctx.strokeStyle='rgba(96,184,245,0.30)'; ctx.lineWidth=1;
    for(let yy=sY-hh2/2+5;yy<sY+hh2/2;yy+=5){
      const ex=side==='left'?rx:rx+w,dx=side==='left'?-5:5;
      ctx.beginPath();ctx.moveTo(ex,yy);ctx.lineTo(ex+dx,yy+4);ctx.stroke();
    }
  }
  function drawSpringH(x,side){
    const nCoil=4,amp=5,step=5,dir=side==='left'?-1:1;
    ctx.strokeStyle='rgba(240,160,96,0.90)'; ctx.lineWidth=1.4;
    ctx.beginPath(); let cx=x; ctx.moveTo(cx,sY); cx+=dir*3; ctx.lineTo(cx,sY);
    for(let i=0;i<nCoil*2;i++){cx+=dir*step;ctx.lineTo(cx,sY+(i%2===0?amp:-amp));}
    cx+=dir*3; ctx.lineTo(cx,sY); ctx.stroke();
    ctx.strokeStyle='rgba(240,160,96,0.90)'; ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(cx,sY-8);ctx.lineTo(cx,sY+8);ctx.stroke();
    ctx.strokeStyle='rgba(240,160,96,0.30)'; ctx.lineWidth=1;
    for(let yy=sY-8;yy<=sY+8;yy+=4){ctx.beginPath();ctx.moveTo(cx,yy);ctx.lineTo(cx+dir*4,yy+3);ctx.stroke();}
  }
  function drawFree(x){
    ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x,sY-maxH/2-4);ctx.lineTo(x,sY+maxH/2+4);ctx.stroke();
  }
  if (bc[0]==='F') drawWall(bX1,'left');
  else if(bc[0]==='S') drawSpringH(bX1,'left');
  else drawFree(bX1);
  if (bc[1]==='F') drawWall(bX2,'right');
  else if(bc[1]==='S') drawSpringH(bX2,'right');
  else drawFree(bX2);

  // Labels A / B
  ctx.font='9px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.40)';
  ctx.textAlign='center';
  ctx.fillText('A',bX1-(bc[0]==='F'?18:bc[0]==='S'?22:6),sY+4);
  ctx.fillText('B',bX2+(bc[1]==='F'?18:bc[1]==='S'?22:6),sY+4);

  // ── Loads ─────────────────────────────────────────────────────
  const loadCol  = 'rgba(80,212,184,0.90)';
  const loadFnt  = 'rgba(80,212,184,0.55)';
  const tempHot  = 'rgba(240,100,72,0.75)';
  const tempLbl  = 'rgba(240,100,72,0.90)';

  function hArrow(px, color, dir) {
    // Horizontal arrow: tip at px, shaft going opposite to dir
    const AH=26, tip=8;
    const ax1=px-dir*AH;
    ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.moveTo(ax1,sY); ctx.lineTo(px,sY); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px,sY);
    ctx.lineTo(px-dir*tip, sY-5);
    ctx.lineTo(px-dir*tip, sY+5);
    ctx.closePath(); ctx.fill();
  }

  eLoads.forEach(l => {
    const tipo = l.tipo || 'pun';

    if (tipo === 'pun') {
      const val = l.val||0; if (Math.abs(val)<1e-15) return;
      const px  = toX(l.x||0), dir = val>0?1:-1;
      hArrow(px, loadCol, dir);
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle=loadCol; ctx.textAlign='center';
      ctx.fillText(fmtSciPreview(Math.abs(val)), px-dir*13, sY-12);

    } else if (tipo === 'dis') {
      const val=l.val||0; if (Math.abs(val)<1e-15) return;
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const dir=val>0?1:-1, sp=22;
      for (let px=x1+sp/2; px<=x2-sp/4; px+=sp) hArrow(px, loadFnt, dir);
      ctx.strokeStyle='rgba(80,212,184,0.30)'; ctx.lineWidth=1;
      const lineY = sY - (dir>0?1:-1)*38;
      ctx.beginPath(); ctx.moveTo(x1,lineY); ctx.lineTo(x2,lineY); ctx.stroke();
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle=loadCol; ctx.textAlign='center';
      ctx.fillText(fmtSciPreview(Math.abs(val)), (x1+x2)/2, lineY-(dir>0?8:-18));

    } else if (tipo === 'tri') {
      const va=l.va||0, vb=l.vb||0;
      const maxAbs=Math.max(Math.abs(va),Math.abs(vb))||1;
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const nArr=Math.max(3, Math.round((x2-x1)/22));
      const domDir=(Math.abs(va)>=Math.abs(vb)?(va||vb):(vb||va))>=0?1:-1;
      for (let i=0; i<=nArr; i++) {
        const frac=i/nArr, px=x1+(x2-x1)*frac;
        const qv=va*(1-frac)+vb*frac; if (Math.abs(qv)<1e-12*maxAbs) continue;
        const len=22*Math.abs(qv)/maxAbs, dir=qv>=0?1:-1;
        const tip=8*Math.abs(qv)/maxAbs;
        ctx.strokeStyle=loadFnt; ctx.fillStyle=loadFnt; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.moveTo(px-dir*len,sY); ctx.lineTo(px,sY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px,sY); ctx.lineTo(px-dir*tip,sY-4); ctx.lineTo(px-dir*tip,sY+4); ctx.closePath(); ctx.fill();
      }

    } else if (tipo === 'temp') {
      const DT=l.DT||0; if (Math.abs(DT)<1e-10) return;
      const x1=toX(l.xa||0), x2=toX(l.xb||L);
      const segH = maxH/2+3;
      ctx.fillStyle = DT>0 ? 'rgba(240,100,72,0.18)' : 'rgba(72,130,240,0.18)';
      ctx.fillRect(x1, sY-segH, x2-x1, segH*2);
      ctx.strokeStyle = DT>0 ? 'rgba(240,100,72,0.55)' : 'rgba(72,130,240,0.55)';
      ctx.lineWidth=1; ctx.strokeRect(x1, sY-segH, x2-x1, segH*2);
      const col2 = DT>0 ? tempLbl : 'rgba(72,130,240,0.90)';
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle=col2; ctx.textAlign='center';
      const aDisp = l.alphaUnit==='si'
        ? `α=${(l.alpha||12e-6).toExponential(2)}/°C`
        : `α=${((l.alpha||12e-6)*1e6).toFixed(1)}µ/°C`;
      ctx.fillText(`ΔT=${DT>0?'+':''}${DT}°C  ${aDisp}`, (x1+x2)/2, sY-segH-5);
    }
  });

  // x-axis ticks
  ctx.font='8px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.22)';
  ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=0.5;
  const nT=Math.min(6,Math.floor(bW/60));
  for(let i=0;i<=nT;i++){
    const frac=i/nT, px=bX1+frac*bW;
    ctx.textAlign='center';
    ctx.fillText((frac*L).toFixed(3)+'m',px,sY+maxH/2+16);
    ctx.beginPath();ctx.moveTo(px,sY+maxH/2+2);ctx.lineTo(px,sY+maxH/2+6);ctx.stroke();
  }

  // Positive direction indicator → +
  ctx.save();
  ctx.font='bold 9px DM Mono,monospace';
  ctx.fillStyle='rgba(80,212,184,0.55)';
  ctx.textAlign='left';
  ctx.fillText('→ +', bX2 + 4, sY + 3);
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════
// BARRAS — 2D TRUSS FEM
// ══════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
let bNodes    = [];
let bBars     = [];
let bSupports = [];
let bLoads    = [];
let bNid=0, bBid=0, bSpid=0, bLid2=0;
let bLastSolveData = null;

// ── Nodes ─────────────────────────────────────────────────────
function bAddNode() {
  const n=bNodes.length;
  const x=n?bNodes[n-1].x+1:0, y=n?bNodes[n-1].y:0;
  bNodes.push({id:++bNid, x:aLtoSI(x), y:aLtoSI(y)});
  bRenderNodes(); bDrawTruss();
}
function bDelNode(id) {
  // Remove connected bars and supports/loads
  bBars     = bBars.filter(b=>b.nA!==id&&b.nB!==id);
  bSupports = bSupports.filter(s=>s.nodeId!==id);
  bLoads    = bLoads.filter(l=>l.nodeId!==id);
  bNodes.splice(bNodes.findIndex(n=>n.id===id),1);
  bRenderNodes(); bRenderBars(); bRenderSupports(); bRenderLoads(); bDrawTruss();
}
function bSetNode(id, field, val) {
  const n=bNodes.find(n=>n.id===id); if(!n) return;
  const v=parseFloat(val); if(isNaN(v)) return;
  n[field]=aLtoSI(v);
  bDrawTruss();
}
function bRenderNodes() {
  const cont=document.getElementById('abNodes'); if(!cont) return;
  const hint=document.getElementById('abHNodes');
  if(hint) hint.style.display=bNodes.length?'none':'block';
  cont.innerHTML=bNodes.map((n,i)=>`<div class="card">
    <div class="card-head"><span class="badge b-seg">N${i+1}</span><button class="del" onclick="bDelNode(${n.id})">&#x2715;</button></div>
    <div class="r2">
      <div class="f"><label>x (${aUnitLen})</label><input type="number" value="${aLfmt(n.x)}" step="0.01" onchange="bSetNode(${n.id},'x',this.value);bRenderNodes()"></div>
      <div class="f"><label>y (${aUnitLen})</label><input type="number" value="${aLfmt(n.y)}" step="0.01" onchange="bSetNode(${n.id},'y',this.value);bRenderNodes()"></div>
    </div>
  </div>`).join('');
}

// ── Bars ──────────────────────────────────────────────────────
function bAddBar() {
  if(bNodes.length<2){aShowErr('Necesitás al menos 2 nodos para agregar una barra.');return;}
  aShowErr('');
  const n1=bNodes[0],n2=bNodes[1];
  bBars.push({id:++bBid, nA:n1.id, nB:n2.id, E:200e9, A:1e-4, delta:0});
  bRenderBars(); bDrawTruss();
}
function bDelBar(id) {
  bBars.splice(bBars.findIndex(b=>b.id===id),1);
  bRenderBars(); bDrawTruss();
}
function bSetBar(id, field, rawVal) {
  const b=bBars.find(b=>b.id===id); if(!b) return;
  const v=parseSci?parseSci(String(rawVal)):parseFloat(rawVal);
  if(isNaN(v)) return;
  if(field==='E')     b.E     = aEtoSI(v);
  else if(field==='A') b.A    = aAreaToSI(v);
  else if(field==='delta') b.delta = aLtoSI(v);
  else if(field==='nA'||field==='nB') b[field]=parseInt(rawVal);
  bDrawTruss();
}
function bNodeLabel(id) {
  const i=bNodes.findIndex(n=>n.id===id); return i>=0?`N${i+1}`:'?';
}
function bRenderBars() {
  const cont=document.getElementById('abBars'); if(!cont) return;
  const hint=document.getElementById('abHBars');
  if(hint) hint.style.display=bBars.length?'none':'block';
  const nodeOpts=bNodes.map((n,i)=>`<option value="${n.id}">N${i+1} (${aLfmt(n.x)}, ${aLfmt(n.y)})</option>`).join('');
  cont.innerHTML=bBars.map((b,i)=>{
    const dx=bNodes.find(n=>n.id===b.nB)?.x-bNodes.find(n=>n.id===b.nA)?.x||0;
    const dy=bNodes.find(n=>n.id===b.nB)?.y-bNodes.find(n=>n.id===b.nA)?.y||0;
    const L=Math.sqrt(dx*dx+dy*dy);
    return `<div class="card">
      <div class="card-head"><span class="badge b-dis">Barra ${i+1}</span><button class="del" onclick="bDelBar(${b.id})">&#x2715;</button></div>
      <div class="r2">
        <div class="f"><label>Nodo A</label><select onchange="bSetBar(${b.id},'nA',this.value)">${nodeOpts.replace(`value="${b.nA}"`,`value="${b.nA}" selected`)}</select></div>
        <div class="f"><label>Nodo B</label><select onchange="bSetBar(${b.id},'nB',this.value)">${nodeOpts.replace(`value="${b.nB}"`,`value="${b.nB}" selected`)}</select></div>
      </div>
      <div class="r2">
        ${sciField({label:`E (${aUnitE})`, value:+(b.E/_aE[aUnitE]).toFixed(3), min:0.001, onChangeFn:`bSetBar(${b.id},'E',__v__)`})}
        ${sciField({label:`A (${aUnitLen}²)`, value:+aAreaFromSI(b.A).toFixed(6), min:1e-9, onChangeFn:`bSetBar(${b.id},'A',__v__)`})}
      </div>
      <div class="r2">
        <div class="f"><label>ΔL error montaje (${aUnitLen})</label><input type="number" value="${aLfmt(b.delta||0)}" step="0.0001" onchange="bSetBar(${b.id},'delta',this.value)"></div>
        <div class="f seg-ghost"><label>L barra (${aUnitLen})</label><input type="text" value="${aLfmt(L)}" disabled></div>
      </div>
    </div>`;
  }).join('');
  setTimeout(initSciBadges,0);
}

// ── Supports ──────────────────────────────────────────────────
function bAddSupport() {
  if(!bNodes.length){aShowErr('Agrega nodos primero.');return;}
  aShowErr('');
  bSupports.push({id:++bSpid, nodeId:bNodes[0].id, type:'pin'});
  bRenderSupports(); bDrawTruss();
}
function bDelSupport(id) {
  bSupports.splice(bSupports.findIndex(s=>s.id===id),1);
  bRenderSupports(); bDrawTruss();
}
function bSetSupport(id, field, val) {
  const s=bSupports.find(s=>s.id===id); if(!s) return;
  if(field==='nodeId') s.nodeId=parseInt(val);
  else s[field]=val;
  bDrawTruss();
}
function bRenderSupports() {
  const cont=document.getElementById('abSupports'); if(!cont) return;
  const hint=document.getElementById('abHSupports');
  if(hint) hint.style.display=bSupports.length?'none':'block';
  const nodeOpts=bNodes.map((n,i)=>`<option value="${n.id}">N${i+1}</option>`).join('');
  const typeOpts=[
    ['pin','1er género / Pin (ux=uy=0)'],
    ['rollerH','2do género horizontal (uy=0)'],
    ['rollerV','2do género vertical (ux=0)'],
  ];
  cont.innerHTML=bSupports.map((s,i)=>`<div class="card">
    <div class="card-head"><span class="badge b-pol">Apoyo ${i+1}</span><button class="del" onclick="bDelSupport(${s.id})">&#x2715;</button></div>
    <div class="r2">
      <div class="f"><label>Nodo</label><select onchange="bSetSupport(${s.id},'nodeId',this.value);bRenderSupports()">${nodeOpts.replace(`value="${s.nodeId}"`,`value="${s.nodeId}" selected`)}</select></div>
      <div class="f"><label>Tipo</label><select onchange="bSetSupport(${s.id},'type',this.value);bRenderSupports();bDrawTruss()">${typeOpts.map(([v,l])=>`<option value="${v}"${s.type===v?' selected':''}>${l}</option>`).join('')}</select></div>
    </div>
  </div>`).join('');
}

// ── Loads ─────────────────────────────────────────────────────
function bAddLoad() {
  if(!bNodes.length){aShowErr('Agrega nodos primero.');return;}
  aShowErr('');
  bLoads.push({id:++bLid2, nodeId:bNodes[0].id, Fx:0, Fy:0});
  bRenderLoads(); bDrawTruss();
}
function bDelLoad(id) {
  bLoads.splice(bLoads.findIndex(l=>l.id===id),1);
  bRenderLoads(); bDrawTruss();
}
function bSetLoad(id, field, rawVal) {
  const l=bLoads.find(l=>l.id===id); if(!l) return;
  if(field==='nodeId') { l.nodeId=parseInt(rawVal); bRenderLoads(); bDrawTruss(); return; }
  const v=parseSci?parseSci(String(rawVal)):parseFloat(rawVal);
  l[field]=isNaN(v)?0:aFtoSI(v);
  bDrawTruss();
}
function bRenderLoads() {
  const cont=document.getElementById('abLoads'); if(!cont) return;
  const hint=document.getElementById('abHLoads');
  if(hint) hint.style.display=bLoads.length?'none':'block';
  const nodeOpts=bNodes.map((n,i)=>`<option value="${n.id}">N${i+1}</option>`).join('');
  cont.innerHTML=bLoads.map((l,i)=>`<div class="card">
    <div class="card-head"><span class="badge b-pun">Carga ${i+1}</span><button class="del" onclick="bDelLoad(${l.id})">&#x2715;</button></div>
    <div class="r1"><div class="f"><label>Nodo</label><select onchange="bSetLoad(${l.id},'nodeId',this.value)">${nodeOpts.replace(`value="${l.nodeId}"`,`value="${l.nodeId}" selected`)}</select></div></div>
    <div class="r2">
      ${sciField({label:`Fx (${aUnitForce}) →+`, value:+aFfmt(l.Fx||0), onChangeFn:`bSetLoad(${l.id},'Fx',__v__)`})}
      ${sciField({label:`Fy (${aUnitForce}) ↑+`, value:+aFfmt(l.Fy||0), onChangeFn:`bSetLoad(${l.id},'Fy',__v__)`})}
    </div>
  </div>`).join('');
  setTimeout(initSciBadges,0);
}

// ── Solver ────────────────────────────────────────────────────
function bSolve() {
  aShowErr('');
  if(bNodes.length<2)  { aShowErr('Agrega al menos 2 nodos.'); return; }
  if(!bBars.length)    { aShowErr('Agrega al menos una barra.'); return; }
  if(!bSupports.length){ aShowErr('Agrega al menos un apoyo.'); return; }

  const nn=bNodes.length, nDOF=2*nn;
  const K=Array.from({length:nDOF},()=>new Array(nDOF).fill(0));
  const F=new Array(nDOF).fill(0);

  bBars.forEach(bar=>{
    const iA=bNodes.findIndex(n=>n.id===bar.nA);
    const iB=bNodes.findIndex(n=>n.id===bar.nB);
    if(iA<0||iB<0) return;
    const nA=bNodes[iA], nB=bNodes[iB];
    const dx=nB.x-nA.x, dy=nB.y-nA.y;
    const L=Math.sqrt(dx*dx+dy*dy);
    if(L<1e-12) return;
    const c=dx/L, s=dy/L, k=bar.E*bar.A/L;
    const d=[2*iA,2*iA+1,2*iB,2*iB+1];
    const km=[[c*c,c*s,-c*c,-c*s],[c*s,s*s,-c*s,-s*s],[-c*c,-c*s,c*c,c*s],[-c*s,-s*s,c*s,s*s]];
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) K[d[i]][d[j]]+=k*km[i][j];
    if(bar.delta&&Math.abs(bar.delta)>1e-15){
      const f0=k*bar.delta;
      F[d[0]]-=f0*c; F[d[1]]-=f0*s; F[d[2]]+=f0*c; F[d[3]]+=f0*s;
    }
  });

  bLoads.forEach(load=>{
    const ni=bNodes.findIndex(n=>n.id===load.nodeId); if(ni<0) return;
    F[2*ni]+=(load.Fx||0); F[2*ni+1]+=(load.Fy||0);
  });

  // Fixed DOFs
  const fixed=new Set();
  bSupports.forEach(sup=>{
    const ni=bNodes.findIndex(n=>n.id===sup.nodeId); if(ni<0) return;
    if(sup.type==='pin')     { fixed.add(2*ni); fixed.add(2*ni+1); }
    if(sup.type==='rollerH') { fixed.add(2*ni+1); }
    if(sup.type==='rollerV') { fixed.add(2*ni); }
  });

  const freeList=[...Array(nDOF).keys()].filter(i=>!fixed.has(i));
  if(!freeList.length){ aShowErr('Sistema sobredeterminado.'); return; }

  const nF=freeList.length;
  const Kf=Array.from({length:nF},()=>new Array(nF).fill(0));
  const Ff=new Array(nF).fill(0);
  freeList.forEach((gi,i)=>{ Ff[i]=F[gi]; freeList.forEach((gj,j)=>{ Kf[i][j]=K[gi][gj]; }); });

  const uf=luSolve(Kf,Ff);
  if(!uf){ aShowErr('Estructura inestable (sistema singular). Verificá apoyos y conectividad.'); return; }

  const u=new Array(nDOF).fill(0);
  freeList.forEach((gi,i)=>{ u[gi]=uf[i]; });

  // Bar forces
  const barForces=bBars.map(bar=>{
    const iA=bNodes.findIndex(n=>n.id===bar.nA);
    const iB=bNodes.findIndex(n=>n.id===bar.nB);
    if(iA<0||iB<0) return {N:0,sigma:0,elong:0};
    const nA=bNodes[iA],nB=bNodes[iB];
    const dx=nB.x-nA.x,dy=nB.y-nA.y;
    const L=Math.sqrt(dx*dx+dy*dy); if(L<1e-12) return {N:0,sigma:0,elong:0};
    const c=dx/L,s=dy/L;
    const elong=c*(u[2*iB]-u[2*iA])+s*(u[2*iB+1]-u[2*iA+1]);
    const N=bar.E*bar.A/L*(elong-(bar.delta||0));
    return {N, sigma:N/bar.A, elong};
  });

  // Reactions
  const reactions=[];
  bSupports.forEach(sup=>{
    const ni=bNodes.findIndex(n=>n.id===sup.nodeId); if(ni<0) return;
    let Rx=0,Ry=0;
    for(let j=0;j<nDOF;j++){ Rx+=K[2*ni][j]*u[j]; Ry+=K[2*ni+1][j]*u[j]; }
    Rx-=F[2*ni]; Ry-=F[2*ni+1];
    const hasX=sup.type==='pin'||sup.type==='rollerV';
    const hasY=sup.type==='pin'||sup.type==='rollerH';
    reactions.push({sup,Rx:hasX?Rx:null,Ry:hasY?Ry:null});
  });

  bLastSolveData={u,barForces,reactions};
  bShowResults(barForces,reactions,u);
  bDrawTruss(bLastSolveData);
}

function bShowResults(barForces, reactions, u) {
  document.getElementById('aEmptyState').style.display='none';
  document.getElementById('aResContent').style.display='';
  document.getElementById('aEjesRes').style.display='none';
  document.getElementById('aBarrasRes').style.display='';

  const Nmax=Math.max(...barForces.map(f=>Math.abs(f.N)));
  const sMax=Math.max(...barForces.map(f=>Math.abs(f.sigma)));
  const uMax=Math.max(...u.map(Math.abs));
  document.getElementById('bMrow').innerHTML=[
    {l:'N máx',v:aFfmt(Nmax),u:aUnitForce},
    {l:'σ máx',v:aStressFromSI(sMax).toFixed(3),u:aUnitStress},
    {l:'u máx',v:(uMax*1e3).toFixed(4),u:'mm'},
  ].map(m=>`<div class="met"><p class="ml">${m.l}</p><p class="mv">${m.v}<span class="mu"> ${m.u}</span></p></div>`).join('');

  // Bar forces table
  document.getElementById('bBarTable').innerHTML=`
    <table style="width:100%;font-family:var(--mono);font-size:10px;border-collapse:collapse">
      <thead><tr style="color:var(--txt3)"><th style="text-align:left;padding:4px 6px">Barra</th><th>N (${aUnitForce})</th><th>σ (${aUnitStress})</th><th>δ (mm)</th><th>Estado</th></tr></thead>
      <tbody>${bBars.map((bar,i)=>{
        const f=barForces[i];
        const state=Math.abs(f.N)<1e-6*Math.max(1,Nmax)?'Nula':f.N>0?'<span style="color:var(--orange)">Tracción</span>':'<span style="color:var(--blue)">Compresión</span>';
        return `<tr style="border-top:1px solid rgba(255,255,255,0.05)">
          <td style="padding:4px 6px">B${i+1} (N${bNodes.findIndex(n=>n.id===bar.nA)+1}→N${bNodes.findIndex(n=>n.id===bar.nB)+1})</td>
          <td style="text-align:center">${aFfmt(f.N)}</td>
          <td style="text-align:center">${aStressFromSI(f.sigma).toFixed(3)}</td>
          <td style="text-align:center">${(f.elong*1e3).toFixed(4)}</td>
          <td style="text-align:center">${state}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  // Node displacements
  document.getElementById('bNodeTable').innerHTML=`
    <table style="width:100%;font-family:var(--mono);font-size:10px;border-collapse:collapse">
      <thead><tr style="color:var(--txt3)"><th style="text-align:left;padding:4px 6px">Nodo</th><th>ux (mm)</th><th>uy (mm)</th></tr></thead>
      <tbody>${bNodes.map((n,i)=>`<tr style="border-top:1px solid rgba(255,255,255,0.05)">
        <td style="padding:4px 6px">N${i+1}</td>
        <td style="text-align:center">${(u[2*i]*1e3).toFixed(5)}</td>
        <td style="text-align:center">${(u[2*i+1]*1e3).toFixed(5)}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  // Reactions
  document.getElementById('bReact').innerHTML=reactions.map((r,i)=>{
    const ni=bNodes.findIndex(n=>n.id===r.sup.nodeId);
    return `<div class="ir"><span class="ik">N${ni+1}</span><span class="iv">${r.Rx!==null?'Rx='+aFfmt(r.Rx)+' '+aUnitForce:''}${r.Rx!==null&&r.Ry!==null?' · ':''}${r.Ry!==null?'Ry='+aFfmt(r.Ry)+' '+aUnitForce:''}</span></div>`;
  }).join('');
}

// ── Truss Canvas ───────────────────────────────────────────────
function bDrawTruss(solveData=null) {
  if(aCurSub!=='barras') return;
  const cvs=document.getElementById('cvAxial'); if(!cvs) return;
  const W=(cvs.parentElement?.clientWidth||600);
  const H=300;
  cvs.width=W; cvs.height=H;
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,0.04)';
  ctx.fillRect(0,0,W,H);

  if(!bNodes.length){ ctx.font='11px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.20)'; ctx.textAlign='center'; ctx.fillText('Agrega nodos para visualizar la armadura',W/2,H/2); return; }

  // Bounding box
  const xs=bNodes.map(n=>n.x), ys=bNodes.map(n=>n.y);
  let minX=Math.min(...xs),maxX=Math.max(...xs);
  let minY=Math.min(...ys),maxY=Math.max(...ys);
  const spanX=maxX-minX||1, spanY=maxY-minY||1;
  const PAD=70;
  const scale=Math.min((W-2*PAD)/spanX,(H-2*PAD)/spanY);
  const offX=W/2-(minX+spanX/2)*scale;
  const offY=H/2+(minY+spanY/2)*scale;
  const tX=x=>offX+x*scale;
  const tY=y=>offY-y*scale;

  // Deformed scale
  let dispScale=0;
  if(solveData?.u){
    const uMax=Math.max(...bNodes.map((_,i)=>Math.hypot(solveData.u[2*i],solveData.u[2*i+1])));
    dispScale=uMax>1e-12?Math.min(spanX,spanY)*0.08/uMax:0;
  }

  // Draw original bars (faded)
  bBars.forEach((bar,idx)=>{
    const nA=bNodes.find(n=>n.id===bar.nA),nB=bNodes.find(n=>n.id===bar.nB);
    if(!nA||!nB) return;
    let col='rgba(255,255,255,0.18)';
    if(solveData?.barForces){
      const N=solveData.barForces[idx]?.N||0;
      const rel=Math.abs(N)/Math.max(1e-10,...solveData.barForces.map(f=>Math.abs(f.N)));
      if(N>1e-8)  col=`rgba(240,${Math.round(100-rel*60)},80,${0.5+rel*0.5})`;
      else if(N<-1e-8) col=`rgba(80,${Math.round(140+rel*60)},240,${0.5+rel*0.5})`;
    }
    ctx.strokeStyle=col; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(tX(nA.x),tY(nA.y)); ctx.lineTo(tX(nB.x),tY(nB.y)); ctx.stroke();
    // Bar label
    const mx=(nA.x+nB.x)/2,my=(nA.y+nB.y)/2;
    ctx.font='8px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.textAlign='center';
    ctx.fillText(`B${idx+1}`,tX(mx),tY(my)-6);
    // Force label
    if(solveData?.barForces){
      const N=solveData.barForces[idx]?.N||0;
      if(Math.abs(N)>1e-10){
        ctx.fillStyle=N>0?'rgba(240,150,80,0.90)':'rgba(80,160,240,0.90)';
        ctx.fillText(aFfmt(N)+' '+aUnitForce,tX(mx),tY(my)+12);
      }
    }
  });

  // Deformed shape
  if(solveData&&dispScale>0){
    ctx.strokeStyle='rgba(80,212,184,0.35)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
    bBars.forEach(bar=>{
      const iA=bNodes.findIndex(n=>n.id===bar.nA),iB=bNodes.findIndex(n=>n.id===bar.nB);
      if(iA<0||iB<0) return;
      const nA=bNodes[iA],nB=bNodes[iB];
      const uAx=solveData.u[2*iA]*dispScale,uAy=solveData.u[2*iA+1]*dispScale;
      const uBx=solveData.u[2*iB]*dispScale,uBy=solveData.u[2*iB+1]*dispScale;
      ctx.beginPath();
      ctx.moveTo(tX(nA.x+uAx),tY(nA.y+uAy));
      ctx.lineTo(tX(nB.x+uBx),tY(nB.y+uBy));
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Supports
  bSupports.forEach(sup=>{
    const node=bNodes.find(n=>n.id===sup.nodeId); if(!node) return;
    const px=tX(node.x),py=tY(node.y);
    ctx.strokeStyle='rgba(96,184,245,0.85)'; ctx.fillStyle='rgba(96,184,245,0.15)'; ctx.lineWidth=1.4;
    if(sup.type==='pin'){
      const hw=10,base=py+16;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-hw,base);ctx.lineTo(px+hw,base);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(px-hw-3,base+2);ctx.lineTo(px+hw+3,base+2);ctx.strokeStyle='rgba(96,184,245,0.50)';ctx.stroke();
      ctx.strokeStyle='rgba(96,184,245,0.30)'; ctx.lineWidth=1;
      for(let xx=px-hw-2;xx<=px+hw+2;xx+=5){ctx.beginPath();ctx.moveTo(xx,base+2);ctx.lineTo(xx+3,base+7);ctx.stroke();}
    } else if(sup.type==='rollerH'){
      const hw=10,base=py+14;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-hw,base);ctx.lineTo(px+hw,base);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(96,184,245,0.85)';ctx.stroke();
      [-5,0,5].forEach(dx=>{ctx.beginPath();ctx.arc(px+dx,base+4,3,0,Math.PI*2);ctx.strokeStyle='rgba(96,184,245,0.85)';ctx.lineWidth=1.2;ctx.stroke();});
      ctx.beginPath();ctx.moveTo(px-hw-3,base+10);ctx.lineTo(px+hw+3,base+10);ctx.strokeStyle='rgba(96,184,245,0.50)';ctx.stroke();
    } else if(sup.type==='rollerV'){
      const hh=10,base=px-14;
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(base,py-hh);ctx.lineTo(base,py+hh);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(96,184,245,0.85)';ctx.stroke();
      [-5,0,5].forEach(dy=>{ctx.beginPath();ctx.arc(base-4,py+dy,3,0,Math.PI*2);ctx.strokeStyle='rgba(96,184,245,0.85)';ctx.lineWidth=1.2;ctx.stroke();});
      ctx.beginPath();ctx.moveTo(base-10,py-hh-3);ctx.lineTo(base-10,py+hh+3);ctx.strokeStyle='rgba(96,184,245,0.50)';ctx.stroke();
    }
  });

  // Loads
  bLoads.forEach(load=>{
    const node=bNodes.find(n=>n.id===load.nodeId); if(!node) return;
    const px=tX(node.x),py=tY(node.y);
    function arrow(fx,fy,label){
      const len=32,ah=8;
      const dx=fx,dy=-fy; // screen y flipped
      const mag=Math.hypot(dx,dy)||1;
      const nx=dx/mag,ny=dy/mag;
      const x1=px-nx*len,y1=py-ny*len;
      ctx.strokeStyle='rgba(80,212,184,0.90)'; ctx.fillStyle='rgba(80,212,184,0.90)'; ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(px,py);ctx.stroke();
      ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-nx*ah-ny*ah*0.5,py-ny*ah+nx*ah*0.5);ctx.lineTo(px-nx*ah+ny*ah*0.5,py-ny*ah-nx*ah*0.5);ctx.closePath();ctx.fill();
      ctx.font='9px DM Mono,monospace'; ctx.fillStyle='rgba(80,212,184,0.90)'; ctx.textAlign='center';
      ctx.fillText(label,x1+nx*8-ny*12,y1+ny*8+nx*12);
    }
    if(Math.abs(load.Fx||0)>1e-15) arrow(load.Fx>0?1:-1,0,aFfmt(Math.abs(load.Fx))+aUnitForce);
    if(Math.abs(load.Fy||0)>1e-15) arrow(0,load.Fy>0?1:-1,aFfmt(Math.abs(load.Fy))+aUnitForce);
  });

  // Nodes
  bNodes.forEach((node,i)=>{
    const px=tX(node.x),py=tY(node.y);
    ctx.beginPath();ctx.arc(px,py,6,0,Math.PI*2);
    ctx.fillStyle='#f5c842';ctx.fill();
    ctx.strokeStyle='#0d0f10';ctx.lineWidth=1.2;ctx.stroke();
    ctx.font='bold 9px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.80)'; ctx.textAlign='center';
    ctx.fillText(`N${i+1}`,px,py-10);
    if(solveData){
      ctx.font='8px DM Mono,monospace'; ctx.fillStyle='rgba(80,212,184,0.70)';
      ctx.fillText(`(${(solveData.u[2*i]*1e3).toFixed(2)},${(solveData.u[2*i+1]*1e3).toFixed(2)})mm`,px,py+16);
    }
  });
}

// ── Tab switchers ──────────────────────────────────────────────
function aEjesSwitchTab(name,el){
  document.querySelectorAll('#aEjesAside .tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('ae-geo').style.display   = name==='geo'   ?'':'none';
  document.getElementById('ae-loads').style.display = name==='loads' ?'':'none';
}
function aBarrasSwitchTab(name,el){
  document.querySelectorAll('#aBarrasAside .tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  ['nodes','bars','supports','loads'].forEach(s=>{
    document.getElementById('ab-'+s).style.display = name===s?'':'none';
  });
}

// ── Dispatcher ────────────────────────────────────────────────
function aSolve() {
  if(aCurSub==='ejes') eSolve(); else bSolve();
}

// ── Save / Load ───────────────────────────────────────────────
function aSaveProject() {
  const data={
    version:'3.5', module:'axial', sub:aCurSub,
    ejes:{ segs:JSON.parse(JSON.stringify(eSegs)), loads:JSON.parse(JSON.stringify(eLoads)), eSid, eLid, bc:eIBC() },
    barras:{ nodes:JSON.parse(JSON.stringify(bNodes)), bars:JSON.parse(JSON.stringify(bBars)), supports:JSON.parse(JSON.stringify(bSupports)), loads:JSON.parse(JSON.stringify(bLoads)), bNid, bBid, bSpid, bLid2 },
    units:{ aUnitForce, aUnitLen, aUnitDim, aUnitE, aUnitStress },
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download='proyecto_axial.json'; a.click(); URL.revokeObjectURL(a.href);
}

function aLoadProject(file) {
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      if(data.module&&data.module!=='axial'){aShowErr('Archivo de otro módulo ('+data.module+').'); return;}
      const u=data.units||{};
      if(u.aUnitForce)  aUnitForce =u.aUnitForce;
      if(u.aUnitLen)    aUnitLen   =u.aUnitLen;
      if(u.aUnitDim)    aUnitDim   =u.aUnitDim;
      if(u.aUnitE)      aUnitE     =u.aUnitE;
      if(u.aUnitStress) aUnitStress=u.aUnitStress;
      const ej=data.ejes||{};
      eSegs.length=0; (ej.segs||[]).forEach(s=>eSegs.push(s));
      eLoads.length=0;(ej.loads||[]).forEach(l=>eLoads.push(l));
      eSid=ej.eSid||eSegs.reduce((m,s)=>Math.max(m,s.id||0),0);
      eLid=ej.eLid||eLoads.reduce((m,l)=>Math.max(m,l.id||0),0);
      const bcEl=document.getElementById('eBC');
      if(bcEl&&ej.bc) bcEl.value=ej.bc;
      const br=data.barras||{};
      bNodes.length=0;   (br.nodes||[]).forEach(n=>bNodes.push(n));
      bBars.length=0;    (br.bars||[]).forEach(b=>bBars.push(b));
      bSupports.length=0;(br.supports||[]).forEach(s=>bSupports.push(s));
      bLoads.length=0;   (br.loads||[]).forEach(l=>bLoads.push(l));
      bNid=br.bNid||0; bBid=br.bBid||0; bSpid=br.bSpid||0; bLid2=br.bLid2||0;
      aRenderUnitPanel();
      eRenderSegs(); eRenderLoads(); eRenderBCFields();
      bRenderNodes(); bRenderBars(); bRenderSupports(); bRenderLoads();
      if(data.sub) switchAxialSub(data.sub);
      aShowErr('');
    } catch(err){ aShowErr('Error al cargar: '+err.message); }
  };
  reader.readAsText(file);
}

// ── Init ──────────────────────────────────────────────────────
function aInit() {
  aRenderUnitPanel();
  eRenderBCFields();
  eAddSeg();
  eAddLoad();
  // Default barras example: simple 2-bar truss
  bNodes.push({id:++bNid,x:0,y:0});
  bNodes.push({id:++bNid,x:aLtoSI(2),y:0});
  bNodes.push({id:++bNid,x:aLtoSI(1),y:aLtoSI(1)});
  bBars.push({id:++bBid,nA:1,nB:3,E:200e9,A:1e-4,delta:0});
  bBars.push({id:++bBid,nA:2,nB:3,E:200e9,A:1e-4,delta:0});
  bSupports.push({id:++bSpid,nodeId:1,type:'pin'});
  bSupports.push({id:++bSpid,nodeId:2,type:'rollerH'});
  bLoads.push({id:++bLid2,nodeId:3,Fx:0,Fy:-10e3});
  bRenderNodes(); bRenderBars(); bRenderSupports(); bRenderLoads();
  setTimeout(()=>{eDrawDiagram();bDrawTruss();},80);
}

// ── Resize ────────────────────────────────────────────────────
function aOnResize() {
  if(aCurSub==='ejes') eDrawDiagram(); else bDrawTruss(bLastSolveData);
}

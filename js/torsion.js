// ══════════════════════════════════════════════════════════════
// torsion.js — Módulo de Torsión FEM
// Contenido:
//   · Estado: segs, loads, selectedPoints, lastSolveData
//   · Segmentos: addSeg, delSeg, renderSegs, drawSegBar
//   · Condiciones de borde: renderBCFields, getKA, getKB
//   · Cargas: addLoad, delLoad, setLoad, renderLoads
//   · Utilidades: iL, iN, iBC, showErr, switchTab, getGJ, qAt
//   · Solver: clearSelections, mkChart, solve
//   · Visualización: drawSectionPanel, stpAttachEvents, drawSegBarData
//   · Resize
// ══════════════════════════════════════════════════════════════
// ── STATE ──────────────────────────────────────────────────────
const segs = [];
const loads = [];
let sid = 0, lid = 0;
let _tShaftRedrawTimer = null;
const charts = {};
const selectedPoints = {};

// Last solve result — needed to redraw section panel on click
let lastSolveData = null;  // { T, tau, GJe, le, phi, nEl, L }

// State for interactive τ(r) diagram hover/click
let stpDiagState = null;


function addSeg() {
  const n = segs.length;
  const u = currentUnits;

  if (n === 0) {
    segs.push({
      id: ++sid,
      xa: 0,
      xb: 0.312,
      d: 0.024, d2: undefined, di: 0, di2: undefined,
      G: u.defaultG,
      composite: false,
      G2: u.defaultG * 0.38,
    });
    updateLDisplay();
    renderSegs();
    return;
  }

  const last = segs[n - 1];
  // New segment: inherits last segment's properties, starts where last ends, adds same length
  const lastLen = last.xb - last.xa;
  const newSeg = {
    id: ++sid,
    xa: +last.xb.toFixed(6),
    xb: +(last.xb + lastLen).toFixed(6),
    d:  last.d,
    d2: last.d2,
    di: last.di !== undefined ? last.di : 0,
    di2: last.di2,
    G:  last.G,
    composite: last.composite || false,
    G2: last.G2 !== undefined ? last.G2 : u.defaultG * 0.38,
  };

  segs.push(newSeg);
  updateLDisplay();
  renderSegs();
}

function delSeg(id) {
  if (segs.length <= 1) return;
  const i = segs.findIndex(s => s.id === id);
  if (i < 0) return;

  // Absorb into adjacent segment
  if (i < segs.length - 1) {
    segs[i + 1].xa = segs[i].xa;
  }
  segs.splice(i, 1);
  segs[0].xa = 0;
  updateLDisplay();
  renderSegs();
}

function updateLDisplay() {
  const el = document.getElementById('iL');
  if (!el) return;
  el.value = iL().toFixed(4) + ' m';
}

function handleLengthChange() {
  // No-op: L is read-only, derived from segments
}

function normalizeSegments() {
  if (!segs.length) return;
  segs[0].xa = 0;
  for (let i = 1; i < segs.length; i++) segs[i].xa = segs[i-1].xb;
  updateLDisplay();
}

function setSegBoundary(id, field, rawVal) {
  const val = parseFloat(rawVal);
  if (!isFinite(val) || val <= 0) return;

  const i = segs.findIndex(s => s.id === id);
  if (i < 0) return;
  const s = segs[i];

  if (field === 'xb') {
    const minXb = s.xa + 0.0001;
    s.xb = +Math.max(val, minXb).toFixed(6);
    // Re-chain all subsequent xa = previous xb
    for (let j = i + 1; j < segs.length; j++) {
      segs[j].xa = segs[j-1].xb;
      if (segs[j].xb <= segs[j].xa + 0.0001) {
        segs[j].xb = +(segs[j].xa + 0.0001).toFixed(6);
      }
    }
  }
  // xa is never directly editable (always = previous xb)

  updateLDisplay();
  renderSegs();
}

function setSeg(id, field, val) {
  const s = segs.find(s => s.id === id);
  if (!s) return;

  const n = typeof val === 'number' ? val : parseSci(String(val));
  s[field] = isNaN(n) ? +val : n;

  // Validate di < d always
  if (field === 'd' || field === 'di') {
    if (s.di && s.d && s.di >= s.d) {
      s.di = s.d * 0.9;
      const el = document.querySelector(`[data-seg="${id}"][data-field="di"]`);
      if (el) el.value = +s.di.toFixed(6);
    }
  }
  if (field === 'd2' || field === 'di2') {
    if (s.di2 && s.d2 && s.di2 >= s.d2) {
      s.di2 = s.d2 * 0.9;
      const el = document.querySelector(`[data-seg="${id}"][data-field="di2"]`);
      if (el) el.value = +s.di2.toFixed(6);
    }
  }

  const isVariable = s.d2 !== undefined;
  if (!isVariable && field === 'd') {
    s.d2 = undefined;
  }

  drawSegBar('cvSeg');
  drawShaftDiagram();
}

// ── SECTION TYPE BUTTONS ──────────────────────────────────────
function tGetSecType(s) {
  const variable  = s.d2 !== undefined;
  const hollow    = !s.composite && (s.di > 0);
  if (s.composite) return 'compuesta';
  if (hollow && variable) return 'huevaVar';
  if (hollow)   return 'hueca';
  if (variable) return 'variable';
  return 'maciza';
}

function tSetSecType(id, type) {
  const s = segs.find(s => s.id === id);
  if (!s) return;
  switch (type) {
    case 'maciza':
      s.composite = false; s.di = 0; s.di2 = undefined; s.d2 = undefined;
      break;
    case 'variable':
      s.composite = false; s.di = 0; s.di2 = undefined;
      if (s.d2 === undefined) s.d2 = s.d;
      break;
    case 'hueca':
      s.composite = false;
      if (!(s.di > 0)) s.di = +(s.d * 0.6).toFixed(4);
      s.d2 = undefined; s.di2 = undefined;
      break;
    case 'huevaVar':
      s.composite = false;
      if (!(s.di > 0)) s.di = +(s.d * 0.6).toFixed(4);
      if (s.d2 === undefined) s.d2 = s.d;
      if (s.di2 === undefined) s.di2 = s.di;
      break;
    case 'compuesta':
      s.composite = true;
      if (!(s.di > 0)) s.di = +(s.d * 0.5).toFixed(4);
      s.d2 = undefined; s.di2 = undefined;
      break;
  }
  renderSegs();
}

function toggleVar(id, on) {
  const s = segs.find(s => s.id === id);
  if (!s) return;
  if (on) {
    s.d2 = s.d;
    if (s.di > 0) s.di2 = s.di;
  } else {
    s.d2 = undefined;
    s.di2 = undefined;
  }
  renderSegs();
}

function toggleHollow(id, on) {
  const s = segs.find(s => s.id === id);
  if (!s) return;
  if (on) {
    s.di = s.d * 0.5;
    if (s.d2 !== undefined) s.di2 = s.d2 * 0.5;
    s.composite = false;
  } else {
    s.di = 0;
    s.di2 = undefined;
    s.composite = false;
  }
  renderSegs();
}

function toggleComposite(id, on) {
  const s = segs.find(s => s.id === id);
  if (!s) return;
  if (on) {
    s.composite = true;
    // di is now the core/annulus boundary radius diameter
    if (!s.di || s.di <= 0) s.di = s.d * 0.6;
    if (s.d2 !== undefined && (!s.di2 || s.di2 <= 0)) s.di2 = s.d2 * 0.6;
    if (s.G2 === undefined) s.G2 = +(currentUnits.defaultG * 0.38).toFixed(4);
    // composite and hollow are mutually exclusive visually
  } else {
    s.composite = false;
    // keep di as-is (user can remove hollow separately)
  }
  renderSegs();
}

function renderSegs() {
  const u = currentUnits;
  const cont = document.getElementById('cSeg');
  cont.innerHTML = segs.map((s, i) => {
    const variable   = s.d2 !== undefined;
    const hollow     = !s.composite && (s.di > 0);
    const composite  = s.composite === true;
    const isFirst    = i === 0;
    const isLast     = i === segs.length - 1;

    // ── Section type buttons (same style as flexion) ────────────
    const secTypes = [
      {id:'maciza',    label:'Maciza'},
      {id:'variable',  label:'Variable'},
      {id:'hueca',     label:'Hueca'},
      {id:'huevaVar',  label:'Hueca Var.'},
      {id:'compuesta', label:'Comp.'},
    ];
    const curType = tGetSecType(s);
    const secTypeRow = `<div class="sec-type-row">` +
      secTypes.map(t => `<button class="sec-type-btn${curType === t.id ? ' on' : ''}" onclick="tSetSecType(${s.id},'${t.id}')">${t.label}</button>`).join('') +
      `</div>`;

    // ── Outer diameter row ──────────────────────────────────────
    let dRow = '';
    if (variable) {
      dRow = `<div class="r2">
        <div class="f">
          <label>${composite ? 'D_e inicio (m)' : hollow ? 'D_e inicio (m)' : 'D inicio (m)'}</label>
          <input type="number" value="${s.d}" step="0.001" min="0.001"
            data-seg="${s.id}" data-field="d"
            onchange="setSeg(${s.id},'d',this.value);renderSegs()">
        </div>
        <div class="f">
          <label>${composite ? 'D_e fin (m)' : hollow ? 'D_e fin (m)' : 'D fin (m)'}</label>
          <input type="number" value="${s.d2}" step="0.001" min="0.001"
            data-seg="${s.id}" data-field="d2"
            onchange="setSeg(${s.id},'d2',this.value);renderSegs()">
        </div>
      </div>`;
    } else {
      dRow = `<div class="r2">
        <div class="f">
          <label>${composite ? 'D exterior (m)' : hollow ? 'D exterior (m)' : 'Diámetro d (m)'}</label>
          <input type="number" value="${s.d}" step="0.001" min="0.001"
            data-seg="${s.id}" data-field="d"
            onchange="setSeg(${s.id},'d',this.value);renderSegs()">
        </div>
        <div class="f seg-ghost">
          <label>Sección</label>
          <input type="text" value="Constante" disabled>
        </div>
      </div>`;
    }

    // ── Inner diameter / composite boundary row ─────────────────
    let diRow = '';
    if (hollow || composite) {
      if (variable) {
        diRow = `<div class="r2">
          <div class="f">
            <label>${composite ? 'D_int inicio (m)' : 'D_i inicio (m)'}</label>
            <input type="number" value="${s.di || 0}" step="0.001" min="0"
              data-seg="${s.id}" data-field="di"
              onchange="setSeg(${s.id},'di',this.value);renderSegs()">
          </div>
          <div class="f">
            <label>${composite ? 'D_int fin (m)' : 'D_i fin (m)'}</label>
            <input type="number" value="${s.di2 !== undefined ? s.di2 : (s.di||0)}" step="0.001" min="0"
              data-seg="${s.id}" data-field="di2"
              onchange="setSeg(${s.id},'di2',this.value);renderSegs()">
          </div>
        </div>`;
      } else {
        const label = composite ? 'D interfaz (m)' : 'D interior (m)';
        const hint  = composite
          ? `núcleo ⌀${(s.di||0).toFixed(4)} — anillo ${(s.di||0).toFixed(4)}→${s.d.toFixed(4)}`
          : `e = ${((s.d-(s.di||0))/2).toFixed(4)} m`;
        diRow = `<div class="r2">
          <div class="f">
            <label>${label}</label>
            <input type="number" value="${s.di || 0}" step="0.001" min="0"
              data-seg="${s.id}" data-field="di"
              onchange="setSeg(${s.id},'di',this.value);renderSegs()">
          </div>
          <div class="f seg-ghost">
            <label>${composite ? 'Geometría' : 'Espesor'}</label>
            <input type="text" value="${hint}" disabled>
          </div>
        </div>`;
      }
    }

    // ── Composite material panel ────────────────────────────────
    let compPanel = '';
    if (composite) {
      compPanel = `
      <div class="comp-panel">
        <p class="comp-title">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="#69b1f0" stroke-width="1.2"/><circle cx="6" cy="6" r="2.5" fill="#69b1f0" opacity=".5"/></svg>
          Sección compuesta — 2 materiales
        </p>
        <div>
          <span class="mat-badge mat1-badge">Material 1 — núcleo (d ≤ D_int)</span>
          <div class="r1 mat-row">
            ${sciField({label:`G núcleo (${u.unitG})`, value:+(s.G2||currentUnits.defaultG).toFixed(4), min:0, onChangeFn:`setSeg(${s.id},'G2',__v__)`})}
          </div>
        </div>
        <div>
          <span class="mat-badge mat2-badge">Material 2 — anillo exterior (D_int ≤ d ≤ D_e)</span>
          <div class="r1 mat-row">
            ${sciField({label:`G anillo (${u.unitG})`, value:+(s.G).toFixed(4), min:0, onChangeFn:`setSeg(${s.id},'G',__v__)`})}
          </div>
        </div>
        <p class="subhint" style="margin-top:4px">GJ_eq = G₁·J₁(núcleo) + G₂·J₂(anillo)</p>
      </div>`;
    } else {
      // Normal single-material G row
      compPanel = `<div class="r2">
        <div style="grid-column:1/-1">
          ${sciField({label:`G (${u.unitG})`, value:+(s.G).toFixed(4), min:0, onChangeFn:`setSeg(${s.id},'G',__v__)`})}
        </div>
      </div>`;
    }

    return `
    <div class="card">
      <div class="card-head">
        <span class="badge b-seg">segmento ${i + 1}</span>
        ${segs.length > 1 ? `<button class="del" onclick="delSeg(${s.id})">&#x2715;</button>` : ''}
      </div>
      ${secTypeRow}

      <div class="r2">
        <div class="f readonly">
          <label>x inicio (m)</label>
          <input type="number" value="${s.xa.toFixed(4)}" disabled>
        </div>
        <div class="f">
          <label>x fin (m)</label>
          <input type="number" value="${s.xb.toFixed(4)}" step="0.001" min="${(s.xa+0.0001).toFixed(4)}"
            onchange="setSegBoundary(${s.id},'xb',this.value)">
        </div>
      </div>

      <div class="r1">
        <div class="f">
          <label>Longitud del segmento (m)</label>
          <input type="text" value="${(s.xb - s.xa).toFixed(4)}" disabled>
        </div>
      </div>

      ${dRow}
      ${diRow}
      ${compPanel}
    </div>`;
  }).join('');

  drawSegBar('cvSeg');
  drawShaftDiagram();
  updateLDisplay();
  setTimeout(initSciBadges, 0);
}

function drawSegBar(cvId) {
  const cvs = document.getElementById(cvId);
  if (!cvs) return;
  const W = cvs.offsetWidth || cvs.parentElement.offsetWidth || 290;
  const H = cvs.height = 56;
  cvs.width = W;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,W,H);
  if (!segs.length) return;

  const L = +iL() || 0.312;
  const maxD = Math.max(...segs.map(s => Math.max(s.d, s.d2 !== undefined ? s.d2 : s.d)));
  const pal = ['#f5c842','#60b8f5','#f0a060','#50d4b8','#b090f5','#f07070'];

  segs.forEach((s,i) => {
    const x1 = s.xa / L * W;
    const x2 = s.xb / L * W;
    const d2 = (s.d2 !== undefined) ? s.d2 : s.d;
    const h1 = Math.max(5, s.d / maxD * (H - 8));
    const h2 = Math.max(5, d2 / maxD * (H - 8));
    const y1top = (H - h1) / 2, y1bot = (H + h1) / 2;
    const y2top = (H - h2) / 2, y2bot = (H + h2) / 2;
    const col = pal[i % pal.length];

    ctx.beginPath();
    ctx.moveTo(x1,y1top);
    ctx.lineTo(x2,y2top);
    ctx.lineTo(x2,y2bot);
    ctx.lineTo(x1,y1bot);
    ctx.closePath();

    ctx.fillStyle = col + '22';
    ctx.fill();
    ctx.strokeStyle = col + '80';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (x2 - x1 > 32) {
      ctx.fillStyle = col + 'cc';
      ctx.font = '9px DM Mono,monospace';
      ctx.textAlign = 'center';
      const di = s.di || 0;
      const di2 = (s.di2 !== undefined) ? s.di2 : di;
      const hollow = !s.composite && di > 0;
      const comp   = s.composite && di > 0;
      let label;
      if (comp)    label = s.d === d2 ? `⊕${s.d}(${di})` : `${s.d}→${d2}`;
      else if (hollow) label = s.d === d2 ? `⌀${s.d}(${di})` : `${s.d}→${d2}`;
      else         label = s.d === d2 ? `d=${s.d}` : `${s.d}→${d2}`;
      ctx.fillText(label, (x1 + x2) / 2, H / 2 + 3);
    }

    // Draw hollow inner cutout or composite core fill on segment bar
    if ((s.di || 0) > 0) {
      const di = s.di || 0;
      const di2 = (s.di2 !== undefined) ? s.di2 : di;
      const hi1 = Math.max(2, di  / maxD * (H - 8));
      const hi2 = Math.max(2, di2 / maxD * (H - 8));
      const yi1top = (H - hi1) / 2, yi1bot = (H + hi1) / 2;
      const yi2top = (H - hi2) / 2, yi2bot = (H + hi2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, yi1top);
      ctx.lineTo(x2, yi2top);
      ctx.lineTo(x2, yi2bot);
      ctx.lineTo(x1, yi1bot);
      ctx.closePath();
      if (s.composite) {
        // Show core as purple-tinted fill
        ctx.fillStyle = 'rgba(168,141,240,0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(168,141,240,0.5)';
      } else {
        ctx.fillStyle = 'rgba(16,17,18,0.90)';
        ctx.fill();
        ctx.strokeStyle = col + '40';
      }
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

  });  // end segs.forEach

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0,H/2);
  ctx.lineTo(W,H/2);
  ctx.stroke();
}

// ── BC FIELDS ─────────────────────────────────────────────────
function renderBCFields() {
  const bc = iBC();
  const box = document.getElementById('bcExtra');
  if (!box) return;

  const u = currentUnits;
  const defK = u.defaultSpringK;

  let html = '';

  // Spring at A: SF, SC, SS
  if (bc === 'SF' || bc === 'SC' || bc === 'SS') {
    const prevKA = parseSci(document.getElementById('iKA')?.value);
    const valKA  = isNaN(prevKA) ? defK : prevKA;
    html += sciField({
      label: `Rigidez torsional K_A (${u.unitSpringK})`,
      value: valKA,
      id: 'iKA',
      min: 0,
      onChangeFn: `/* stored via id */`
    });
  }

  // Spring at B: FS, SS
  if (bc === 'FS' || bc === 'SS') {
    const prevKB = parseSci(document.getElementById('iKB')?.value);
    const valKB  = isNaN(prevKB) ? defK : prevKB;
    html += sciField({
      label: `Rigidez torsional K_B (${u.unitSpringK})`,
      value: valKB,
      id: 'iKB',
      min: 0,
      onChangeFn: `/* stored via id */`
    });
  }

  // Fixed at B: SC
  if (bc === 'SC') {
    html += `<div class="f seg-ghost"><label>Extremo B</label><input type="text" value="Empotrado" disabled></div>`;
  }

  box.innerHTML = html;
  box.style.display = html ? '' : 'none';
  setTimeout(initSciBadges, 0);
  drawShaftDiagram();
}

function getKA() {
  const el = document.getElementById('iKA');
  if (!el) return 0;
  const v = parseSci(el.value);
  return isNaN(v) ? 0 : Math.max(0, u2si_springK(v));
}

function getKB() {
  const el = document.getElementById('iKB');
  if (!el) return 0;
  const v = parseSci(el.value);
  return isNaN(v) ? 0 : Math.max(0, u2si_springK(v));
}

// ── LOADS ─────────────────────────────────────────────────────
function addLoad(tipo) {
  const L = +iL();
  const id = ++lid;
  // Default values in user units (stored as user units, converted at solve time)
  if (tipo === 'pun') loads.push({id,tipo,x:+(L/2).toFixed(4),val:500});
  else if (tipo === 'dis') loads.push({id,tipo,xa:0,xb:+L.toFixed(4),val:1000});
  else if (tipo === 'tri') loads.push({id,tipo,xa:0,xb:+L.toFixed(4),va:1000,vb:0});
  else loads.push({id,tipo,xa:0,xb:+L.toFixed(4),expr:'2899.93*(1+(x/L)^2)'});
  renderLoads();
}

function delLoad(id) {
  const i = loads.findIndex(l => l.id === id);
  if (i >= 0) loads.splice(i,1);
  renderLoads();
}

function setLoad(id, field, val) {
  const l = loads.find(l => l.id === id);
  if (!l) return;
  if (field === 'expr') {
    l[field] = val;
  } else {
    const n = typeof val === 'number' ? val : parseSci(String(val));
    l[field] = isNaN(n) ? (typeof val === 'string' ? +val : 0) : n;
  }
  clearTimeout(_tShaftRedrawTimer);
  _tShaftRedrawTimer = setTimeout(drawShaftDiagram, 120);
}

function renderLoads() {
  const u = currentUnits;
  document.getElementById('hLoad').style.display = loads.length ? 'none' : 'block';
  drawShaftDiagram();
  document.getElementById('cLoad').innerHTML = loads.map(l => {
    const bcls = l.tipo === 'pun' ? 'b-pun' : l.tipo === 'pol' ? 'b-pol' : 'b-dis';
    const blbl = l.tipo === 'pun' ? 'Puntual' : l.tipo === 'dis' ? 'Distribuida' : l.tipo === 'tri' ? 'Triangular' : 'Polinomio';
    let body = '';

    if (l.tipo === 'pun') {
      body = `<div class="r2">
        <div class="f"><label>posición x (m)</label><input type="number" value="${l.x}" step="0.001" onchange="setLoad(${l.id},'x',this.value)"></div>
        ${sciField({label:`T (${u.unitMoment})`, value:l.val, onChangeFn:`setLoad(${l.id},'val',__v__)`})}
      </div>`;
    } else if (l.tipo === 'dis') {
      body = `<div class="r3">
        <div class="f"><label>x inicio (m)</label><input type="number" value="${l.xa}" step="0.001" onchange="setLoad(${l.id},'xa',this.value)"></div>
        <div class="f"><label>x fin (m)</label><input type="number" value="${l.xb}" step="0.001" onchange="setLoad(${l.id},'xb',this.value)"></div>
        ${sciField({label:`t₀ (${u.unitMomentPerLen})`, value:l.val, onChangeFn:`setLoad(${l.id},'val',__v__)`})}
      </div>`;
    } else if (l.tipo === 'tri') {
      body = `<div class="r2">
        <div class="f"><label>x inicio (m)</label><input type="number" value="${l.xa}" step="0.001" onchange="setLoad(${l.id},'xa',this.value)"></div>
        <div class="f"><label>x fin (m)</label><input type="number" value="${l.xb}" step="0.001" onchange="setLoad(${l.id},'xb',this.value)"></div>
      </div>
      <div class="r2">
        ${sciField({label:`t(x inicio) (${u.unitMomentPerLen})`, value:l.va, onChangeFn:`setLoad(${l.id},'va',__v__)`})}
        ${sciField({label:`t(x fin) (${u.unitMomentPerLen})`, value:l.vb, onChangeFn:`setLoad(${l.id},'vb',__v__)`})}
      </div>`;
    } else {
      body = `<div class="r2">
        <div class="f"><label>x inicio (m)</label><input type="number" value="${l.xa}" step="0.001" onchange="setLoad(${l.id},'xa',this.value)"></div>
        <div class="f"><label>x fin (m)</label><input type="number" value="${l.xb}" step="0.001" onchange="setLoad(${l.id},'xb',this.value)"></div>
      </div>
      <div class="r1"><div class="f"><label>expresión T(x) en ${u.unitMomentPerLen} — usa: x, L, PI</label>
        <textarea onchange="setLoad(${l.id},'expr',this.value)">${l.expr || ''}</textarea>
      </div></div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--txt3);margin-top:2px">Operadores: + − * / ^ ( ) &nbsp; ej: 5*10^4*(1+(x/L)^2)</div>`;
    }

    return `<div class="card"><div class="card-head"><span class="badge ${bcls}">${blbl}</span><button class="del" onclick="delLoad(${l.id})">&#x2715;</button></div>${body}</div>`;
  }).join('');
  setTimeout(initSciBadges, 0);
}

// ── UTILS ─────────────────────────────────────────────────────
function iL() {
  if (segs.length) return segs[segs.length-1].xb;
  return 0.312;
}
function iN() { return parseInt(document.getElementById('iN').value) || 30; }
function iBC(){ return document.getElementById('iBC').value; }
function showErr(m) {
  const e = document.getElementById('errBox');
  e.textContent = m;
  e.style.display = m ? 'block' : 'none';
}

function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('t-geo').style.display = name === 'geo' ? '' : 'none';
  document.getElementById('t-loads').style.display = name === 'loads' ? '' : 'none';
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
    if (l.tipo === 'tri' && x >= l.xa - 1e-9 && x <= l.xb + 1e-9) {
      const span = l.xb - l.xa;
      const t = span > 1e-12 ? (x - l.xa) / span : 0;
      q += u2si_momentPerLen((+l.va || 0) * (1 - t) + (+l.vb || 0) * t);
    }
    if (l.tipo === 'pol' && x >= l.xa - 1e-9 && x <= l.xb + 1e-9) {
      const v = evalExpr(l.expr,x,L);
      if (!isNaN(v)) q += u2si_momentPerLen(v);
    }
  });
  return q;
}


function clearSelections() {
  Object.keys(selectedPoints).forEach(k => delete selectedPoints[k]);
  solve();
}

// ── CHARTS ────────────────────────────────────────────────────
function mkChart(id, labels, data, color, yLbl, stepped, dec) {
  if (charts[id]) charts[id].destroy();
  dec = dec !== undefined ? dec : 3;

  const n = data.length;
  if (n === 0) return;

  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < n; i++) {
    if (data[i] > data[maxIdx]) maxIdx = i;
    if (data[i] < data[minIdx]) minIdx = i;
  }

  const annotations = {};
  const threshold = Math.max(...data.map(Math.abs)) * 0.001;

  function mkAnnotation(idx, pos, isMax) {
    const val = data[idx];
    if (Math.abs(val) < threshold && threshold > 0) return null;

    const lbl = fmtVal(val, dec);
    return {
      type: 'point',
      xValue: labels[idx],
      yValue: val,
      radius: 4,
      backgroundColor: color,
      borderColor: '#0d0d0d',
      borderWidth: 2,
      label: {
        display: true,
        content: lbl + ' ' + yLbl,
        position: pos,
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
  const candidates = [
    [maxIdx, 'center', true],
    [minIdx, 'center', false],
    [0, 'center', data[0] >= 0],
    [n - 1, 'center', data[n - 1] >= 0],
  ];

  const midIdx = Math.floor(n / 2);
  candidates.push([midIdx, 'center', data[midIdx] >= 0]);

  candidates.forEach(([idx, pos, up], ci) => {
    if (added.has(idx)) return;

    let tooClose = false;
    for (const ai of added) {
      if (Math.abs(ai - idx) < Math.floor(n / 8)) {
        tooClose = true;
        break;
      }
    }

    if (tooClose && ci > 1) return;
    added.add(idx);

    const ann = mkAnnotation(idx, pos, up);
    if (ann) annotations['pt' + idx] = ann;
  });

  const hasNeg = data.some(v => v < -threshold);
  const hasPos = data.some(v => v > threshold);
  if (hasNeg && hasPos) {
    annotations['zero'] = {
      type: 'line',
      yMin: 0,
      yMax: 0,
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderDash: [4,3]
    };
  }

  const selIdx = selectedPoints[id];
  if (selIdx !== undefined && selIdx >= 0 && selIdx < data.length) {
    const xSel = labels[selIdx];
    const ySel = data[selIdx];

    annotations['selectedLine'] = {
      type: 'line',
      xMin: xSel,
      xMax: xSel,
      borderColor: color,
      borderWidth: 1,
      borderDash: [3,3]
    };

    annotations['selectedPoint'] = {
      type: 'point',
      xValue: xSel,
      yValue: ySel,
      radius: 5,
      backgroundColor: '#ffffff',
      borderColor: color,
      borderWidth: 2
    };

    annotations['selectedLabel'] = {
      type: 'label',
      xValue: xSel,
      yValue: ySel,
      backgroundColor: '#111',
      borderColor: color,
      borderWidth: 1,
      color: '#f1eee8',
      borderRadius: 6,
      padding: 6,
      content: [
        `x = ${parseFloat(xSel).toFixed(4)} m`,
        `y = ${fmtVal(ySel, dec)} ${yLbl}`
      ],
      font: {
        family: 'DM Mono, monospace',
        size: 10
      },
      position: {
        x: 'start',
        y: 'top'
      },
      xAdjust: 10,
      yAdjust: -10
    };
  }

  const chart = new Chart(document.getElementById(id), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: color + '14',
        fill: true,
        tension: stepped ? 0 : 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12,
        borderWidth: 1.5,
        stepped: stepped || false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280 },
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      onClick: (evt, elements, chartInstance) => {
        const points = chartInstance.getElementsAtEventForMode(
          evt,
          'nearest',
          { intersect: false },
          true
        );

        if (points.length) {
          const clickedIdx = points[0].index;
          selectedPoints[id] = clickedIdx;
          mkChart(id, labels, data, color, yLbl, stepped, dec);
          if (lastSolveData) {
            try {
              const eIdx = Math.min(clickedIdx, lastSolveData.nEl - 1);
              drawSectionPanelForElem(eIdx);
            } catch(e) {
              console.warn('Section panel draw error:', e);
            }
          }
        }
      },
      onHover: (event, activeElements, chartInstance) => {
        chartInstance.canvas.style.cursor = activeElements.length ? 'crosshair' : 'default';
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
          bodyFont: { family: 'DM Mono', size: 12 },
          callbacks: {
            title: (items) => {
              const x = parseFloat(items[0].label).toFixed(4);
              return `x = ${x} m`;
            },
            label: (c) => `y = ${fmtVal(c.parsed.y, dec)} ${yLbl}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: {
            color: '#505048',
            font: { family: 'DM Mono', size: 10 },
            maxTicksLimit: 6,
            callback: v => parseFloat(v).toFixed(3)
          }
        },
        y: (() => {
          // If data is nearly constant (relative range < 0.1%), Chart.js zooms in
          // so much that floating-point noise looks like a wave. Fix: force a
          // minimum axis span of 5% of |mean| so the chart always looks flat.
          const yMin = Math.min(...data);
          const yMax = Math.max(...data);
          const yMid = (yMin + yMax) / 2;
          const yRange = yMax - yMin;
          const yAbs = Math.max(Math.abs(yMid), Math.abs(yMax), Math.abs(yMin));
          const relRange = yAbs > 1e-30 ? yRange / yAbs : 0;

          const yConfig = {
            grid: { color: 'rgba(255,255,255,0.03)' },
            ticks: {
              color: '#505048',
              font: { family: 'DM Mono', size: 10 },
              maxTicksLimit: 5
            }
          };

          // Nearly constant: force a readable fixed span (5% of |mean|, min 1e-6)
          if (relRange < 0.001 && yAbs > 1e-30) {
            const span = Math.max(yAbs * 0.05, 1e-6);
            yConfig.min = yMid - span;
            yConfig.max = yMid + span;
            // Round tick labels to 3 significant figures so axis isn't 499.9999...
            yConfig.ticks.callback = function(v) {
              return parseFloat(v.toPrecision(6));
            };
          }

          return yConfig;
        })()
      }
    }
  });

  charts[id] = chart;
}

// ── SOLVE ─────────────────────────────────────────────────────
function solve() {
  showErr('');
  const L = iL(), nps = iN(), bc = iBC();
  const u = currentUnits;

  if (!L || L <= 0) { showErr('Longitud inválida.'); return; }
  if (!segs.length) { showErr('Define al menos un segmento.'); return; }
  if (!loads.length) { showErr('Agrega al menos una carga.'); return; }

  // Validate hollow and composite sections
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if ((s.di > 0 || s.composite) && s.di >= s.d) {
      showErr(`Segmento ${i+1}: diámetro interior/interfaz ≥ exterior.`); return;
    }
    if (s.composite && s.d2 !== undefined && s.di2 !== undefined && s.di2 >= s.d2) {
      showErr(`Segmento ${i+1}: diámetro interfaz fin ≥ exterior fin.`); return;
    }
    if (s.composite && (!s.di || s.di <= 0)) {
      showErr(`Segmento ${i+1}: sección compuesta requiere D interfaz > 0.`); return;
    }
  }

  normalizeSegments();

  for (let i = 0; i < segs.length; i++) {
    if (segs[i].xb <= segs[i].xa) {
      showErr(`El segmento ${i + 1} tiene longitud no válida.`);
      return;
    }
  }

  for (const l of loads) {
    if (l.tipo === 'pol') {
      const v = evalExpr(l.expr, L / 2, L);
      if (isNaN(v)) {
        showErr(`Expresión inválida: "${l.expr}"`);
        return;
      }
    }
  }

  const nEl = segs.length * nps;
  const le = L / nEl;
  const ndof = nEl + 1;

  const K = Array.from({length:ndof}, () => new Float64Array(ndof));
  const GJe = new Float64Array(nEl);

  for (let e = 0; e < nEl; e++) {
    const xm = (e + 0.5) * le;
    const gj = getGJ(xm, L);   // internal SI: N·m²
    GJe[e] = gj;
    const k = gj / le;
    K[e][e] += k;
    K[e][e+1] -= k;
    K[e+1][e] -= k;
    K[e+1][e+1] += k;
  }

  const F = new Float64Array(ndof);
  const qVis = new Float64Array(nEl);  // SI N·m/m for display conversion

  loads.forEach(l => {
    if (l.tipo === 'pun') {
      const xi = Math.max(0, Math.min(L, +l.x || 0));
      const idx = Math.min(Math.round(xi / le), nEl);
      F[idx] += u2si_moment(+l.val || 0);   // user → SI N·m
    } else {
      for (let e = 0; e < nEl; e++) {
        const x1 = e * le, x2 = (e + 1) * le;
        let integ = 0;
        for (let q = 0; q < 5; q++) {
          const xi = x1 + (x2 - x1) * (q + 0.5) / 5;
          let v = 0;
          if (l.tipo === 'dis' && xi >= l.xa - 1e-9 && xi <= l.xb + 1e-9)
            v = u2si_momentPerLen(+l.val || 0);
          if (l.tipo === 'tri' && xi >= l.xa - 1e-9 && xi <= l.xb + 1e-9) {
            const span = l.xb - l.xa;
            const t = span > 1e-12 ? (xi - l.xa) / span : 0;
            v = u2si_momentPerLen((+l.va || 0) * (1 - t) + (+l.vb || 0) * t);
          }
          if (l.tipo === 'pol' && xi >= l.xa - 1e-9 && xi <= l.xb + 1e-9) {
            const ev = evalExpr(l.expr, xi, L);
            if (!isNaN(ev)) v = u2si_momentPerLen(ev);
          }
          integ += v * (x2 - x1) / 5;
        }
        F[e] += integ / 2;
        F[e+1] += integ / 2;
        qVis[e] += qAt((x1 + x2) / 2, L);  // SI
      }
    }
  });

  const Kf = K.map(r => [...r]);
  const Ff = [...F];

  const fixed = [];
  let springA = 0;
  let springB = 0;

  if (bc === 'FF') {
    fixed.push(0, nEl);
  } else if (bc === 'FC') {
    fixed.push(0);
  } else if (bc === 'SF') {
    springA = getKA();
  } else if (bc === 'SC') {
    springA = getKA();   // spring at A
    fixed.push(nEl);     // fixed at B
  } else if (bc === 'FS') {
    fixed.push(0);
    springB = getKB();
  } else if (bc === 'SS') {
    springA = getKA();
    springB = getKB();
  }

  if (springA > 0) Kf[0][0] += springA;
  if (springB > 0) Kf[nEl][nEl] += springB;

  fixed.forEach(i => {
    for (let j = 0; j < ndof; j++) {
      Kf[i][j] = 0;
      Kf[j][i] = 0;
    }
    Kf[i][i] = 1;
    Ff[i] = 0;
  });

  const phi = luSolve(Kf, Ff);
  if (!phi) {
    showErr('Error numérico. Verifica condiciones de borde, resortes y cargas.');
    return;
  }

  // Compute T (SI: N·m), tau (SI: Pa), outer-diameter profile for bar vis
  const T = [], tau = [], dE = [];
  for (let e = 0; e < nEl; e++) {
    const t = GJe[e] * (phi[e+1] - phi[e]) / le;   // N·m
    T.push(t);
    const xm = (e + 0.5) * le;
    const s = segs.find(s => xm >= s.xa - 1e-9 && xm <= s.xb + 1e-9) || segs[segs.length - 1];
    const len = s.xb - s.xa;
    const tt = len > 1e-12 ? (xm - s.xa) / len : 0;

    const de2 = (s.d2 !== undefined) ? s.d2 : s.d;
    const de  = s.d + (de2 - s.d) * tt;
    const di2val = (s.di2 !== undefined) ? s.di2 : (s.di || 0);
    const di  = (s.di || 0) + (di2val - (s.di || 0)) * tt;

    const ro = de / 2, ri = di / 2;

    if (s.composite && ri > 0) {
      // For composite sections, τ = T·r·G_layer / GJ_eq
      // We report the maximum of both: outer fiber of annulus and outer fiber of core
      const GJ_eq = GJe[e];
      const G_core    = u2si_G(s.G2 || s.G);
      const G_annulus = u2si_G(s.G);
      const tau_annulus_outer = Math.abs(t) * ro * G_annulus / GJ_eq;
      const tau_core_outer    = Math.abs(t) * ri * G_core    / GJ_eq;
      tau.push(Math.max(tau_annulus_outer, tau_core_outer));
    } else {
      const J = Math.PI / 2 * (ro**4 - ri**4);
      tau.push(Math.abs(t) * ro / J);
    }
    dE.push(de);
  }

  const baseReacA = -K[0].reduce((s,v,j) => s + v * phi[j], 0) + F[0];
  const baseReacB = -K[nEl].reduce((s,v,j) => s + v * phi[j], 0) + F[nEl];

  const springAUsed = (bc === 'SF' || bc === 'SC' || bc === 'SS') ? getKA() : 0;
  const springBUsed = (bc === 'FS' || bc === 'SS') ? getKB() : 0;

  const reacA = fixed.includes(0)   ? baseReacA : springAUsed * phi[0];
  const reacB = fixed.includes(nEl) ? baseReacB : springBUsed * phi[nEl];

  const phiMax = Math.max(...phi.map(Math.abs));
  const tMax   = Math.max(...T.map(Math.abs));
  const tauMax = Math.max(...tau);
  const tauIdx = tau.indexOf(tauMax);
  const totalF = Array.from(F).reduce((a,b) => a + b, 0);

  // includeB: true for every BC where B actually develops a reaction
  // FF, SC → B empotrado | FS, SS → B resorte | SF → B empotrado
  const includeB = (bc === 'FF' || bc === 'SC' || bc === 'FS' || bc === 'SS' || bc === 'SF');
  // Signed sum: TA + TB (with sign) must equal totalF (with sign)
  const totalRShown = reacA + (includeB ? reacB : 0);
  const eqErrShown  = Math.abs(totalF - totalRShown) /
                      (Math.max(Math.abs(totalF), Math.abs(totalRShown)) + 1e-10);

  // ── Convert to display units ──────────────────────────────────
  const disp_T    = T.map(v => si2u_moment(v));
  const disp_qVis = Array.from(qVis).map(v => si2u_momentPerLen(v));
  const disp_tau  = tau.map(v => si2u_stress(v));
  const disp_GJ   = Array.from(GJe).map(v => si2u_GJ(v));
  const disp_phi  = phi.map(v => v * 1000);  // always mrad

  const disp_tMax   = si2u_moment(tMax);
  const disp_tauMax = si2u_stress(tauMax);
  const disp_reacA  = si2u_moment(reacA);
  const disp_reacB  = si2u_moment(reacB);
  const disp_totalR = si2u_moment(totalRShown);  // signed
  const disp_totalF = si2u_moment(totalF);  // signed

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resContent').style.display = '';

  document.getElementById('mrow').innerHTML = [
    {l:'phi máx',    v:(phiMax*1000).toFixed(4), u:'mrad',         h:false},
    {l:'T máx',      v:disp_tMax.toFixed(3),     u:u.unitMoment,   h:false},
    {l:'tau máx',    v:disp_tauMax.toFixed(3),   u:u.unitStress,   h:true },
    {l:'T_A',        v:disp_reacA.toFixed(3),    u:u.unitMoment,   h:false},
    {l:'Error eq.',  v:(eqErrShown*100).toFixed(3), u:'%',          h:false},
  ].map(m => `<div class="met${m.h?' hi':''}"><p class="ml">${m.l}</p><p class="mv${m.h?' hi':''}">${m.v}<span class="mu"> ${m.u}</span></p></div>`).join('');

  const xs  = Array.from({length:ndof}, (_,i) => (i * le).toFixed(5));
  const xsE = Array.from({length:nEl},  (_,i) => ((i + 0.5) * le).toFixed(5));

  // Adaptive decimal places for small numbers
  const decT   = disp_tMax   < 0.01 ? 6 : disp_tMax   < 1 ? 4 : 2;
  const decTau = disp_tauMax < 0.01 ? 6 : disp_tauMax < 1 ? 4 : 3;
  const decGJ  = disp_GJ.reduce((m,v) => Math.max(m,Math.abs(v)),0) < 0.01 ? 5 : 2;

  mkChart('cQ',   xsE, disp_qVis, '#50d4b8', u.unitMomentPerLen, false, 2);
  mkChart('cT',   xsE, disp_T,    '#f5c842', u.unitMoment,       false, decT);
  mkChart('cPhi', xs,  disp_phi,  '#60b8f5', 'mrad',             false, 4);
  mkChart('cTau', xsE, disp_tau,  '#f0a060', u.unitStress,       false, decTau);
  mkChart('cGJ',  xsE, disp_GJ,  '#b090f5',  u.unitGJ,          true,  decGJ);

  // Update chart title units in DOM
  updateChartUnitLabels();

  setTimeout(() => {
    const cvs = document.getElementById('cvRes');
    if (cvs) {
      cvs.style.width = '100%';
      drawSegBarData(cvs, xsE, dE, L);
    }
  }, 50);

  const fmt3 = v => si2u_moment(v).toFixed(3);

  const rightSupportText =
    bc === 'FF' ? `<div class="ir"><span class="ik">TB (x=L)</span><span class="iv">${fmt3(reacB)} ${u.unitMoment}</span></div>` :
    bc === 'SC' ? `<div class="ir"><span class="ik">TB (x=L) empotrado</span><span class="iv">${fmt3(reacB)} ${u.unitMoment}</span></div>` :
    bc === 'FS' || bc === 'SS' ? `<div class="ir"><span class="ik">TB = K_B·φ(L)</span><span class="iv">${fmt3(reacB)} ${u.unitMoment}</span></div>` :
    `<div class="ir"><span class="ik">Extremo B</span><span class="iv" style="color:var(--txt3)">libre</span></div>`;

  const leftSupportText =
    bc === 'SF' || bc === 'SC' || bc === 'SS'
      ? `<div class="ir"><span class="ik">TA = K_A·φ(0)</span><span class="iv">${fmt3(reacA)} ${u.unitMoment}</span></div>`
      : `<div class="ir"><span class="ik">TA (x=0)</span><span class="iv">${fmt3(reacA)} ${u.unitMoment}</span></div>`;

  document.getElementById('tReact').innerHTML = `
    ${leftSupportText}
    ${rightSupportText}
    <div class="ir"><span class="ik">TA${includeB?' + TB':''}</span><span class="iv">${disp_totalR.toFixed(3)} ${u.unitMoment}</span></div>`;

  document.getElementById('tEq').innerHTML = `
    <div class="ir"><span class="ik">Carga total</span><span class="iv">${disp_totalF.toFixed(3)} ${u.unitMoment}</span></div>
    <div class="ir"><span class="ik">TA${includeB?' + TB':''}</span><span class="iv">${disp_totalR.toFixed(3)} ${u.unitMoment}</span></div>
    <div class="ir"><span class="ik">Error</span><span class="iv ${eqErrShown<0.01?'ok':'warn'}">${(eqErrShown*100).toFixed(4)}% ${eqErrShown<0.01?'✓':'!'}</span></div>`;

  document.getElementById('tMax').innerHTML = `
    <div class="ir"><span class="ik">x(tau máx)</span><span class="iv">${((tauIdx+0.5)*le).toFixed(4)} m</span></div>
    <div class="ir"><span class="ik">tau máx</span><span class="iv" style="color:var(--orange)">${disp_tauMax.toFixed(3)} ${u.unitStress}</span></div>
    <div class="ir"><span class="ik">T(x tau máx)</span><span class="iv">${si2u_moment(T[tauIdx]).toFixed(3)} ${u.unitMoment}</span></div>
    <div class="ir"><span class="ik">phi máx</span><span class="iv">${(phiMax*1000).toFixed(4)} mrad</span></div>`;

  // ── Store solve results and draw section panel at τ_max ───────
  lastSolveData = { T, tau, GJe, le, nEl, L };
  // Reset selected points so we start fresh at τ_max location
  Object.keys(selectedPoints).forEach(k => delete selectedPoints[k]);
  selectedPoints['cTau'] = tauIdx;
  setTimeout(() => {
    drawSectionPanelForElem(tauIdx);
    // Also re-render cTau to show the selected point
    mkChart('cTau', xsE, disp_tau, '#f0a060', u.unitStress, false, decTau);
  }, 80);
}


// ── SECTION TRANSVERSAL PANEL ─────────────────────────────────
function drawSectionPanel(elemIdx) {
  try {
  if (!lastSolveData) return;
  const { T, GJe, le, nEl } = lastSolveData;
  const u = currentUnits;
  if (elemIdx < 0 || elemIdx >= nEl) return;

  const xm = (elemIdx + 0.5) * le;

  // Segment geometry interpolated at xm
  const s    = segs.find(s => xm >= s.xa - 1e-9 && xm <= s.xb + 1e-9) || segs[segs.length - 1];
  const sLen = s.xb - s.xa;
  const tt   = sLen > 1e-12 ? (xm - s.xa) / sLen : 0;

  const de2  = (s.d2  !== undefined) ? s.d2  : s.d;
  const di2v = (s.di2 !== undefined) ? s.di2 : (s.di || 0);
  const de   = s.d  + (de2  - s.d)  * tt;
  const di   = (s.di || 0) + (di2v - (s.di || 0)) * tt;

  const ro = de / 2;
  const ri = di / 2;
  const isHollow    = !s.composite && ri > 0;
  const isComposite =  s.composite && ri > 0;

  const T_elem  = T[elemIdx];
  const GJ_elem = GJe[elemIdx];
  const J_solid = Math.max(Math.PI / 2 * (ro**4 - ri**4), 1e-60);  // guard /0

  // τ(r) in SI Pa — fully guarded
  function tauAt(r) {
    if (r <= 0 || !isFinite(r)) return 0;
    if (isComposite) {
      const G_layer = r <= ri ? u2si_G(s.G2 || s.G) : u2si_G(s.G);
      const gj = GJ_elem > 0 ? GJ_elem : 1e-60;
      return Math.abs(T_elem) * r * G_layer / gj;
    }
    return Math.abs(T_elem) * r / J_solid;
  }

  // Canvas — use parent width, fixed aspect ratio height
  const cvs = document.getElementById('cvSection');
  if (!cvs) return;
  const W = (cvs.parentElement ? cvs.parentElement.clientWidth : 0) || 500;
  const H = Math.round(W * 0.38);
  cvs.width  = W;
  cvs.height = H;
  const ctx  = cvs.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Layout: left ~42% = section circle, right ~58% = τ(r) diagram
  const PAD  = 18;
  const secW = Math.round(W * 0.42);
  const cx   = secW / 2;
  const cy   = H / 2;
  const maxR = Math.min(secW / 2 - PAD, H / 2 - PAD);

  const pxPerM = ro > 0 ? maxR / ro : 1;
  const roPx   = Math.max(maxR, 2);
  const riPx   = Math.max(ri * pxPerM, 0);  // 0 is valid — just no inner circle drawn

  // Segment palette
  const pal    = ['#f5c842','#60b8f5','#f0a060','#50d4b8','#b090f5','#f07070'];
  const segIdx = segs.indexOf(s);
  const segCol = pal[Math.max(0, segIdx) % pal.length];

  // ── Draw section ──────────────────────────────────────────────
  if (isComposite) {
    // Outer circle (annulus — blue)
    ctx.beginPath();
    ctx.arc(cx, cy, roPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(105,177,240,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(105,177,240,0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Core circle (green)
    if (riPx > 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, riPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245,200,66,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,200,66,0.65)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, roPx, 0, Math.PI * 2);
    ctx.fillStyle = segCol + '28';
    ctx.fill();
    ctx.strokeStyle = segCol + 'aa';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (isHollow && riPx > 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, riPx, 0, Math.PI * 2);
      ctx.fillStyle = '#0d0f10';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Crosshair
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(cx - roPx, cy); ctx.lineTo(cx + roPx, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - roPx); ctx.lineTo(cx, cy + roPx); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Radius dimension line
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + roPx, cy); ctx.stroke();

  // Labels
  ctx.font = 'bold 9px DM Mono,monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = segCol + 'cc';
  ctx.fillText('R=' + (ro*1000).toFixed(1) + 'mm', cx + roPx/2, cy - 6);
  if (ri > 0 && riPx > 1) {
    ctx.fillStyle = isComposite ? 'rgba(245,200,66,0.75)' : 'rgba(255,255,255,0.40)';
    ctx.fillText('r=' + (ri*1000).toFixed(1) + 'mm', cx, cy - riPx/2 - 6);
  }
  const typeStr = isComposite ? 'Compuesta' : isHollow ? 'Hueca' : 'Maciza';
  ctx.font = '8px DM Mono,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText(typeStr, 5, H - 5);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(secW, PAD);
  ctx.lineTo(secW, H - PAD);
  ctx.stroke();

  // ── τ(r) diagram ─────────────────────────────────────────────
  const dL  = secW + 36;   // left edge of plot area (space for y labels)
  const dR  = W - PAD;
  const dB  = H - 24;
  const dT  = PAD + 6;
  const dW  = dR - dL;
  const dH  = dB - dT;

  if (dW < 20 || dH < 20) { return; } // too narrow to draw

  const tau_max = tauAt(ro);

  // ── FIX: for composite sections the nucleus can have higher τ than the
  //    outer fiber, so we must scale the Y axis to the true maximum.
  let tau_max_plot = tau_max;
  if (isComposite && ri > 0) {
    tau_max_plot = Math.max(tau_max, tauAt(ri * 0.9999), tauAt(ri * 1.0001));
  } else if (isHollow && ri > 0) {
    tau_max_plot = Math.max(tau_max, tauAt(ri));
  }

  // If T_elem is zero, nothing to draw — just axes
  function px(r) { return dL + (ro > 0 ? (r / ro) * dW : 0); }
  function py(t) {
    if (tau_max_plot < 1e-30) return dB;
    return dB - (t / tau_max_plot) * dH;
  }

  // Subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const yg = dB - (i / 4) * dH;
    ctx.beginPath(); ctx.moveTo(dL, yg); ctx.lineTo(dR, yg); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(dL, dB); ctx.lineTo(dR + 4, dB); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dL, dT - 4); ctx.lineTo(dL, dB); ctx.stroke();

  // Axis arrowheads
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.moveTo(dR+4,dB-3); ctx.lineTo(dR+8,dB); ctx.lineTo(dR+4,dB+3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(dL-3,dT-4); ctx.lineTo(dL,dT-8); ctx.lineTo(dL+3,dT-4); ctx.fill();

  // Axis labels
  ctx.font = '8px DM Mono,monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.textAlign = 'center';
  ctx.fillText('r', dR + 10, dB + 2);
  ctx.fillText('0', dL, dB + 12);
  ctx.fillText('R', dR, dB + 12);
  ctx.textAlign = 'left';
  ctx.fillText('τ', dL - 14, dT - 6);

  // ri marker
  if (ri > 0) {
    const riColor = isComposite ? 'rgba(245,200,66,0.50)' : 'rgba(255,255,255,0.25)';
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = riColor;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px(ri), dT); ctx.lineTo(px(ri), dB); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = riColor;
    ctx.textAlign = 'center';
    ctx.fillText(isComposite ? 'r\u1D62' : 'r\u1D62', px(ri), dB + 12);
  }

  // ── Plot τ(r) curve ───────────────────────────────────────────
  if (tau_max > 1e-30) {
    if (isComposite) {
      // Core: 0 → ri, linear from origin (τ = T·r·G_core/GJ)
      const tauRiCore = tauAt(ri * 0.9999);
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(ri), py(tauRiCore));
      ctx.strokeStyle = 'rgba(245,200,66,0.90)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0), dB);
      ctx.lineTo(px(0), py(0));
      ctx.lineTo(px(ri), py(tauRiCore));
      ctx.lineTo(px(ri), dB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(245,200,66,0.09)';
      ctx.fill();

      // Annulus: ri → ro, linear starting at tauAt(ri+ε)
      const tauRiAnn = tauAt(ri * 1.0001);
      ctx.beginPath();
      ctx.moveTo(px(ri), py(tauRiAnn));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.strokeStyle = 'rgba(240,107,107,0.90)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(ri), dB);
      ctx.lineTo(px(ri), py(tauRiAnn));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.lineTo(px(ro), dB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(240,107,107,0.09)';
      ctx.fill();

      // Jump marker at ri
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px(ri), py(tauRiCore));
      ctx.lineTo(px(ri), py(tauRiAnn));
      ctx.stroke();

      // Dots at kink
      [py(tauRiCore), py(tauRiAnn)].forEach((yy, i) => {
        ctx.beginPath();
        ctx.arc(px(ri), yy, 3, 0, Math.PI*2);
        ctx.fillStyle = i === 0 ? 'rgba(245,200,66,0.8)' : 'rgba(240,107,107,0.8)';
        ctx.fill();
      });

    } else if (isHollow) {
      // Trapezoidal: ri → ro
      const tauRi = tauAt(ri);
      ctx.beginPath();
      ctx.moveTo(px(ri), py(tauRi));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.strokeStyle = 'rgba(240,107,107,0.90)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(ri), dB);
      ctx.lineTo(px(ri), py(tauRi));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.lineTo(px(ro), dB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(240,107,107,0.10)';
      ctx.fill();

      // Dashed zero for r < ri
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(240,107,107,0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px(0), dB); ctx.lineTo(px(ri), dB); ctx.stroke();
      ctx.setLineDash([]);

      // Dot at ri
      ctx.beginPath();
      ctx.arc(px(ri), py(tauRi), 3, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(240,107,107,0.8)';
      ctx.fill();

    } else {
      // Solid: triangle 0 → ro
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.strokeStyle = 'rgba(240,107,107,0.90)';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px(0), dB);
      ctx.lineTo(px(0), py(0));
      ctx.lineTo(px(ro), py(tau_max));
      ctx.lineTo(px(ro), dB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(240,107,107,0.10)';
      ctx.fill();
    }

    // τ_max label — use tau_max_plot so it always points to the top of the axis
    const tauMaxDisp = si2u_stress(tau_max_plot);
    ctx.font = 'bold 9px DM Mono,monospace';
    ctx.fillStyle = 'rgba(240,107,107,0.90)';
    ctx.textAlign = 'right';
    ctx.fillText(fmtSciPreview(tauMaxDisp) + ' ' + u.unitStress, dR, dT + 10);

    // τ at ri label — composite: show both nucleus and annulus values
    if ((isHollow || isComposite) && ri > 0) {
      if (isComposite) {
        // Annulus side
        const tauRiAnnDisp = si2u_stress(tauAt(ri * 1.0001));
        ctx.font = '8px DM Mono,monospace';
        ctx.fillStyle = 'rgba(240,107,107,0.70)';
        ctx.textAlign = 'left';
        ctx.fillText(fmtSciPreview(tauRiAnnDisp), px(ri) + 3, py(tauAt(ri * 1.0001)) - 3);
        // Nucleus side (may be above annulus)
        const tauRiCoreDisp = si2u_stress(tauAt(ri * 0.9999));
        ctx.fillStyle = 'rgba(245,200,66,0.80)';
        ctx.textAlign = 'right';
        ctx.fillText(fmtSciPreview(tauRiCoreDisp), px(ri) - 3, py(tauAt(ri * 0.9999)) - 3);
      } else {
        const tauRiVal  = tauAt(ri);
        const tauRiDisp = si2u_stress(tauRiVal);
        ctx.font = '8px DM Mono,monospace';
        ctx.fillStyle = 'rgba(240,107,107,0.70)';
        ctx.textAlign = 'left';
        ctx.fillText(fmtSciPreview(tauRiDisp), px(ri) + 3, py(tauRiVal) - 3);
      }
    }
  } else {
    // T = 0 — note
    ctx.font = '9px DM Mono,monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.textAlign = 'center';
    ctx.fillText('T = 0 en este x', dL + dW/2, dB - dH/2);
  }

  // ── Info strip below canvas ───────────────────────────────────
  const mkChip = (lbl, val, col) =>
    '<span style="color:var(--txt3);font-size:9px">' + lbl + '</span>&nbsp;' +
    '<span style="color:' + col + ';font-size:11px">' + val + '</span>';

  const T_disp      = si2u_moment(T_elem);
  const tau_ro_disp = si2u_stress(tau_max);

  const chips = [
    mkChip('x =', xm.toFixed(4) + ' m',               'var(--txt2)'),
    mkChip('seg.',  (segIdx+1) + ' — ' + typeStr,      'var(--txt2)'),
    mkChip('D_e =', (de*1000).toFixed(2) + ' mm',      segCol),
  ];
  if (ri > 0) chips.push(mkChip(isComposite ? 'D_int =' : 'D_i =', (di*1000).toFixed(2) + ' mm', 'var(--txt2)'));
  chips.push(mkChip('T =',     fmtSciPreview(T_disp) + ' ' + u.unitMoment,     'var(--acc)'));
  chips.push(mkChip('τ_max =', fmtSciPreview(tau_ro_disp) + ' ' + u.unitStress,'var(--red)'));
  if (isHollow) {
    const v = si2u_stress(tauAt(ri));
    chips.push(mkChip('τ(r_i) =', fmtSciPreview(v) + ' ' + u.unitStress, 'var(--orange)'));
  }
  if (isComposite) {
    const vA = si2u_stress(tauAt(ri * 1.0001));
    const vC = si2u_stress(tauAt(ri * 0.9999));
    chips.push(mkChip('τ_anillo(r_i) =', fmtSciPreview(vA) + ' ' + u.unitStress, 'var(--orange)'));
    chips.push(mkChip('τ_núcleo(r_i) =', fmtSciPreview(vC) + ' ' + u.unitStress, 'var(--acc)'));
  }

  const sep = '<span style="color:var(--brd2);margin:0 4px">|</span>';
  document.getElementById('stpInfo').innerHTML = chips.join(sep);
  document.getElementById('stpXBadge').textContent = 'x = ' + xm.toFixed(4) + ' m';

  // Save diagram geometry for interactive hover/click
  stpDiagState = { dL, dR, dB, dT, dW, dH, ro, ri, isHollow, isComposite, tauFn: tauAt, tauMaxPlot: tau_max_plot, s, elemIdx, xm };
  stpAttachEvents();

  } catch(e) { console.warn('drawSectionPanel error:', e); }
}

function drawSectionPanelEmpty() {
  const cvs = document.getElementById('cvSection');
  if (!cvs) return;
  const W = (cvs.parentElement ? cvs.parentElement.clientWidth : 0) || 500;
  const H = Math.round(W * 0.38);
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Left: dashed circle placeholder
  const cx = W * 0.21, cy = H / 2, r = Math.min(cx - 14, cy - 12);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Right: faint axes + diagonal hint of a curve
  const dL = W * 0.42 + 36, dR = W - 14, dB = H - 22, dT = 22;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(dL, dB); ctx.lineTo(dR, dB); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dL, dT); ctx.lineTo(dL, dB); ctx.stroke();
  ctx.strokeStyle = 'rgba(240,107,107,0.12)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(dL, dB); ctx.lineTo(dR, dT + 8); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.font = '10px DM Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Haz click en cualquier gráfico', W / 2, H / 2 + 4);
}

function drawSectionPanelFromSelected() {
  const priority = ['cT','cTau','cPhi','cGJ','cQ'];
  for (const id of priority) {
    if (selectedPoints[id] !== undefined) {
      drawSectionPanel(selectedPoints[id]);
      return;
    }
  }
  drawSectionPanelEmpty();
}

function drawSectionPanelForElem(elemIdx) {
  drawSectionPanel(elemIdx);
}

function drawSectionPanelResize() {
  if (lastSolveData) {
    drawSectionPanelFromSelected();
  } else {
    drawSectionPanelEmpty();
  }
}

// ── INTERACTIVE τ(r) DIAGRAM ──────────────────────────────────
let _stpEventsAttached = false;

function stpAttachEvents() {
  if (_stpEventsAttached) return;
  _stpEventsAttached = true;
  const cvs = document.getElementById('cvSection');
  const tip = document.getElementById('stpTooltip');
  if (!cvs || !tip) return;

  cvs.addEventListener('mousemove', e => stpHandlePointer(e, false));
  cvs.addEventListener('click',     e => stpHandlePointer(e, true));
  cvs.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    // Restore clean panel on leave
    if (stpDiagState && !_stpRafPending) {
      _stpRafPending = true;
      requestAnimationFrame(() => {
        _stpRafPending = false;
        if (stpDiagState) drawSectionPanel(stpDiagState.elemIdx);
      });
    }
  });
}

let _stpRafPending = false;
let _stpPendingR = 0, _stpPendingTau = 0, _stpPendingVoid = false;

function stpHandlePointer(e, isClick) {
  if (!stpDiagState) return;
  const { dL, dR, dB, dT, dW, dH, ro, ri, isHollow, isComposite, tauFn, s } = stpDiagState;
  const u = currentUnits;
  const tip = document.getElementById('stpTooltip');
  const cvs = document.getElementById('cvSection');
  if (!tip || !cvs) return;

  const rect  = cvs.getBoundingClientRect();
  const scaleX = cvs.width  / rect.width;
  const scaleY = cvs.height / rect.height;
  const mx = (e.clientX - rect.left)  * scaleX;
  const my = (e.clientY - rect.top)   * scaleY;

  // Only respond inside the diagram area (right side)
  if (mx < dL - 8 || mx > dR + 8 || my < dT - 8 || my > dB + 8) {
    tip.style.display = 'none';
    return;
  }

  const rFrac = (mx - dL) / dW;
  if (rFrac < -0.02 || rFrac > 1.02) { tip.style.display = 'none'; return; }

  const r_m   = Math.max(0, Math.min(ro, rFrac * ro));
  const inVoid = isHollow && r_m < ri;
  const tau_SI = inVoid ? 0 : tauFn(r_m);
  const tau_d  = si2u_stress(tau_SI);
  const r_mm   = r_m * 1000;

  let matLabel = '';
  if (isComposite) {
    matLabel = r_m <= ri
      ? '<span style="color:var(--acc)">núcleo (mat 1)</span>'
      : '<span style="color:var(--blue)">anillo (mat 2)</span>';
  } else if (isHollow) {
    matLabel = inVoid
      ? '<span style="color:var(--txt3)">sin material (hueco)</span>'
      : '<span style="color:var(--teal)">sección</span>';
  }

  tip.innerHTML =
    '<span style="color:var(--txt3)">r =</span> <b style="color:var(--txt)">' + r_mm.toFixed(3) + ' mm</b><br>' +
    '<span style="color:var(--red)">τ =</span> <b style="color:var(--red)">' +
    (inVoid ? '—' : fmtSciPreview(tau_d) + ' ' + u.unitStress) + '</b>' +
    (matLabel ? '<br>' + matLabel : '');

  const tipW = 148, tipH = matLabel ? 58 : 44;
  let tx = (e.clientX - rect.left) + 14;
  let ty = (e.clientY - rect.top)  - tipH / 2;
  if (tx + tipW > rect.width - 4)  tx = (e.clientX - rect.left) - tipW - 10;
  if (ty < 2) ty = 2;
  if (ty + tipH > rect.height - 2) ty = rect.height - tipH - 2;
  tip.style.left    = tx + 'px';
  tip.style.top     = ty + 'px';
  tip.style.display = 'block';

  // Throttled redraw with marker via rAF
  _stpPendingR    = r_m;
  _stpPendingTau  = tau_SI;
  _stpPendingVoid = inVoid;

  if (!_stpRafPending) {
    _stpRafPending = true;
    requestAnimationFrame(() => {
      _stpRafPending = false;
      // Redraw base panel without triggering event re-attach
      if (stpDiagState) {
        try { _stpBaseRedraw(); } catch(ex) {}
        stpDrawMarker(_stpPendingR, _stpPendingTau, _stpPendingVoid);
      }
    });
  }
}

// Redraw base canvas without re-saving stpDiagState (avoids recursion)
function _stpBaseRedraw() {
  if (!stpDiagState) return;
  drawSectionPanel(stpDiagState.elemIdx);
}

function stpDrawMarker(r_m, tau_SI, inVoid) {
  if (!stpDiagState) return;
  const { dL, dR, dB, dT, dW, dH, ro } = stpDiagState;

  const cvs = document.getElementById('cvSection');
  if (!cvs) return;
  const ctx = cvs.getContext('2d');

  const tau_max = stpDiagState.tauMaxPlot || stpDiagState.tauFn(ro);
  if (tau_max < 1e-30) return;

  function px(r) { return dL + (ro > 0 ? (r / ro) * dW : 0); }
  function py(t) { return dB - (t / tau_max) * dH; }

  const xPx = px(r_m);
  const yPx = inVoid ? dB : py(tau_SI);

  ctx.save();

  // Vertical hairline
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(xPx, dT); ctx.lineTo(xPx, dB); ctx.stroke();
  ctx.setLineDash([]);

  if (!inVoid) {
    // Horizontal hairline to y axis
    ctx.strokeStyle = 'rgba(240,107,107,0.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(dL, yPx); ctx.lineTo(xPx, yPx); ctx.stroke();
    ctx.setLineDash([]);

    // Marker dot
    ctx.beginPath();
    ctx.arc(xPx, yPx, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f07070';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function drawSegBarData(cvs, xsE, dE, L) {
  const W = cvs.offsetWidth || 600, H = 44;
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const maxD = Math.max(...dE, 0.001);
  const pal = ['#f5c842','#60b8f5','#f0a060','#50d4b8','#b090f5','#f07070'];
  const n = xsE.length;

  xsE.forEach((x,i) => {
    const x1 = i / n * W, x2 = (i + 1) / n * W;
    const h = Math.max(4, dE[i] / maxD * (H - 6));
    const y = (H - h) / 2;
    const si = segs.findIndex(s => parseFloat(x) >= s.xa - 1e-9 && parseFloat(x) <= s.xb + 1e-9);
    ctx.fillStyle = pal[Math.max(0,si) % pal.length] + '22';
    ctx.fillRect(x1,y,x2-x1,h);

    // Draw hollow inner hole or composite core if applicable
    const seg = si >= 0 ? segs[si] : null;
    if (seg && (seg.di || 0) > 0) {
      const xm = parseFloat(x);
      const len = seg.xb - seg.xa;
      const tt = len > 1e-12 ? (xm - seg.xa) / len : 0;
      const di2val = (seg.di2 !== undefined) ? seg.di2 : seg.di;
      const di = seg.di + (di2val - seg.di) * tt;
      const hi = Math.max(0, di / maxD * (H - 6));
      const yi = (H - hi) / 2;
      if (seg.composite) {
        ctx.fillStyle = 'rgba(168,141,240,0.20)';
      } else {
        ctx.fillStyle = '#0d0f10';
      }
      ctx.fillRect(x1, yi, x2-x1, hi);
    }
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0,H/2);
  ctx.lineTo(W,H/2);
  ctx.stroke();
}

// ── SHAFT DIAGRAM ─────────────────────────────────────────────
function drawShaftDiagram() {
  const cvs = document.getElementById('cvShaft');
  if (!cvs) return;
  const W = (cvs.parentElement ? cvs.parentElement.clientWidth : 600) || 600;
  const H = 120;
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const L   = iL() || 0.312;
  const PAD = 46;
  const sY  = Math.round(H * 0.62);  // shaft centerline Y — low enough for labels above
  const sH  = 20;
  const bX1 = PAD, bX2 = W - PAD;
  const bW  = bX2 - bX1;
  const toX = x => bX1 + (x / L) * bW;
  const pal = ['#f5c842','#60b8f5','#f0a060','#50d4b8','#b090f5','#f07070'];

  // ── Shaft body ──────────────────────────────────────────────
  if (!segs.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(bX1, sY - sH/2, bW, sH);
  } else {
    segs.forEach((s, i) => {
      const x1 = toX(s.xa), x2 = toX(s.xb);
      const col = pal[i % pal.length];
      ctx.fillStyle = col + '28';
      ctx.fillRect(x1, sY - sH/2, x2 - x1, sH);
      ctx.strokeStyle = col + '80';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, sY - sH/2, x2 - x1, sH);
    });
  }

  // centerline dashed
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(bX1, sY); ctx.lineTo(bX2, sY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── BCs ──────────────────────────────────────────────────────
  // First letter = A (left): F=fixed, S=spring
  // Second letter = B (right): F=free, C=fixed, S=spring
  const bc = iBC();
  const leftFixed   = (bc === 'FF' || bc === 'FC' || bc === 'FS');
  const leftSpring  = (bc === 'SF' || bc === 'SC' || bc === 'SS');
  const rightFixed  = (bc === 'FF' || bc === 'SC');
  const rightFree   = (bc === 'FC' || bc === 'SF');
  const rightSpring = (bc === 'FS' || bc === 'SS');

  function drawFixed(x, side) {
    const w = 9, hh = sH + 14;
    const rx = side === 'left' ? x - w : x;
    ctx.fillStyle = 'rgba(96,184,245,0.16)';
    ctx.fillRect(rx, sY - hh/2, w, hh);
    ctx.strokeStyle = 'rgba(96,184,245,0.80)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(rx, sY - hh/2, w, hh);
    ctx.strokeStyle = 'rgba(96,184,245,0.30)';
    ctx.lineWidth = 1;
    for (let yy = sY - hh/2 + 5; yy < sY + hh/2; yy += 5) {
      const ex = side === 'left' ? rx : rx + w;
      const dx = side === 'left' ? -5 : 5;
      ctx.beginPath(); ctx.moveTo(ex, yy); ctx.lineTo(ex + dx, yy + 4); ctx.stroke();
    }
  }

  function drawFreeEnd(x) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, sY - sH/2 - 3); ctx.lineTo(x, sY + sH/2 + 3); ctx.stroke();
  }

  function drawTorsionalSpring(x, side) {
    const nCoil = 4, amp = 6, step = 6;
    const dir   = side === 'left' ? -1 : 1;
    ctx.strokeStyle = 'rgba(240,160,96,0.90)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let cx = x;
    ctx.moveTo(cx, sY);
    cx += dir * 3; ctx.lineTo(cx, sY);
    for (let i = 0; i < nCoil * 2; i++) {
      cx += dir * step;
      ctx.lineTo(cx, sY + (i % 2 === 0 ? amp : -amp));
    }
    cx += dir * 3; ctx.lineTo(cx, sY);
    ctx.stroke();
    // Ground wall
    const gX = cx;
    const hw = 9;
    ctx.strokeStyle = 'rgba(240,160,96,0.90)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(gX, sY - hw); ctx.lineTo(gX, sY + hw); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,160,96,0.30)'; ctx.lineWidth = 1;
    for (let yy = sY - hw; yy <= sY + hw; yy += 5) {
      ctx.beginPath(); ctx.moveTo(gX, yy); ctx.lineTo(gX + dir * 4, yy + 3); ctx.stroke();
    }
  }

  if (leftFixed)        drawFixed(bX1, 'left');
  else if (leftSpring)  drawTorsionalSpring(bX1, 'left');
  else                  drawFreeEnd(bX1);

  if (rightFixed)       drawFixed(bX2, 'right');
  else if (rightFree)   drawFreeEnd(bX2);
  else if (rightSpring) drawTorsionalSpring(bX2, 'right');

  // End labels A / B
  ctx.font = '9px DM Mono,monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.textAlign = 'center';
  ctx.fillText('A', bX1 - (leftFixed ? 18 : leftSpring ? 22 : 6), sY + 4);
  ctx.fillText('B', bX2 + (rightFixed ? 18 : rightSpring ? 22 : 6), sY + 4);

  // ── Loads ────────────────────────────────────────────────────
  const arcCol = 'rgba(245,200,66,0.90)';
  const arcFnt = 'rgba(245,200,66,0.52)';

  // Draws a torque ring that wraps around the shaft in 3D perspective.
  // Front half (right side of ellipse): solid.  Back half (left side): dashed.
  // Arrowhead at the rightmost point of the front face:
  //   positive (CCW from right) → arrowhead points UP ↑
  //   negative (CW from right)  → arrowhead points DOWN ↓
  function drawTorqueRing(cx, ry, positive, color) {
    const rx = Math.max(4, ry * 0.42);  // horizontal depth for perspective
    const AH = 5;
    const faint = color.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.32).toFixed(2) + ')');

    ctx.save();

    // Back half (left side, dashed)
    ctx.strokeStyle = faint;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.ellipse(cx, sY, rx, ry, 0, -Math.PI / 2, Math.PI / 2, true);  // top→bottom through left
    ctx.stroke();
    ctx.setLineDash([]);

    // Front half (right side, solid)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (positive) {
      ctx.ellipse(cx, sY, rx, ry, 0, Math.PI / 2, -Math.PI / 2, true);  // bottom→top through right
    } else {
      ctx.ellipse(cx, sY, rx, ry, 0, -Math.PI / 2, Math.PI / 2, false); // top→bottom through right
    }
    ctx.stroke();

    // Arrowhead at rightmost point of front arc (cx+rx, sY): ↑ or ↓
    ctx.fillStyle = color;
    const tx = cx + rx, ty = sY;
    ctx.beginPath();
    if (positive) {
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - AH, ty + AH * 1.4);
      ctx.lineTo(tx + AH, ty + AH * 1.4);
    } else {
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - AH, ty - AH * 1.4);
      ctx.lineTo(tx + AH, ty - AH * 1.4);
    }
    ctx.closePath(); ctx.fill();

    ctx.restore();
  }

  loads.forEach(l => {
    if (l.tipo === 'pun') {
      const px  = toX(+l.x || 0);
      const val = +l.val || 0;
      const ry  = sH / 2 + 7;
      drawTorqueRing(px, ry, val >= 0, arcCol);
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = arcCol;
      ctx.textAlign = 'center';
      ctx.fillText(fmtSciPreview(Math.abs(val)), px, sY - ry - 5);

    } else if (l.tipo === 'dis') {
      const x1  = toX(+l.xa || 0);
      const x2  = toX(+l.xb || L);
      const val = +l.val || 0;
      const ry  = sH / 2 + 5;
      const sp  = ry * 1.8 + 8;
      for (let px = x1 + sp / 2; px <= x2 - sp / 4; px += sp)
        drawTorqueRing(px, ry, val >= 0, arcFnt);
      // Envelope lines connecting ring tops and bottoms
      const lineTop = sY - ry, lineBot = sY + ry;
      ctx.strokeStyle = 'rgba(245,200,66,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, lineTop); ctx.lineTo(x2, lineTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, lineBot); ctx.lineTo(x2, lineBot); ctx.stroke();
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = arcCol;
      ctx.textAlign = 'center';
      ctx.fillText(fmtSciPreview(Math.abs(val)), (x1 + x2) / 2, lineTop - 5);

    } else if (l.tipo === 'tri') {
      const x1     = toX(+l.xa || 0);
      const x2     = toX(+l.xb || L);
      const va     = +l.va || 0, vb = +l.vb || 0;
      const maxAbs = Math.max(Math.abs(va), Math.abs(vb)) || 1;
      const domVal = Math.abs(va) >= Math.abs(vb) ? (va || vb) : (vb || va);
      const ryMax  = sH / 2 + 7;
      const nArr   = Math.max(3, Math.round((x2 - x1) / (ryMax * 1.6 + 6)));
      for (let i = 0; i <= nArr; i++) {
        const frac = i / nArr;
        const px   = x1 + (x2 - x1) * frac;
        const qv   = va * (1 - frac) + vb * frac;
        if (Math.abs(qv) < 1e-12 * maxAbs) continue;
        const ry = Math.max(4, ryMax * Math.abs(qv) / maxAbs);
        drawTorqueRing(px, ry, qv >= 0, arcFnt);
      }

    } else if (l.tipo === 'pol') {
      const x1     = toX(+l.xa || 0);
      const x2     = toX(+l.xb || L);
      const midX   = (+l.xa + (+l.xb || L)) / 2;
      const midVal = evalExpr(l.expr, midX, iL()) || 0;
      const ry     = sH / 2 + 5;
      const sp     = ry * 1.8 + 8;
      for (let px = x1 + sp / 2; px <= x2 - sp / 4; px += sp)
        drawTorqueRing(px, ry, midVal >= 0, arcFnt);
      const lineTop = sY - ry;
      ctx.strokeStyle = 'rgba(245,200,66,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, lineTop); ctx.lineTo(x2, lineTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, sY + ry); ctx.lineTo(x2, sY + ry); ctx.stroke();
      ctx.font = '9px DM Mono,monospace';
      ctx.fillStyle = arcCol;
      ctx.textAlign = 'center';
      ctx.fillText(l.expr || 't(x)', (x1 + x2) / 2, lineTop - 5);
    }
  });

  // ── x-axis ticks ─────────────────────────────────────────────
  ctx.font = '8px DM Mono,monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  const nTicks = Math.min(6, Math.floor(bW / 60));
  for (let i = 0; i <= nTicks; i++) {
    const frac = i / nTicks;
    const px   = bX1 + frac * bW;
    ctx.textAlign = 'center';
    ctx.fillText((frac * L).toFixed(3) + 'm', px, sY + sH/2 + 14);
    ctx.beginPath(); ctx.moveTo(px, sY + sH/2); ctx.lineTo(px, sY + sH/2 + 4); ctx.stroke();
  }
}

// ── SAVE / LOAD PROJECT ───────────────────────────────────────
function tSaveProject() {
  const kAEl = document.getElementById('iKA');
  const kBEl = document.getElementById('iKB');
  const data = {
    version: '3.5',
    module: 'torsion',
    segs:  JSON.parse(JSON.stringify(segs)),
    loads: JSON.parse(JSON.stringify(loads)),
    sid, lid,
    n:  document.getElementById('iN')?.value || '30',
    bc: iBC(),
    kA: kAEl ? kAEl.value : '',
    kB: kBEl ? kBEl.value : '',
    units: { tUnitTorque, tUnitG, tUnitStress },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'proyecto_torsion.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function tLoadProject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.module && data.module !== 'torsion') {
        showErr('Este archivo es de otro módulo (' + data.module + ').');
        return;
      }
      segs.length = 0;  (data.segs  || []).forEach(s => segs.push(s));
      loads.length = 0; (data.loads || []).forEach(l => loads.push(l));
      sid = data.sid  || segs.reduce((m,s) => Math.max(m, s.id||0), 0);
      lid = data.lid  || loads.reduce((m,l) => Math.max(m, l.id||0), 0);
      const nEl = document.getElementById('iN');
      if (nEl && data.n) nEl.value = data.n;
      const bcEl = document.getElementById('iBC');
      if (bcEl && data.bc) bcEl.value = data.bc;
      const u = data.units || {};
      if (u.tUnitTorque) tUnitTorque = u.tUnitTorque;
      if (u.tUnitG)      tUnitG      = u.tUnitG;
      if (u.tUnitStress) tUnitStress = u.tUnitStress;
      tBuildUnits();
      tRenderUnitPanel();
      renderBCFields();
      // Restore spring K values after BC fields are rendered
      setTimeout(() => {
        if (data.kA) { const el = document.getElementById('iKA'); if (el) el.value = data.kA; }
        if (data.kB) { const el = document.getElementById('iKB'); if (el) el.value = data.kB; }
        initSciBadges();
      }, 0);
      renderSegs();
      renderLoads();
      updateChartUnitLabels();
      updateLDisplay();
      showErr('');
    } catch(err) {
      showErr('Error al cargar: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ── EXPORT PNG ────────────────────────────────────────────────
function tExportPNG() {
  if (!lastSolveData) { alert('Calcula primero para exportar resultados.'); return; }
  const BG = '#0d0f10', BG2 = '#14171a', BG3 = '#1b1f23';
  const W = 900, PAD = 24, HEADER = 80, SHAFT_H = 120, CHART_H = 190, GAP = 8;

  const chartOrder = ['cQ','cT','cPhi','cTau','cGJ'];
  const visibleCharts = chartOrder.filter(id => {
    const el = document.getElementById(id);
    return el && charts[id];
  });

  const totalH = HEADER + SHAFT_H + GAP + visibleCharts.length * (CHART_H + GAP) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, totalH);
  ctx.fillStyle = BG2; ctx.fillRect(0, 0, W, HEADER);

  ctx.fillStyle = '#f5c842';
  ctx.font = 'bold 17px "DM Mono", monospace';
  ctx.fillText('MM1 FEM Libre v3.5 — Torsión FEM', PAD, 30);

  ctx.font = '11px "DM Mono", monospace';
  ctx.fillStyle = '#8a857c';
  const L = lastSolveData.L || 0;
  ctx.fillText(`L = ${L.toFixed(4)} m  ·  ${segs.length} segmento(s)  ·  ${loads.length} carga(s)  ·  BC: ${iBC()}`, PAD, 52);

  // Metric summary row
  const mRow = document.getElementById('mrow');
  if (mRow) {
    let mx = PAD, my = 68;
    ctx.font = '10px "DM Mono", monospace';
    mRow.querySelectorAll('.met').forEach(m => {
      const lbl = m.querySelector('.ml')?.textContent || '';
      const val = (m.querySelector('.mv')?.textContent || '').trim();
      ctx.fillStyle = '#8a857c'; ctx.fillText(lbl + ':', mx, my);
      ctx.fillStyle = '#ffffff'; ctx.fillText(val, mx + ctx.measureText(lbl + ':  ').width, my);
      mx += 160;
      if (mx > W - 160) { mx = PAD; my += 16; }
    });
  }

  let y = HEADER;

  // Shaft diagram
  const shaftCv = document.getElementById('cvShaft');
  if (shaftCv) {
    ctx.fillStyle = BG3; ctx.fillRect(0, y, W, SHAFT_H);
    ctx.drawImage(shaftCv, 0, y, W, SHAFT_H);
    y += SHAFT_H + GAP;
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
  a.download = 'resultados_torsion.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// ── RESIZE ────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  drawSegBar('cvSeg');
  drawShaftDiagram();
  drawSectionPanelResize();

  const res = document.getElementById('resContent');
  const cvRes = document.getElementById('cvRes');
  if (res && cvRes && res.style.display !== 'none') {
    const L = iL();
    const nEl = segs.length * iN();
    const le = L / nEl;

    const dE = [];
    for (let e = 0; e < nEl; e++) {
      const xm = (e + 0.5) * le;
      const s = segs.find(s => xm >= s.xa - 1e-9 && xm <= s.xb + 1e-9) || segs[segs.length - 1];
      const len = s.xb - s.xa;
      const tt = len > 1e-12 ? (xm - s.xa) / len : 0;
      const de2 = (s.d2 !== undefined) ? s.d2 : s.d;
      const dxm = s.d + (de2 - s.d) * tt;
      dE.push(dxm);
    }

    const xsE = Array.from({length:nEl}, (_,i) => ((i+0.5)*le).toFixed(5));
    drawSegBarData(cvRes, xsE, dE, L);
  }
});

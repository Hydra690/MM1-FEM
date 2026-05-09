// ══════════════════════════════════════════════════════════════
// main.js — Inicialización y control de módulos
// Contenido:
//   · switchModule: alterna entre Torsión y Flexión
//   · Init: inicializa ambos módulos al cargar la página
//   · Manual drawer: openManual, closeManual, mnav
// ══════════════════════════════════════════════════════════════
// ── MODULE SWITCHER ───────────────────────────────────────────
let currentModule = 'torsion';

function switchModule(mod) {
  currentModule = mod;
  document.getElementById('moduleTorsion').style.display = mod === 'torsion' ? '' : 'none';
  document.getElementById('moduleFlexion').style.display = mod === 'flexion'  ? '' : 'none';
  document.getElementById('moduleAxial').style.display   = mod === 'axial'    ? '' : 'none';
  document.getElementById('modBtnTorsion').className = 'mod-btn' + (mod === 'torsion' ? ' active' : '');
  document.getElementById('modBtnFlexion').className = 'mod-btn' + (mod === 'flexion' ? ' active-blue' : '');
  document.getElementById('modBtnAxial').className   = 'mod-btn' + (mod === 'axial'   ? ' active-teal' : '');
  if (mod === 'flexion') {
    setTimeout(() => { fDrawSegBar(); drawBeamDiagram(); }, 60);
  } else if (mod === 'torsion') {
    setTimeout(() => { drawSegBar('cvSeg'); drawShaftDiagram(); }, 60);
  } else if (mod === 'axial') {
    setTimeout(() => aOnResize(), 60);
  }
}

fInit();
aInit();

// ── TORSION INIT ─────────────────────────────────────────────
tBuildUnits();  // populate currentUnits from independent selectors before anything else
tRenderUnitPanel();
addSeg();
addLoad('pol');
renderBCFields();
updateChartUnitLabels();
const _unitHint = document.getElementById('unitHint');
if (_unitHint) _unitHint.textContent = currentUnits.hintText;
setTimeout(initSciBadges, 0);
setTimeout(drawSectionPanelEmpty, 0);

function openManual(){
  document.getElementById('manualOverlay').classList.add('open');
  document.getElementById('manualDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeManual(){
  document.getElementById('manualOverlay').classList.remove('open');
  document.getElementById('manualDrawer').classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeManual(); });

function mnav(el){
  document.querySelectorAll('.manual-nav-item').forEach(a => a.classList.remove('on'));
  el.classList.add('on');
  const target = document.querySelector(el.getAttribute('href'));
  if(target){
    document.getElementById('manualContent').scrollTo({top: target.offsetTop - 16, behavior:'smooth'});
  }
}

// Update nav highlight on scroll inside drawer
document.addEventListener('DOMContentLoaded', () => {
  const mc = document.getElementById('manualContent');
  if(!mc) return;
  mc.addEventListener('scroll', () => {
    const sections = mc.querySelectorAll('h2[id]');
    let current = null;
    sections.forEach(s => {
      if(s.offsetTop - mc.scrollTop <= 60) current = s.id;
    });
    if(current){
      document.querySelectorAll('.manual-nav-item').forEach(a => {
        a.classList.toggle('on', a.getAttribute('href') === '#' + current);
      });
    }
  });
});


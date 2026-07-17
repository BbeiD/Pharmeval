// Logique applicative Pharmeval (etat, moteur de quiz, rendu, statistiques,
// signalements, galeries d'images). Extrait tel quel du fichier monolithique v1.1.0.

let selectedConseil = new Set();
let selectedMed = new Set();
let selectedDermo = new Set();
let selectedProc = new Set();
let selectedBppo = new Set();
let selectedFtm = new Set();
let selectedDeon = new Set();
let selectedEtudiant = new Set();
let selectedBapcoc = new Set();
let selectedLeg = new Set();
let selectedGal = new Set();
let selectedAdm = new Set();
let selectedDiff = 'all';
let activeTheme = 'conseil';
let quiz = { questions:[], idx:0, score:0, answered:false, lastSub:'all', answeredCount:0 };
let currentProfile = null;
let stats = { total: 0, correct: 0 };

function getActiveSelection() {
  if (activeTheme === 'conseil') return selectedConseil;
  if (activeTheme === 'dermo') return selectedDermo;
  if (activeTheme === 'procedures') return selectedProc;
  if (activeTheme === 'bppo') return selectedBppo;
  if (activeTheme === 'ftm') return selectedFtm;
  if (activeTheme === 'deon') return selectedDeon;
  if (activeTheme === 'etudiant') return selectedEtudiant;
  if (activeTheme === 'bapcoc') return selectedBapcoc;
  if (activeTheme === 'legislation') return selectedLeg;
  if (activeTheme === 'galenique') return selectedGal;
  if (activeTheme === 'adm') return selectedAdm;
  return selectedMed;
}

// ===================== UI HELPERS =====================
function show(id) {
  ['home-view','quiz-view','results-view'].forEach(v => {
    var el = document.getElementById(v);
    if (el) el.style.display = v === id ? 'block' : 'none';
  });
}

function setTheme(theme) {
  activeTheme = theme;
  document.querySelectorAll('.theme-tab').forEach(t => t.classList.remove('active'));
  var tabEl = document.getElementById('tab-' + theme);
  if (tabEl) tabEl.classList.add('active');
  var labelEl = document.getElementById('subtheme-label');
  if (labelEl) {
    labelEl.textContent = theme === 'conseil' ? 'Pathologies' : theme === 'dermo' ? 'Marques' : theme === 'procedures' ? 'Modules' : theme === 'bppo' ? 'Domaines' : theme === 'ftm' ? 'Domaines' : theme === 'deon' ? 'Thèmes' : theme === 'etudiant' ? 'Sous-thèmes' : theme === 'bapcoc' ? 'Domaines' : theme === 'legislation' ? 'Chapitres' : theme === 'galenique' ? 'Chapitres' : theme === 'adm' ? 'Chapitres' : 'Systèmes thérapeutiques';
  }
  renderCats();
}

function selectAllVisible() {
  const sel = getActiveSelection();
  const keys = getVisibleKeys();
  const allSel = keys.every(k => sel.has(k));
  keys.forEach(k => allSel ? sel.delete(k) : sel.add(k));
  renderCats();
}

function getVisibleKeys() {
  if (activeTheme === 'conseil') return Object.keys(CONSEIL_CATS);
  if (activeTheme === 'dermo') return Object.keys(DERMO_CATS);
  if (activeTheme === 'procedures') return Object.keys(PROC_CATS);
  if (activeTheme === 'bppo') return Object.keys(BPPO_CATS);
  if (activeTheme === 'ftm') return Object.keys(FTM_CATS);
  if (activeTheme === 'deon') return Object.keys(DEON_CATS);
  if (activeTheme === 'etudiant') return Object.keys(ETUDIANT_CATS);
  if (activeTheme === 'bapcoc') return Object.keys(BAPCOC_CATS);
  if (activeTheme === 'legislation') return Object.keys(LEG_CATS);
  if (activeTheme === 'galenique') return Object.keys(GAL_CATS);
  if (activeTheme === 'adm') return Object.keys(ADM_CATS);
  return CBIP_TYPES.map(t => t.key);
}

function getQuestionsForKey(key) {
  const diff = q => selectedDiff === 'all' || q.d === selectedDiff;
  if (PROC_CATS[key] || BPPO_CATS[key] || FTM_CATS[key] || DEON_CATS[key] || ETUDIANT_CATS[key] || BAPCOC_CATS[key] || LEG_CATS[key] || GAL_CATS[key] || ADM_CATS[key]) {
    return QDB.filter(q => q.sub === key && diff(q));
  } else if (CONSEIL_CATS[key]) {
    return QDB.filter(q => q.sub === key && diff(q));
  } else if (DERMO_CATS[key]) {
    return QDB.filter(q => q.sub === key && diff(q));
  } else {
    const type = CBIP_TYPES.find(t => t.key === key);
    return type ? QDB.filter(q => type.filter(q) && diff(q)) : [];
  }
}

function renderCats() {
  // Update theme tab counts
  const conseilCount = Object.keys(CONSEIL_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const medCount = CBIP_TYPES.reduce((n, t) =>
    n + QDB.filter(q => t.filter(q) && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const dermoCount = Object.keys(DERMO_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const procCount = Object.keys(PROC_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const countConseilEl = document.getElementById('count-conseil');
  if (countConseilEl) countConseilEl.textContent = conseilCount + ' questions';
  const countMedEl = document.getElementById('count-medicaments');
  if (countMedEl) countMedEl.textContent = medCount + ' questions';
  const countDermoEl = document.getElementById('count-dermo');
  if (countDermoEl) countDermoEl.textContent = dermoCount + ' questions';
  const procEl = document.getElementById('count-procedures');
  if (procEl) procEl.textContent = procCount + ' questions';
  const bppoCount = Object.keys(BPPO_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const bppoEl = document.getElementById('count-bppo');
  if (bppoEl) bppoEl.textContent = bppoCount + ' questions';
  const ftmCount = Object.keys(FTM_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const ftmEl = document.getElementById('count-ftm');
  if (ftmEl) ftmEl.textContent = ftmCount + ' questions';
  const deonCount = Object.keys(DEON_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const deonEl = document.getElementById('count-deon');
  if (deonEl) deonEl.textContent = deonCount + ' questions';
  const etudiantCount = Object.keys(ETUDIANT_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const etudiantEl = document.getElementById('count-etudiant');
  if (etudiantEl) etudiantEl.textContent = etudiantCount + ' questions';
  const legCount = Object.keys(LEG_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const legEl = document.getElementById('count-legislation');
  if (legEl) legEl.textContent = legCount + ' questions';
  const galCount = Object.keys(GAL_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const galEl = document.getElementById('count-galenique');
  if (galEl) galEl.textContent = galCount + ' questions';
  const admCount = Object.keys(ADM_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===selectedDiff)).length, 0);
  const admEl = document.getElementById('count-adm');
  if (admEl) admEl.textContent = admCount + ' questions';

  // Group totals
  const gcFamilia = (conseilCount + dermoCount + procCount);
  const gcRef = (medCount + bppoCount + ftmCount + deonCount);
  // Groupe fusionne "Cours" / "Etudiant" : le contenu affiche depend du profil
  // actif (voir applyProfileVisibility pour le libelle). Pharmacien ne voit
  // que Pharmacotherapie dans ce groupe ; Etudiant y voit les 4 onglets.
  const gcCours = (currentProfile === 'pharmacist')
    ? etudiantCount
    : (etudiantCount + legCount + galCount + admCount);
  const gcFEl = document.getElementById('groupcount-familia');
  const gcREl = document.getElementById('groupcount-referentiels');
  const gcCEl = document.getElementById('groupcount-cours');
  if (gcFEl) gcFEl.textContent = gcFamilia + ' q.';
  if (gcREl) gcREl.textContent = gcRef + ' q.';
  if (gcCEl) gcCEl.textContent = gcCours + ' q.';
  const bapcoc_count = Object.keys(BAPCOC_CATS).reduce((n, k) =>
    n + QDB.filter(q => q.sub===k && (selectedDiff==='all'||q.d===q.d)).length, 0);
  const gcBEl = document.getElementById('groupcount-bapcoc');
  if (gcBEl) gcBEl.textContent = bapcoc_count + ' q.';
  const countBEl = document.getElementById('count-bapcoc');
  if (countBEl) countBEl.textContent = bapcoc_count + ' questions';

  updateHeaderCount();

  const grid = document.getElementById('cats-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const keys = getVisibleKeys();
  const sel = getActiveSelection();

  keys.forEach(key => {
    const cat = CATS[key];
    const qs = getQuestionsForKey(key);
    const count = qs.length;
    const div = document.createElement('div');
    div.className = 'cat-card' + (sel.has(key) ? ' selected' : '');

    let subtags = '';
    if (activeTheme === 'conseil') {
      const pathologies = [...new Set(qs.map(q => q.t))].slice(0, 5);
      if (pathologies.length > 0) {
        subtags = '<div class="cat-tags">' +
          pathologies.map(p => `<span class="cat-tag">${p}</span>`).join('') +
        '</div>';
      }
    } else if (activeTheme === 'procedures') {
      // no subtags for procedures
    } else if (activeTheme === 'dermo') {
      // Show LRP categories breakdown
      const categories = [...new Set(qs.map(q => q.t))].slice(0, 5);
      if (categories.length > 0) {
        subtags = '<div class="cat-tags">' +
          categories.map(p => `<span class="cat-tag">${p}</span>`).join('') +
        '</div>';
      }
    } else {
      // Show type breakdown (EI, interactions, etc.)
      const TYPE_SHORT = {
        "Effets indésirables": "EI",
        "Interactions": "Interactions",
        "Contre-indications": "CI",
        "Patients âgés": "Pers. âgées",
        "Grossesse": "Grossesse",
        "Signes d'alerte": "Alertes",
        "Conseil patient": "Conseil",
        "Bon usage": "Bon usage",
        "Surveillance": "Surveillance",
        "Erreurs fréquentes": "Erreurs"
      };
      const typeCounts = {};
      qs.forEach(q => {
        const tLabel = (q.t || '').replace('CBIP – ', '');
        const short = TYPE_SHORT[tLabel] || tLabel;
        typeCounts[short] = (typeCounts[short] || 0) + 1;
      });
      const tagItems = Object.entries(typeCounts)
        .sort((a,b) => b[1]-a[1])
        .slice(0, 4)
        .map(([lbl, n]) => `<span class="cat-tag">${lbl} (${n})</span>`)
        .join('');
      if (tagItems) subtags = `<div class="cat-tags">${tagItems}</div>`;
    }

    div.innerHTML = `
      <div class="cat-check"><i class="ti ti-check"></i></div>
      <div class="cat-icon">${cat.icon}</div>
      <div class="cat-name">${cat.label}</div>
      <div class="cat-count">${count} question${count>1?'s':''}</div>
      ${subtags}
    `;
    div.onclick = () => {
      sel.has(key) ? sel.delete(key) : sel.add(key);
      const w = document.getElementById('empty-warning');
      if (w) w.parentNode.removeChild(w);
      renderCats();
    };
    grid.appendChild(div);
  });
}

function setDiff(d) {
  selectedDiff = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('diff-' + d).classList.add('active');
  renderCats();
}

function updateStatsDisplay() {
  var totalEl = document.getElementById('stat-total');
  if (totalEl) totalEl.textContent = stats.total;
  var pctEl = document.getElementById('stat-pct');
  if (pctEl) pctEl.textContent = stats.total > 0
    ? Math.round(stats.correct/stats.total*100) + '%' : '–';
}

// ===================== QUIZ LOGIC =====================
function startQuiz(mode) {
  let pool;
  const diff = q => selectedDiff === 'all' || q.d === selectedDiff;

  if (mode === 'last') {
    pool = quiz.questions;
  } else if (mode === 'all') {
    // Tout le quiz = toutes les questions du thème actif uniquement
    if (activeTheme === 'conseil') {
      pool = QDB.filter(q => CONSEIL_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'procedures') {
      pool = QDB.filter(q => PROC_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'bppo') {
      pool = QDB.filter(q => BPPO_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'ftm') {
      pool = QDB.filter(q => FTM_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'deon') {
      pool = QDB.filter(q => DEON_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'etudiant') {
      pool = QDB.filter(q => ETUDIANT_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'bapcoc') {
      pool = QDB.filter(q => BAPCOC_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'dermo') {
      pool = QDB.filter(q => DERMO_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'legislation') {
      pool = QDB.filter(q => LEG_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'galenique') {
      pool = QDB.filter(q => GAL_CATS[q.sub] && diff(q));
    } else if (activeTheme === 'adm') {
      pool = QDB.filter(q => ADM_CATS[q.sub] && diff(q));
    } else {
      pool = QDB.filter(q => q.sub === 'cbip' && diff(q));
    }
  } else {
    // Sélection = cartes cochées du thème actif seulement
    pool = [];
    const sel = getActiveSelection();
    sel.forEach(key => {
      if (activeTheme === 'conseil' && CONSEIL_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'dermo' && DERMO_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'procedures' && PROC_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'bppo' && BPPO_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'ftm' && FTM_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'deon' && DEON_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'etudiant' && ETUDIANT_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'bapcoc' && BAPCOC_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'legislation' && LEG_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'galenique' && GAL_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'adm' && ADM_CATS[key]) {
        pool.push(...QDB.filter(q => q.sub===key && diff(q)));
      } else if (activeTheme === 'medicaments') {
        const type = CBIP_TYPES.find(t => t.key===key);
        if (type) pool.push(...QDB.filter(q => type.filter(q) && diff(q)));
      }
    });
    pool = [...new Map(pool.map(q => [q.q || q.consigne || Math.random(), q])).values()];
  }
  if (!pool.length) {
    // Afficher message d'erreur inline
    const grid = document.getElementById('cats-grid');
    const existing = document.getElementById('empty-warning');
    if (!existing && grid) {
      const warn = document.createElement('div');
      warn.id = 'empty-warning';
      warn.style.cssText = 'background:#FDEDEC;border:1.5px solid #E24B4A;border-radius:10px;padding:14px 18px;margin-bottom:16px;color:#C0392B;font-size:14px;font-weight:500;display:flex;align-items:center;gap:10px;';
      warn.innerHTML = '<span style="font-size:20px">⚠️</span> Veuillez sélectionner au moins un sous-thème avant de démarrer.';
      grid.parentNode.insertBefore(warn, grid);
      setTimeout(() => { if(warn.parentNode) warn.parentNode.removeChild(warn); }, 4000);
    }
    return;
  }
  quiz.questions = shuffle([...pool]);
  quiz.idx = 0; quiz.score = 0; quiz.answered = false; quiz.lastSub = mode; quiz.answeredCount = 0;
  show('quiz-view');
  renderQuestion();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderQuestion() {
  const q = quiz.questions[quiz.idx];
  const total = quiz.questions.length;
  quiz.answered = false;
  document.getElementById('q-counter').textContent = `Question ${quiz.idx+1}/${total}`;
  document.getElementById('progress-bar').style.width = `${(quiz.idx+1)/total*100}%`;
  document.getElementById('q-theme-badge').textContent = q.t || q.theme || '';
  document.getElementById('q-diff-badge').textContent = q.d === 'essentiel' ? '⭐ Essentiel' : q.d === 'approfondi' ? '🔬 Approfondi' : q.d === 'Expert' ? '🔬 Expert' : q.d === 'Intermédiaire' ? '⚡ Intermédiaire' : '⭐ Basique';
  document.getElementById('explanation').className = 'explanation';
  document.getElementById('explanation').innerHTML = '';
  document.getElementById('next-btn').style.display = 'none';
  var rb = document.getElementById('btn-report'); if(rb) rb.classList.remove('visible');

  const tq = q.type_question || 'qcm';

  if (tq === 'arbre_decisionnel') { if (q.flux) { renderFlux(q); } else { renderArbreDecisionnel(q); } return; }
  if (tq === 'relier') { renderRelier(q); return; }
  if (tq === 'flux')   { renderFlux(q);   return; }
  if (tq === 'cas_evolutif' && q.etapes) {
    document.getElementById('cas-progress').style.display = 'flex';
    document.getElementById('cas-etape-header').style.display = 'block';
    if (!q._etapeIdx) q._etapeIdx = 0;
    renderCasEvolutif(q);
    return;
  }
  // Masquer les éléments cas évolutif pour les autres formats
  document.getElementById('cas-progress').style.display = 'none';
  document.getElementById('cas-etape-header').style.display = 'none';

  // QCM standard (qcm, vrai_faux, trouver_erreur, detection_risque, cas_evolutif)
  document.getElementById('q-text').textContent = q.q;
  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';
  const letters = ['A','B','C','D'];
  const indices = shuffle([0,1,2,3].slice(0, q.a.length));
  q._shuffled = indices;
  indices.forEach((origIdx, pos) => {
    const btn = document.createElement('button');
    btn.className = 'ans-btn';
    const ansText = (q.type_question === 'vrai_faux')
      ? q.a[origIdx].replace(/ \| /g, '<br>')
      : q.a[origIdx];
    btn.innerHTML = `<span class="ans-letter">${letters[pos]}</span><span style="line-height:1.7">${ansText}</span>`;
    btn.onclick = () => answer(btn, origIdx, q);
    grid.appendChild(btn);
  });
}


// ── CAS ÉVOLUTIF (nouveau format avec etapes[]) ──────────────────────────────
function renderCasEvolutif(q) {
  // Initialiser l'état de progression sur la question
  if (!q._etapeIdx) q._etapeIdx = 0;
  const etapeIdx = q._etapeIdx;
  const etape = q.etapes[etapeIdx];
  const total = q.etapes.length;

  // Progress dots
  const progressEl = document.getElementById('cas-progress');
  if (progressEl) {
    progressEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'cas-progress-dot' +
        (i < etapeIdx ? ' done' : i === etapeIdx ? ' active' : '');
      progressEl.appendChild(dot);
    }
  }

  // Header étape
  const headerEl = document.getElementById('cas-etape-header');
  if (headerEl) {
    headerEl.textContent = `Étape ${etapeIdx+1} / ${total} — ${q.titre || q.module || ''}`;
    headerEl.style.display = 'block';
  }

  // Contexte
  document.getElementById('q-text').textContent = etape.situation + ' ' + etape.question;

  // Réponses
  const props = etape.propositions;
  const letters = ['A','B','C','D'];
  const a_arr = letters.map(l => props[l]);
  const r_idx = letters.indexOf(etape.bonne_reponse);

  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';
  const indices = shuffle([0,1,2,3]);
  q._shuffled_etape = indices;
  indices.forEach((origIdx, pos) => {
    const btn = document.createElement('button');
    btn.className = 'ans-btn';
    btn.innerHTML = `<span class="ans-letter">${letters[pos]}</span>${a_arr[origIdx]}`;
    btn.onclick = () => answerCasEvolutif(btn, origIdx, r_idx, q, etapeIdx, a_arr);
    grid.appendChild(btn);
  });

  quiz.answered = false;
}

function answerCasEvolutif(btn, origIdx, r_idx, q, etapeIdx, a_arr) {
  if (quiz.answered) return;
  quiz.answered = true;
  quiz.answeredCount++;
  const correct = origIdx === r_idx;
  if (correct) { quiz.score++; btn.classList.add('correct'); }
  else { btn.classList.add('wrong'); }
  // Sprint 4 : trace minimale pour l'historique (voir answer() ci-dessus).
  // Un cas evolutif comporte plusieurs etapes ; par simplicite, seule la
  // derniere etape rencontree est retenue comme reponse/correction globale
  // de la question pour l'historique (limite documentee dans RAPPORT_SPRINT4.md).
  q._evalAnswerGiven = 'Étape ' + (etapeIdx + 1) + (a_arr && a_arr[origIdx] ? ' : ' + a_arr[origIdx] : '');
  q._evalCorrect = correct;

  document.querySelectorAll('.ans-btn').forEach((b, pos) => {
    b.disabled = true;
    if (q._shuffled_etape[pos] === r_idx && !correct) b.classList.add('correct');
  });

  const etape = q.etapes[etapeIdx];
  const isLast = etapeIdx === q.etapes.length - 1;
  const expText = etape.explication +
    (isLast && q.point_pratique ? `|||💡 ${q.point_pratique}` : 
     etape.point_pratique_etape ? `|||💡 ${etape.point_pratique_etape}` : '');

  const exp = document.getElementById('explanation');
  const [main, tip] = expText.split('|||');
  let html = `<p>${main.trim()}</p>`;
  if (tip) {
    const tipText = tip.replace(/^💡\s*/, '');
    html += `<div class="tip-box"><span class="tip-icon">💡</span><span>${tipText}</span></div>`;
  }
  exp.innerHTML = html;
  exp.className = 'explanation show';

  const nextBtn = document.getElementById('next-btn');
  if (!isLast) {
    // Étape suivante du cas
    nextBtn.textContent = `Étape suivante →`;
    nextBtn.style.display = 'block';
    nextBtn.onclick = () => {
      q._etapeIdx = etapeIdx + 1;
      renderCasEvolutif(q);
      nextBtn.textContent = 'Question suivante';
      nextBtn.onclick = nextQuestion;
    };
  } else {
    // Fin du cas
    q._etapeIdx = 0; // reset pour une prochaine utilisation
    nextBtn.textContent = 'Question suivante';
    nextBtn.style.display = 'block';
    nextBtn.onclick = nextQuestion;
  }
}


// ── ARBRE DÉCISIONNEL ────────────────────────────────────────────────────────
function renderArbreDecisionnel(q) {
  var cp = document.getElementById('cas-progress'); if(cp) cp.style.display = 'none';
  var ch = document.getElementById('cas-etape-header'); if(ch) ch.style.display = 'none';

  const arbre = q.arbre;
  const isMissingQuestion = arbre.question_cle === '[ ? ]';
  const isMissingOui      = arbre.branche_oui  === '[ ? ]';
  const isMissingNon      = arbre.branche_non  === '[ ? ]';

  // Texte question
  document.getElementById('q-text').textContent = q.question;

  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';

  // ── Construire l'arbre visuel ──
  const wrap = document.createElement('div');
  wrap.className = 'arbre-wrap';

  // Situation
  const sit = document.createElement('div');
  sit.className = 'arbre-situation';
  sit.textContent = '🧑 ' + (q.situation || '');
  wrap.appendChild(sit);

  const tree = document.createElement('div');
  tree.className = 'arbre-tree';

  // Nœud racine
  const racineEl = document.createElement('div');
  racineEl.className = 'arbre-node racine';
  racineEl.textContent = arbre.racine;
  tree.appendChild(racineEl);

  // Connecteur vertical
  const v1 = document.createElement('div');
  v1.className = 'arbre-vline'; tree.appendChild(v1);

  // Nœud question clé
  const qkEl = document.createElement('div');
  qkEl.className = 'arbre-node question' + (isMissingQuestion ? ' missing' : '');
  qkEl.textContent = isMissingQuestion ? '? Question clé' : arbre.question_cle;
  tree.appendChild(qkEl);

  // Connecteur + branches OUI/NON
  const v2 = document.createElement('div');
  v2.className = 'arbre-vline'; tree.appendChild(v2);

  const branchesEl = document.createElement('div');
  branchesEl.className = 'arbre-branches';

  // Branche OUI
  const brOui = document.createElement('div');
  brOui.className = 'arbre-branch';
  const labelOui = document.createElement('div');
  labelOui.className = 'arbre-branch-label oui';
  labelOui.textContent = 'OUI';
  const nodeOui = document.createElement('div');
  const isAlerte = (arbre.branche_oui || '').toLowerCase().includes('médical') || (arbre.branche_oui || '').toLowerCase().includes('urgent');
  nodeOui.className = 'arbre-node decision' + (isAlerte && !isMissingOui ? ' alerte' : '') + (isMissingOui ? ' missing' : '');
  nodeOui.textContent = isMissingOui ? '?' : arbre.branche_oui;
  brOui.appendChild(labelOui);
  brOui.appendChild(nodeOui);

  // Branche NON
  const brNon = document.createElement('div');
  brNon.className = 'arbre-branch';
  const labelNon = document.createElement('div');
  labelNon.className = 'arbre-branch-label non';
  labelNon.textContent = 'NON';
  const nodeNon = document.createElement('div');
  const isAlerteNon = (arbre.branche_non || '').toLowerCase().includes('médical') || (arbre.branche_non || '').toLowerCase().includes('urgent');
  nodeNon.className = 'arbre-node decision' + (isAlerteNon && !isMissingNon ? ' alerte' : '') + (isMissingNon ? ' missing' : '');
  nodeNon.textContent = isMissingNon ? '?' : arbre.branche_non;
  brNon.appendChild(labelNon);
  brNon.appendChild(nodeNon);

  branchesEl.appendChild(brOui);
  branchesEl.appendChild(brNon);
  tree.appendChild(branchesEl);

  wrap.appendChild(tree);
  grid.appendChild(wrap);

  // ── Propositions QCM ──
  const letters = ['A','B','C','D'];
  const keys = Object.keys(q.propositions);
  const indices = shuffle([...Array(keys.length).keys()]);
  q._arbreShuffled = indices;
  indices.forEach((origIdx, pos) => {
    const key = keys[origIdx];
    const btn = document.createElement('button');
    btn.className = 'ans-btn';
    btn.innerHTML = `<span class="ans-letter">${letters[pos]}</span>${q.propositions[key]}`;
    btn.onclick = () => answerArbre(btn, key, q, nodeOui, nodeNon, qkEl);
    grid.appendChild(btn);
  });
}

function answerArbre(btn, key, q, nodeOui, nodeNon, qkEl) {
  if (quiz.answered) return;
  quiz.answered = true;
  quiz.answeredCount++;
  const correct = key === q.bonne_reponse;
  if (correct) { quiz.score++; btn.classList.add('correct'); }
  else { btn.classList.add('wrong'); }
  // Sprint 4 : trace minimale pour l'historique (voir answer() ci-dessus).
  q._evalAnswerGiven = key;
  q._evalCorrect = correct;

  // Révéler la bonne réponse dans les boutons
  document.querySelectorAll('.ans-btn').forEach((b, pos) => {
    b.disabled = true;
    const origIdx = q._arbreShuffled[pos];
    const k = Object.keys(q.propositions)[origIdx];
    if (k === q.bonne_reponse && !correct) b.classList.add('correct');
  });

  // Révéler la case manquante dans l'arbre
  const answer = q.propositions[q.bonne_reponse];
  const arbre = q.arbre;
  const revealClass = correct ? ' revealed-correct' : ' revealed-wrong';
  if (arbre.question_cle === '[ ? ]' && qkEl) {
    qkEl.textContent = answer;
    qkEl.className = 'arbre-node question' + revealClass;
  }
  if (arbre.branche_oui === '[ ? ]' && nodeOui) {
    nodeOui.textContent = answer;
    const isA = answer.toLowerCase().includes('médical') || answer.toLowerCase().includes('urgent');
    nodeOui.className = 'arbre-node decision' + (isA ? ' alerte' : '') + revealClass;
  }
  if (arbre.branche_non === '[ ? ]' && nodeNon) {
    nodeNon.textContent = answer;
    const isA = answer.toLowerCase().includes('médical') || answer.toLowerCase().includes('urgent');
    nodeNon.className = 'arbre-node decision' + (isA ? ' alerte' : '') + revealClass;
  }

  // Explication
  const expStr = q.explication || q.e || '';
  const pp = q.point_pratique || '';
  const exp = document.getElementById('explanation');
  exp.innerHTML = '<p>' + expStr + '</p>' +
    (pp ? `<div class="tip-box"><span class="tip-icon">💡</span><span>${pp}</span></div>` : '');
  exp.className = 'explanation show';

  stats.total++; if (correct) stats.correct++;
  if (currentProfile) localStorage.setItem('quiz_stats_' + currentProfile, JSON.stringify(stats));
  updateStatsDisplay();

  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'inline-flex';
  if (document.getElementById('btn-report')) document.getElementById('btn-report').classList.add('visible');
  if (quiz.idx >= quiz.questions.length - 1) {
    nextBtn.textContent = 'Voir les résultats';
    nextBtn.innerHTML += ' <i class="ti ti-trophy"></i>';
  }
}

// ── RELIER ────────────────────────────────────────────────────────────────────
function renderRelier(q) {
  var cp = document.getElementById('cas-progress'); if(cp) cp.style.display = 'none';
  var ch = document.getElementById('cas-etape-header'); if(ch) ch.style.display = 'none';
  document.getElementById('q-text').textContent = q.consigne || q.q || '';
  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';

  // État relier
  q._relierState = { selectedLeft: null, matched: {}, score: 0 };
  // Mélanger les éléments droite
  const droiteShuffled = shuffle([...q.droite]);
  q._droiteShuffled = droiteShuffled;

  const wrap = document.createElement('div');
  wrap.className = 'relier-wrap';

  // Colonne gauche
  const colG = document.createElement('div');
  colG.className = 'relier-col';
  colG.innerHTML = '<div class="relier-col-label">À associer</div>';
  q.gauche.forEach((txt, i) => {
    const el = document.createElement('div');
    el.className = 'relier-item';
    el.dataset.idx = i;
    el.dataset.side = 'left';
    el.textContent = txt;
    el.onclick = () => onRelierClick('left', i, q, el);
    colG.appendChild(el);
  });

  // Colonne droite
  const colD = document.createElement('div');
  colD.className = 'relier-col';
  colD.innerHTML = '<div class="relier-col-label">Correspondance</div>';
  droiteShuffled.forEach((txt, i) => {
    const el = document.createElement('div');
    el.className = 'relier-item';
    el.dataset.idx = i;
    el.dataset.side = 'right';
    el.textContent = txt;
    el.onclick = () => onRelierClick('right', i, q, el);
    colD.appendChild(el);
  });

  wrap.appendChild(colG);
  wrap.appendChild(colD);
  grid.appendChild(wrap);

  // Score
  const scoreEl = document.createElement('div');
  scoreEl.className = 'relier-score';
  scoreEl.id = 'relier-score';
  scoreEl.innerHTML = `Associations : <span>0/${q.gauche.length}</span>`;
  grid.appendChild(scoreEl);
}

function onRelierClick(side, idx, q, el) {
  if (quiz.answered) return;
  const state = q._relierState;

  if (side === 'left') {
    if (state.matched[idx] !== undefined) return; // déjà matché
    // Désélectionner ancien gauche
    document.querySelectorAll('.relier-item[data-side="left"]').forEach(e => e.classList.remove('selected-left'));
    state.selectedLeft = idx;
    el.classList.add('selected-left');
  } else {
    if (state.selectedLeft === null) return;
    // Vérifier si droite déjà utilisée
    const droiteTxt = q._droiteShuffled[idx];
    const alreadyUsed = Object.values(state.matched).includes(idx);
    if (alreadyUsed) return;

    // Vérifier correspondance
    const leftTxt = q.gauche[state.selectedLeft];
    const leftNum = String(state.selectedLeft + 1); // "1" à "4"
    const expected = q.correspondances[leftNum];
    const correct = droiteTxt === expected;

    // Marquer gauche
    const leftEls = document.querySelectorAll('.relier-item[data-side="left"]');
    leftEls[state.selectedLeft].classList.remove('selected-left');
    leftEls[state.selectedLeft].classList.add(correct ? 'matched-ok' : 'matched-wrong');
    leftEls[state.selectedLeft].classList.add('locked');

    // Marquer droite
    el.classList.add(correct ? 'matched-ok' : 'matched-wrong');
    el.classList.add('locked');

    // Si incorrect, révéler la bonne droite
    if (!correct) {
      const correctDroiteIdx = q._droiteShuffled.indexOf(expected);
      const droiteEls = document.querySelectorAll('.relier-item[data-side="right"]');
      if (correctDroiteIdx >= 0) {
        droiteEls[correctDroiteIdx].classList.add('correct-reveal');
      }
    }

    state.matched[state.selectedLeft] = idx;
    if (correct) state.score++;
    state.selectedLeft = null;

    // Mise à jour score
    const nb = Object.keys(state.matched).length;
    document.getElementById('relier-score').innerHTML =
      `Associations : <span>${state.score}/${q.gauche.length}</span>`;

    // Toutes les associations faites ?
    if (nb === q.gauche.length) {
      quiz.answered = true;
      quiz.answeredCount++;
      const allCorrect = state.score === q.gauche.length;
      if (allCorrect) quiz.score++;
      // Sprint 4 : trace minimale pour l'historique (voir answer() ci-dessus).
      q._evalAnswerGiven = state.score + '/' + q.gauche.length + ' associations correctes';
      q._evalCorrect = allCorrect;

      // Stats
      stats.total++; if (allCorrect) stats.correct++;
      if (currentProfile) localStorage.setItem('quiz_stats_' + currentProfile, JSON.stringify(stats));
      updateStatsDisplay();

      // Explication
      showRelierExplication(q, allCorrect);
      document.getElementById('next-btn').style.display = 'inline-flex';
      if (document.getElementById('btn-report')) document.getElementById('btn-report').classList.add('visible');
      if (quiz.idx >= quiz.questions.length - 1) {
        document.getElementById('next-btn').textContent = 'Voir les résultats';
        document.getElementById('next-btn').innerHTML += ' <i class="ti ti-trophy"></i>';
      }
    }
  }
}

function showRelierExplication(q, allCorrect) {
  const exp = document.getElementById('explanation');
  const rawExp = q.explication || q.e || '';
  let mainText, pp;
  if (rawExp.includes('|||')) {
    const parts = rawExp.split('|||');
    mainText = parts[0];
    pp = parts[1] ? parts[1].replace('💡 ', '').trim() : '';
  } else {
    mainText = rawExp;
    pp = q.point_pratique ? q.point_pratique.replace('💡 ', '').trim() : '';
  }
  exp.innerHTML = '<strong>' + (allCorrect ? '✓ Parfait !' : `✗ ${q._relierState.score}/${q.gauche.length} associations correctes`) + ' :</strong> ' + mainText +
    (pp ? `<span class="point-pratique">💡 ${pp}</span>` : '');
  exp.className = 'explanation show';
}

// ── FLUX ─────────────────────────────────────────────────────────────────────
function renderFlux(q) {
  var cp = document.getElementById('cas-progress'); if(cp) cp.style.display = 'none';
  var ch = document.getElementById('cas-etape-header'); if(ch) ch.style.display = 'none';
  document.getElementById('q-text').textContent = q.consigne || q.q || '';
  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';

  // Visualisation du flux
  const fluxWrap = document.createElement('div');
  fluxWrap.className = 'flux-wrap';
  const stepsEl = document.createElement('div');
  stepsEl.className = 'flux-steps';

  q.flux.forEach((step, i) => {
    const isMissing = step === '[ ? ]';
    const stepEl = document.createElement('div');
    stepEl.className = 'flux-step';

    const connector = document.createElement('div');
    connector.className = 'flux-connector';

    const dot = document.createElement('div');
    dot.className = 'flux-dot' + (isMissing ? ' question-mark' : '');
    dot.textContent = isMissing ? '?' : i + 1;
    connector.appendChild(dot);

    if (i < q.flux.length - 1) {
      const line = document.createElement('div');
      line.className = 'flux-line';
      connector.appendChild(line);
    }

    const textEl = document.createElement('div');
    textEl.className = 'flux-text' + (isMissing ? ' missing' : '');
    textEl.innerHTML = isMissing ? '<strong>Étape manquante — laquelle ?</strong>' : step;

    stepEl.appendChild(connector);
    stepEl.appendChild(textEl);
    stepsEl.appendChild(stepEl);
  });

  fluxWrap.appendChild(stepsEl);
  grid.appendChild(fluxWrap);

  // Propositions QCM
  const letters = ['A','B','C','D'];
  const propKeys = Object.keys(q.propositions);
  const indices = shuffle([...Array(propKeys.length).keys()]);
  q._fluxShuffled = indices;

  indices.forEach((origIdx, pos) => {
    const key = propKeys[origIdx];
    const btn = document.createElement('button');
    btn.className = 'ans-btn';
    btn.innerHTML = `<span class="ans-letter">${letters[pos]}</span>${q.propositions[key]}`;
    btn.onclick = () => answerFlux(btn, key, q);
    grid.appendChild(btn);
  });
}

function answerFlux(btn, key, q) {
  if (quiz.answered) return;
  quiz.answered = true;
  quiz.answeredCount++;
  const correct = key === q.bonne_reponse;
  if (correct) { quiz.score++; btn.classList.add('correct'); }
  else { btn.classList.add('wrong'); }
  // Sprint 4 : trace minimale pour l'historique (voir answer() ci-dessus).
  q._evalAnswerGiven = key;
  q._evalCorrect = correct;

  // Révéler la bonne réponse
  document.querySelectorAll('.ans-btn').forEach((b, pos) => {
    b.disabled = true;
    const origIdx = q._fluxShuffled[pos];
    const k = Object.keys(q.propositions)[origIdx];
    if (k === q.bonne_reponse && !correct) b.classList.add('correct');
  });

  // Mettre à jour le flux pour montrer la bonne étape
  const stepsEls = document.querySelectorAll('.flux-step');
  q.flux.forEach((step, i) => {
    if (step === '[ ? ]' && stepsEls[i]) {
      const dot = stepsEls[i].querySelector('.flux-dot');
      const textEl = stepsEls[i].querySelector('.flux-text');
      if (dot) { dot.className = 'flux-dot active'; dot.textContent = i + 1; }
      if (textEl) {
        textEl.className = 'flux-text';
        textEl.innerHTML = q.propositions[q.bonne_reponse];
      }
    }
  });

  const exp = document.getElementById('explanation');
  const expStr = q.e || q.explication || '';
  const parts = expStr.split('|||');
  const mainText = parts[0];
  const pp = parts[1] ? parts[1].replace('💡 ', '').trim() : '';
  exp.innerHTML = '<strong>' + (correct ? '✓ Bonne réponse' : '✗ Incorrect') + ' :</strong> ' + mainText +
    (pp ? `<span class="point-pratique">💡 ${pp}</span>` : '');
  exp.className = 'explanation show';

  stats.total++; if (correct) stats.correct++;
  if (currentProfile) localStorage.setItem('quiz_stats_' + currentProfile, JSON.stringify(stats));
  updateStatsDisplay();

  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'inline-flex';
  if (document.getElementById('btn-report')) document.getElementById('btn-report').classList.add('visible');
  if (quiz.idx >= quiz.questions.length - 1) {
    nextBtn.textContent = 'Voir les résultats';
    nextBtn.innerHTML += ' <i class="ti ti-trophy"></i>';
  }
}

function answer(btn, origIdx, q) {
  if (quiz.answered) return;
  quiz.answered = true;
  quiz.answeredCount++;
  const correct = origIdx === q.r;
  if (correct) { quiz.score++; btn.classList.add('correct'); }
  else { btn.classList.add('wrong'); }
  // Sprint 4 : trace minimale de la reponse donnee, utilisee uniquement par
  // js/services/evaluation-service.js pour construire l'historique. N'affecte
  // ni le score ni l'affichage existants.
  q._evalAnswerGiven = q.a[origIdx];
  q._evalCorrect = correct;

  // Highlight correct answer
  document.querySelectorAll('.ans-btn').forEach((b, pos) => {
    b.disabled = true;
    if (q._shuffled[pos] === q.r && !correct) b.classList.add('correct');
  });

  // Explanation
  const exp = document.getElementById('explanation');
  const parts = (q.e || q.explication || '').split('|||💡 Point pratique :');
  const mainText = parts[0];
  const pointPratique = parts[1] ? parts[1].trim() : '';
  exp.innerHTML = '<strong>' + (correct ? '✓ Bonne réponse' : '✗ Incorrect') + ' :</strong> ' + mainText +
    (pointPratique ? '<span class="point-pratique">💡 Point pratique : ' + pointPratique + '</span>' : '');
  exp.className = 'explanation show';

  // Fiche images gallery (FP procedures)
  if (q.fiche && typeof FICHE_IMGS !== 'undefined') {
    exp.innerHTML += buildFicheImgGallery(q.fiche);
  }
  // Procedure images (new procedures)
  if (q.img_id && typeof PROC2_IMGS !== 'undefined' && PROC2_IMGS[q.img_id]) {
    exp.innerHTML += buildProc2ImgGallery(q.img_id);
  }

  // Stats
  stats.total++;
  if (correct) stats.correct++;
  if (currentProfile) localStorage.setItem('quiz_stats_' + currentProfile, JSON.stringify(stats));
  updateStatsDisplay();

  // Next button
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'inline-flex';
  const rBtn = document.getElementById('btn-report'); if (rBtn) rBtn.classList.add('visible');
  if (quiz.idx >= quiz.questions.length - 1) {
    nextBtn.textContent = 'Voir les résultats';
    nextBtn.innerHTML += ' <i class="ti ti-trophy"></i>';
  }
}

function nextQuestion() {
  quiz.idx++;
  if (quiz.idx >= quiz.questions.length) { showResults(); return; }
  renderQuestion();
}

function showResults() {
  show('results-view');
  const pct = Math.round(quiz.score / quiz.questions.length * 100);
  document.getElementById('res-pct').textContent = pct + '%';
  document.getElementById('res-frac').textContent = `${quiz.score}/${quiz.questions.length}`;
  const msg = pct >= 80 ? '🎉 Excellent !' : pct >= 60 ? '👍 Bien !' : pct >= 40 ? '📚 À revoir' : '💪 Continue !';
  document.getElementById('res-msg').textContent = msg;
  document.getElementById('res-detail').textContent =
    `${quiz.score} bonne${quiz.score>1?'s':''} réponse${quiz.score>1?'s':''} sur ${quiz.questions.length} questions`;

  // Sprint 4 — synchronisation Firestore (voir js/services/evaluation-service.js).
  // Le score est deja affiche ci-dessus avant cet appel : un echec de
  // synchronisation ne peut donc jamais empecher l'utilisateur de voir son
  // resultat. Appel defensif (verifie l'existence de la fonction) pour ne
  // jamais faire echouer showResults() si le service n'est pas charge.
  var syncStatusEl = document.getElementById('res-sync-status');
  if (syncStatusEl) syncStatusEl.textContent = '';
  if (window.PharmevalEvaluationSync && typeof window.PharmevalEvaluationSync.recordCompletedEvaluation === 'function') {
    window.PharmevalEvaluationSync.recordCompletedEvaluation({
      questions: quiz.questions,
      score: quiz.score,
      totalQuestions: quiz.questions.length,
      profile: currentProfile,
      theme: activeTheme,
      difficulty: selectedDiff,
    }).then(function(status) {
      if (!syncStatusEl) return;
      syncStatusEl.textContent = (status === 'synced')
        ? '✓ Résultat sauvegardé'
        : '✓ Résultat sauvegardé localement — synchronisation en attente';
    }).catch(function() {
      if (syncStatusEl) syncStatusEl.textContent = '✓ Résultat sauvegardé localement — synchronisation en attente';
    });
  }
}

function goHome() {
  show('home-view');
  renderCats();
  updateStatsDisplay();
}

// ── FICHE IMAGES GALLERY ────────────────────────────────────────────────────
function buildFicheImgGallery(ficheCode) {
  if (!ficheCode || !FICHE_IMGS[ficheCode] || !FICHE_IMGS[ficheCode].length) return '';
  const imgs = FICHE_IMGS[ficheCode];
  let h = '<div class="fiche-gallery"><div class="fiche-gallery-title">📸 Captures d\'écran</div><div class="fiche-gallery-grid">';
  imgs.forEach(function(img, i) {
    const safeCtx = (img.ctx||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    h += '<div class="fiche-img-wrap">';
    if (img.ctx) h += '<div class="fiche-img-ctx">' + img.ctx + '</div>';
    h += '<img src="' + img.src + '" class="fiche-img fiche-zoom" loading="lazy" data-ctx="' + safeCtx + '" alt="Capture ' + (i+1) + '">';
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}
function buildProc2ImgGallery(imgId) {
  if (!imgId || !PROC2_IMGS[imgId] || !PROC2_IMGS[imgId].length) return '';
  const imgs = PROC2_IMGS[imgId];
  let h = '<div class="fiche-gallery"><div class="fiche-gallery-title">📸 Captures d\'écran</div><div class="fiche-gallery-grid">';
  imgs.forEach(function(img, i) {
    const safeCtx = (img.ctx||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    h += '<div class="fiche-img-wrap">';
    if (img.ctx) h += '<div class="fiche-img-ctx">' + img.ctx + '</div>';
    h += '<img src="' + img.src + '" class="fiche-img fiche-zoom" loading="lazy" data-ctx="' + safeCtx + '" alt="Capture ' + (i+1) + '">';
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}


// ── IMAGE ZOOM MODAL ─────────────────────────────────────────────────────────
function openFicheImgModal(src, ctx) {
  var m = document.getElementById('fim-overlay');
  if (!m) return;
  document.getElementById('fim-img').src = src;
  document.getElementById('fim-ctx').textContent = ctx || '';
  m.style.display = 'flex';
}
function closeFicheImgModal() {
  var m = document.getElementById('fim-overlay');
  if (m) { m.style.display = 'none'; document.getElementById('fim-img').src = ''; }
}
document.addEventListener('click', function(e) {
  var t = e.target;
  if (t && t.classList && t.classList.contains('fiche-zoom')) {
    openFicheImgModal(t.src, t.getAttribute('data-ctx') || '');
  }
});

// ── REPORT SYSTEM ────────────────────────────────────────────────────────────
var _reportState = { qText: '', qIdx: -1, reason: '', note: '' };

function openReportModal() {
  var q = quiz.questions[quiz.idx];
  _reportState.qText = q.q;
  _reportState.qIdx = quiz.idx;
  _reportState.reason = '';
  _reportState.note = '';
  document.querySelectorAll('.report-option').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('report-textarea').value = '';
  document.getElementById('report-textarea').classList.remove('visible');
  document.getElementById('btn-report-send').classList.remove('enabled');
  document.getElementById('report-success').classList.remove('visible');
  document.getElementById('report-actions').style.display = 'flex';
  document.getElementById('report-options').style.display = 'flex';
  var preview = q.q.length > 80 ? q.q.substring(0, 80) + '\u2026' : q.q;
  document.getElementById('report-q-preview').textContent = preview;
  document.getElementById('report-overlay').classList.add('active');
}

function closeReportModal(e) {
  if (e && e.target !== document.getElementById('report-overlay')) return;
  document.getElementById('report-overlay').classList.remove('active');
}

function selectReportOption(btn, reason) {
  document.querySelectorAll('.report-option').forEach(function(b) { b.classList.remove('selected'); });
  btn.classList.add('selected');
  _reportState.reason = reason;
  var ta = document.getElementById('report-textarea');
  if (reason === 'other') {
    ta.classList.add('visible');
    ta.focus();
    document.getElementById('btn-report-send').classList.remove('enabled');
  } else {
    ta.classList.remove('visible');
    document.getElementById('btn-report-send').classList.add('enabled');
  }
}

function onReportTextInput() {
  var val = document.getElementById('report-textarea').value.trim();
  _reportState.note = val;
  var sendBtn = document.getElementById('btn-report-send');
  if (_reportState.reason === 'other' && val.length > 3) {
    sendBtn.classList.add('enabled');
  } else if (_reportState.reason !== 'other') {
    sendBtn.classList.add('enabled');
  }
}

function submitReport() {
  if (!_reportState.reason) return;
  var q = quiz.questions[_reportState.qIdx];
  var reportsKey = 'quiz_reports_' + (currentProfile || 'unknown');
  var reports = JSON.parse(localStorage.getItem(reportsKey) || '[]');
  var note = document.getElementById('report-textarea').value.trim();
  reports.push({
    date: new Date().toISOString(),
    profile: currentProfile || 'unknown',
    reason: _reportState.reason,
    note: note,
    question: q.q,
    sub: q.sub || '',
    theme: q.t || '',
    diff: q.d || ''
  });
  localStorage.setItem(reportsKey, JSON.stringify(reports));
  document.getElementById('report-options').style.display = 'none';
  document.getElementById('report-textarea').classList.remove('visible');
  document.getElementById('report-actions').style.display = 'none';
  document.getElementById('report-success').classList.add('visible');
  setTimeout(function() {
    document.getElementById('report-overlay').classList.remove('active');
  }, 2000);
}

// ===================== PROFILS (Etudiant / Pharmacien) =====================
// Table de configuration unique : quels themes sont visibles par profil.
// -> Toute nouvelle offre de theme doit seulement etre ajoutee ici, pas
//    dispersee dans le reste du moteur.
const THEME_CONFIG = {
  student: {
    // Deontologie et BAPCOC retires du profil Etudiant (v1.0.1) : ils restent
    // uniquement accessibles au profil Pharmacien (voir ci-dessous).
    themes: ['etudiant', 'legislation', 'galenique', 'adm'],
    defaultTheme: 'etudiant',
    label: 'Etudiant'
  },
  pharmacist: {
    themes: ['conseil', 'dermo', 'procedures', 'medicaments', 'bppo', 'ftm', 'deon', 'bapcoc', 'etudiant'],
    defaultTheme: 'conseil',
    label: 'Pharmacien'
  }
};

function themeOfQuestion(q) {
  if (!q) return null;
  if (q.sub === 'cbip') return 'medicaments';
  var cat = CATS[q.sub];
  return cat ? cat.theme : null;
}

function isThemeAllowed(theme, profile) {
  var cfg = THEME_CONFIG[profile];
  return !!(cfg && cfg.themes.indexOf(theme) !== -1);
}

function applyProfileVisibility(profile) {
  var cfg = THEME_CONFIG[profile];
  if (!cfg) return;
  // Show/hide individual tabs based on their theme (derived from id="tab-XXX")
  document.querySelectorAll('.theme-tab').forEach(function(tabEl) {
    var theme = tabEl.id.replace('tab-', '');
    var allowed = cfg.themes.indexOf(theme) !== -1;
    tabEl.style.display = allowed ? '' : 'none';
  });
  // Hide a whole theme-group if none of its tabs remain visible
  document.querySelectorAll('.theme-group').forEach(function(groupEl) {
    var tabs = groupEl.querySelectorAll('.theme-tab');
    var anyVisible = false;
    tabs.forEach(function(t) { if (t.style.display !== 'none') anyVisible = true; });
    groupEl.style.display = anyVisible ? '' : 'none';
  });
  // Le groupe qui contient "Pharmacotherapie" est partage entre les deux
  // profils (un seul noeud DOM, une seule banque ETUDIANT_QDB) : seul son
  // libelle change selon le profil actif.
  var coursIconEl = document.getElementById('cours-group-icon');
  var coursNameEl = document.getElementById('cours-group-name');
  if (profile === 'pharmacist') {
    if (coursIconEl) coursIconEl.textContent = '🎓';
    if (coursNameEl) coursNameEl.textContent = 'Étudiant';
  } else {
    if (coursIconEl) coursIconEl.textContent = '📘';
    if (coursNameEl) coursNameEl.textContent = 'Cours';
  }
}

function updateHeaderCount() {
  if (!currentProfile) return;
  var cfg = THEME_CONFIG[currentProfile];
  if (!cfg) return;
  var count = QDB.filter(function(q) {
    var theme = themeOfQuestion(q);
    return theme && cfg.themes.indexOf(theme) !== -1;
  }).length;
  var el = document.getElementById('stat-bank-total');
  if (el) el.textContent = count;
  var profileBadge = document.getElementById('active-profile-badge');
  if (profileBadge) profileBadge.textContent = cfg.label;
}

function selectProfile(profile) {
  if (!THEME_CONFIG[profile]) return;
  currentProfile = profile;

  // Charger les stats et signalements propres a ce profil (jamais partages)
  stats = JSON.parse(localStorage.getItem('quiz_stats_' + profile) || '{"total":0,"correct":0}');

  applyProfileVisibility(profile);

  var cfg = THEME_CONFIG[profile];
  activeTheme = cfg.defaultTheme;

  var selector = document.getElementById('profile-selector');
  if (selector) selector.style.display = 'none';

  show('home-view');
  setTheme(activeTheme);
  updateStatsDisplay();
  updateHeaderCount();
}

// ===================== CHANGER D'ESPACE =====================
// Retour a l'ecran "Choisir votre espace". Les statistiques localStorage sont
// deja isolees par profil (quiz_stats_student / quiz_stats_pharmacist) et ne
// sont jamais effacees ici : on se contente de reinitialiser l'etat de session
// (theme actif, selections de categories, quiz en cours) avant de revenir au
// selecteur.
function isQuizInProgressWithAnswer() {
  var quizViewEl = document.getElementById('quiz-view');
  var quizVisible = !!(quizViewEl && quizViewEl.style.display === 'block');
  return quizVisible && quiz && quiz.answeredCount > 0;
}

function resetSessionState() {
  // Vide toutes les selections de sous-themes (tous profils confondus).
  selectedConseil = new Set();
  selectedMed = new Set();
  selectedDermo = new Set();
  selectedProc = new Set();
  selectedBppo = new Set();
  selectedFtm = new Set();
  selectedDeon = new Set();
  selectedEtudiant = new Set();
  selectedBapcoc = new Set();
  selectedLeg = new Set();
  selectedGal = new Set();
  selectedAdm = new Set();
  selectedDiff = 'all';
  document.querySelectorAll('.diff-btn').forEach(function(b) { b.classList.remove('active'); });
  var diffAllEl = document.getElementById('diff-all');
  if (diffAllEl) diffAllEl.classList.add('active');

  quiz = { questions: [], idx: 0, score: 0, answered: false, lastSub: 'all', answeredCount: 0 };
  activeTheme = null;
}

function goToProfileSelector() {
  resetSessionState();
  currentProfile = null;

  ['home-view', 'quiz-view', 'results-view'].forEach(function(v) {
    var el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });

  var selector = document.getElementById('profile-selector');
  if (selector) selector.style.display = 'flex';
}

function changeSpace() {
  if (isQuizInProgressWithAnswer()) {
    var ok = confirm(
      "Un quiz est en cours et vous avez deja repondu a au moins une question.\n\n" +
      "Changer d'espace maintenant interrompra ce quiz (la progression de CE quiz sera perdue).\n" +
      "Vos statistiques globales et vos signalements restent conserves separement pour chaque profil.\n\n" +
      "Continuer ?"
    );
    if (!ok) return;
  }
  goToProfileSelector();
}

// ===================== INIT =====================
// Le rendu reel (renderCats / updateStatsDisplay / comptage) demarre
// uniquement apres le choix explicite d'un profil via selectProfile().

// Sprint 5 : expose la banque de questions deja chargee en memoire, pour que
// js/services/history-service.js (module ES, sans acces aux variables
// globales de ce script classique) puisse retrouver l'enonce et la bonne
// reponse d'une question a partir de son questionId - uniquement lorsque
// l'utilisateur ouvre le detail d'une evaluation dans "Mes evaluations",
// jamais pour la liste des cartes. Ne modifie ni QDB ni son contenu.
if (typeof window !== 'undefined') {
  window.PharmevalQDB = QDB;
}



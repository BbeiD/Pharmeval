// ===================== ASSISTANT DE PREMIERE CONNEXION =====================
// Affiche, uniquement lorsque profileCompleted === false, un assistant en
// 4 etapes (bienvenue, profession, organisation, conditions d'utilisation),
// puis enregistre les reponses via js/services/user-service.js et revele
// l'application.
//
// Ce fichier ne contient aucune logique Firebase directe : il delegue toute
// lecture/ecriture Firestore a js/services/user-service.js, et ne s'occupe
// que de la presentation et de la navigation entre etapes.

import { saveOnboardingProfile, PROFESSION_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "./services/user-service.js";
import { revealApp } from "./auth.js";

const TOTAL_STEPS = 4;

let currentUser = null;
let currentStep = 1;
let wizardData = {
  profession: '',
  professionOther: '',
  organizationType: '',
  organizationOther: '',
  organizationName: '',
  acceptedTerms: false,
};

/**
 * Point d'entree appele par js/auth.js juste apres une connexion reussie,
 * lorsque le document utilisateur Firestore indique profileCompleted=false.
 */
export function startOnboarding(user) {
  currentUser = user;
  currentStep = 1;
  wizardData = {
    profession: '',
    professionOther: '',
    organizationType: '',
    organizationOther: '',
    organizationName: '',
    acceptedTerms: false,
  };
  var screen = document.getElementById('onboarding-screen');
  if (!screen) return;
  screen.style.display = 'flex';
  renderStep();
}

function renderStep() {
  var body = document.getElementById('onboarding-body');
  var dots = document.getElementById('onboarding-dots');
  if (!body) return;

  var errEl = document.getElementById('onboarding-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (dots) {
    var dotsHtml = '';
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      dotsHtml += '<span class="onboarding-dot' + (i === currentStep ? ' active' : '') + '"></span>';
    }
    dots.innerHTML = dotsHtml;
  }

  if (currentStep === 1) body.innerHTML = renderStepWelcome();
  else if (currentStep === 2) body.innerHTML = renderStepProfession();
  else if (currentStep === 3) body.innerHTML = renderStepOrganization();
  else if (currentStep === 4) body.innerHTML = renderStepTerms();

  attachStepListeners();
}

// --- Etape 1 : bienvenue ---------------------------------------------------
function renderStepWelcome() {
  return (
    '<h2>Bienvenue dans Pharmeval</h2>' +
    '<p class="onboarding-intro">Avant de commencer, nous avons besoin de quelques informations ' +
    'pour personnaliser votre expérience. Cela ne prend qu\'une minute.</p>' +
    '<div class="onboarding-actions">' +
    '<button class="onboarding-btn-primary" id="ob-next-1">Commencer</button>' +
    '</div>'
  );
}

// --- Etape 2 : profession ---------------------------------------------------
function renderStepProfession() {
  var choices = PROFESSION_OPTIONS.map(function(opt) {
    var selected = wizardData.profession === opt.value ? ' selected' : '';
    return '<button type="button" class="onboarding-choice' + selected + '" data-value="' + opt.value + '">' + opt.label + '</button>';
  }).join('');

  var otherFieldVisible = wizardData.profession === 'other';

  return (
    '<h2>Quelle est votre profession ?</h2>' +
    '<div class="onboarding-choices" id="ob-profession-choices">' + choices + '</div>' +
    '<div class="onboarding-field" id="ob-profession-other-wrap" style="display:' + (otherFieldVisible ? 'block' : 'none') + ';">' +
    '<label for="ob-profession-other">Précisez</label>' +
    '<input type="text" id="ob-profession-other" placeholder="Votre profession" value="' + escapeHtml(wizardData.professionOther) + '">' +
    '</div>' +
    '<div class="onboarding-actions">' +
    '<button class="onboarding-btn-secondary" id="ob-back-2">Retour</button>' +
    '<button class="onboarding-btn-primary" id="ob-next-2">Continuer</button>' +
    '</div>'
  );
}

// --- Etape 3 : organisation --------------------------------------------------
function renderStepOrganization() {
  var choices = ORGANIZATION_TYPE_OPTIONS.map(function(opt) {
    var selected = wizardData.organizationType === opt.value ? ' selected' : '';
    return '<button type="button" class="onboarding-choice' + selected + '" data-value="' + opt.value + '">' + opt.label + '</button>';
  }).join('');

  var otherFieldVisible = wizardData.organizationType === 'other';

  return (
    '<h2>Votre organisation</h2>' +
    '<div class="onboarding-field-label">Type d\'organisation</div>' +
    '<div class="onboarding-choices" id="ob-org-choices">' + choices + '</div>' +
    '<div class="onboarding-field" id="ob-org-other-wrap" style="display:' + (otherFieldVisible ? 'block' : 'none') + ';">' +
    '<label for="ob-org-other">Précisez</label>' +
    '<input type="text" id="ob-org-other" placeholder="Type d\'organisation" value="' + escapeHtml(wizardData.organizationOther) + '">' +
    '</div>' +
    '<div class="onboarding-field">' +
    '<label for="ob-org-name">Nom de l\'organisation</label>' +
    '<input type="text" id="ob-org-name" placeholder="Ex. Université de Liège, Pharmacie du Centre..." value="' + escapeHtml(wizardData.organizationName) + '">' +
    '</div>' +
    '<div class="onboarding-actions">' +
    '<button class="onboarding-btn-secondary" id="ob-back-3">Retour</button>' +
    '<button class="onboarding-btn-primary" id="ob-next-3">Continuer</button>' +
    '</div>'
  );
}

// --- Etape 4 : conditions d'utilisation -------------------------------------
function renderStepTerms() {
  return (
    '<h2>Dernière étape</h2>' +
    '<label class="onboarding-checkbox-row" for="ob-terms">' +
    '<input type="checkbox" id="ob-terms"' + (wizardData.acceptedTerms ? ' checked' : '') + '>' +
    '<span>J\'accepte les conditions d\'utilisation de Pharmeval.</span>' +
    '</label>' +
    '<div class="onboarding-actions">' +
    '<button class="onboarding-btn-secondary" id="ob-back-4">Retour</button>' +
    '<button class="onboarding-btn-primary" id="ob-validate" disabled>Valider et accéder à Pharmeval</button>' +
    '</div>'
  );
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function showOnboardingError(message) {
  var el = document.getElementById('onboarding-error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

// --- Navigation et validation par etape -------------------------------------
function attachStepListeners() {
  if (currentStep === 1) {
    var next1 = document.getElementById('ob-next-1');
    if (next1) next1.onclick = function() { currentStep = 2; renderStep(); };
    return;
  }

  if (currentStep === 2) {
    document.querySelectorAll('#ob-profession-choices .onboarding-choice').forEach(function(btn) {
      btn.onclick = function() {
        wizardData.profession = btn.getAttribute('data-value');
        renderStep();
      };
    });
    var otherInput2 = document.getElementById('ob-profession-other');
    if (otherInput2) otherInput2.oninput = function() { wizardData.professionOther = otherInput2.value; };
    var back2 = document.getElementById('ob-back-2');
    if (back2) back2.onclick = function() { currentStep = 1; renderStep(); };
    var next2 = document.getElementById('ob-next-2');
    if (next2) next2.onclick = function() {
      if (!wizardData.profession) {
        showOnboardingError('Veuillez sélectionner une profession.');
        return;
      }
      if (wizardData.profession === 'other' && !wizardData.professionOther.trim()) {
        showOnboardingError('Veuillez préciser votre profession.');
        return;
      }
      currentStep = 3;
      renderStep();
    };
    return;
  }

  if (currentStep === 3) {
    document.querySelectorAll('#ob-org-choices .onboarding-choice').forEach(function(btn) {
      btn.onclick = function() {
        wizardData.organizationType = btn.getAttribute('data-value');
        renderStep();
      };
    });
    var otherInput3 = document.getElementById('ob-org-other');
    if (otherInput3) otherInput3.oninput = function() { wizardData.organizationOther = otherInput3.value; };
    var nameInput3 = document.getElementById('ob-org-name');
    if (nameInput3) nameInput3.oninput = function() { wizardData.organizationName = nameInput3.value; };
    var back3 = document.getElementById('ob-back-3');
    if (back3) back3.onclick = function() { currentStep = 2; renderStep(); };
    var next3 = document.getElementById('ob-next-3');
    if (next3) next3.onclick = function() {
      if (!wizardData.organizationType) {
        showOnboardingError('Veuillez sélectionner un type d\'organisation.');
        return;
      }
      if (wizardData.organizationType === 'other' && !wizardData.organizationOther.trim()) {
        showOnboardingError('Veuillez préciser le type d\'organisation.');
        return;
      }
      if (!wizardData.organizationName.trim()) {
        showOnboardingError('Veuillez indiquer le nom de l\'organisation.');
        return;
      }
      currentStep = 4;
      renderStep();
    };
    return;
  }

  if (currentStep === 4) {
    var checkbox = document.getElementById('ob-terms');
    var validateBtn = document.getElementById('ob-validate');
    if (checkbox && validateBtn) {
      checkbox.onchange = function() {
        wizardData.acceptedTerms = checkbox.checked;
        validateBtn.disabled = !checkbox.checked;
      };
      validateBtn.disabled = !checkbox.checked;
    }
    var back4 = document.getElementById('ob-back-4');
    if (back4) back4.onclick = function() { currentStep = 3; renderStep(); };
    if (validateBtn) validateBtn.onclick = function() { finishOnboarding(); };
    return;
  }
}

async function finishOnboarding() {
  var validateBtn = document.getElementById('ob-validate');
  if (validateBtn) validateBtn.disabled = true;
  try {
    await saveOnboardingProfile(currentUser.uid, {
      profession: wizardData.profession,
      professionOther: wizardData.professionOther,
      organizationType: wizardData.organizationType,
      organizationOther: wizardData.organizationOther,
      organizationName: wizardData.organizationName,
    });
    revealApp(currentUser);
  } catch (err) {
    console.error('Erreur lors de l\'enregistrement du profil :', err);
    showOnboardingError("Une erreur est survenue lors de l'enregistrement. Veuillez réessayer.");
    if (validateBtn) validateBtn.disabled = false;
  }
}

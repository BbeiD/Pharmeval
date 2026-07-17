// ===================== SERVICE UTILISATEUR (FIRESTORE) =====================
// Toute la logique metier liee au document utilisateur Firestore vit ici,
// separee de l'authentification (js/auth.js) et de l'assistant de premiere
// connexion (js/onboarding.js), qui ne fait qu'appeler ce service.
//
// Convention d'architecture (Sprint 2) : chaque domaine metier Firebase aura
// son propre fichier dans js/services/ (ex. evaluation-service.js,
// statistics-service.js, campaign-service.js dans les sprints suivants),
// afin que js/app.js ne porte que la logique du moteur de quiz existant.
//
// Perimetre strict de ce sprint : uniquement la creation/mise a jour du
// document utilisateur et l'enregistrement du profil de premiere connexion.
// Aucune donnee d'evaluation, de statistique ou de campagne n'est traitee ici.

import { db } from "../firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ---------------------------------------------------------------------------
// Listes de reference partagees entre le service et l'assistant de premiere
// connexion (js/onboarding.js), pour eviter toute duplication et faciliter
// l'ajout futur d'options (voir "Evolutivite" dans RAPPORT_SPRINT2.md).
// ---------------------------------------------------------------------------
export const PROFESSION_OPTIONS = [
  { value: 'student', label: 'Étudiant' },
  { value: 'pharmacist', label: 'Pharmacien' },
  { value: 'pharmacy_technician', label: 'Assistant pharmaceutico-technique' },
  { value: 'teacher', label: 'Professeur / Formateur' },
  { value: 'other', label: 'Autre' },
];

export const ORGANIZATION_TYPE_OPTIONS = [
  { value: 'university', label: 'Université' },
  { value: 'university_college', label: 'Haute école' },
  { value: 'company', label: 'Société' },
  { value: 'hospital', label: 'Hôpital' },
  { value: 'pharmacy', label: 'Officine' },
  { value: 'administration', label: 'Administration' },
  { value: 'association', label: 'Association' },
  { value: 'other', label: 'Autre' },
];

// Structure par defaut d'un nouveau document utilisateur. Le champ "profile"
// est intentionnellement un sous-objet dedie aux informations declaratives
// de l'utilisateur : de nouveaux champs (pays, langue, universite, pharmacie,
// numero INAMI, specialite, preferences, notifications...) pourront y etre
// ajoutes plus tard sans casser cette structure, tant que les mises a jour
// utilisent la notation pointee ("profile.xxx") plutot qu'un remplacement
// integral du sous-objet (voir saveOnboardingProfile ci-dessous).
function buildDefaultUserDocument(user, provider) {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',

    provider: provider,

    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp(),

    profile: {
      profession: '',
      professionOther: '',
      organizationType: '',
      organizationName: '',
    },

    role: 'user',
    status: 'active',
    profileCompleted: false,
    version: 1,
  };
}

function currentProviderId(user) {
  return (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'password';
}

/**
 * A appeler apres chaque connexion reussie (voir js/auth.js).
 * - Cree le document utilisateur s'il n'existe pas encore (premiere connexion).
 * - Sinon, met a jour uniquement lastLogin / provider / displayName / photoURL
 *   (ce dernier couple seulement s'il a reellement change), sans jamais
 *   toucher aux champs propres a Pharmeval (profile, role, status,
 *   profileCompleted, version).
 *
 * Retourne les donnees utilisateur telles qu'elles seront lues par l'appelant
 * (avec des objets Date en remplacement des sentinelles serverTimestamp(),
 * qui ne peuvent pas etre relues immediatement dans le meme cycle).
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js").User} user
 * @returns {Promise<object>} le document utilisateur (cree ou mis a jour)
 */
export async function ensureUserDocument(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const provider = currentProviderId(user);

  if (!snap.exists()) {
    const newDoc = buildDefaultUserDocument(user, provider);
    await setDoc(ref, newDoc);
    return { ...newDoc, createdAt: new Date(), lastLogin: new Date() };
  }

  const existing = snap.data();
  const updates = {
    lastLogin: serverTimestamp(),
    provider: provider,
  };
  if (user.displayName && user.displayName !== existing.displayName) {
    updates.displayName = user.displayName;
  }
  if (user.photoURL && user.photoURL !== existing.photoURL) {
    updates.photoURL = user.photoURL;
  }
  await updateDoc(ref, updates);

  return { ...existing, ...updates, lastLogin: new Date() };
}

/**
 * Enregistre les reponses de l'assistant de premiere connexion et marque le
 * profil comme complet. Utilise la notation pointee pour ne mettre a jour
 * que les sous-champs concernes de "profile", sans jamais ecraser d'autres
 * sous-champs qui pourraient exister ou etre ajoutes plus tard.
 *
 * @param {string} uid
 * @param {{profession:string, professionOther?:string, organizationType:string, organizationOther?:string, organizationName:string}} profileData
 */
export async function saveOnboardingProfile(uid, profileData) {
  const ref = doc(db, 'users', uid);
  const isOtherProfession = profileData.profession === 'other';
  const isOtherOrganization = profileData.organizationType === 'other';
  await updateDoc(ref, {
    'profile.profession': profileData.profession || '',
    'profile.professionOther': isOtherProfession ? (profileData.professionOther || '') : '',
    'profile.organizationType': profileData.organizationType || '',
    'profile.organizationTypeOther': isOtherOrganization ? (profileData.organizationOther || '') : '',
    'profile.organizationName': profileData.organizationName || '',
    profileCompleted: true,
  });
}

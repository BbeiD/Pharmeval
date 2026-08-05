const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");
const { correctEvaluationSession } = require("./lib/evaluation-correction-service");
const { validateQuestion } = require("./lib/question-import-validator");

admin.initializeApp();
// europe-west1 : co-localise le calcul avec Firestore (deja en europe-west1)
// - reduit la latence et evite un transfert de donnees vers les Etats-Unis
// a chaque requete (RGPD, constate le 24/07/2026 : la fonction tournait par
// defaut en us-central1, faute de region explicitement precisee jusqu'ici).
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const app = express();
// maxAge : autorise le navigateur a mettre en cache la reponse du
// preflight CORS (requete OPTIONS) au lieu de la refaire avant CHAQUE
// appel - l'en-tete "Authorization" declenche un preflight sur toute
// requete cross-origin (meme un GET), et son absence ici ajoutait un
// aller-retour reseau complet avant chaque lecture/ecriture (constate :
// ralentissement sensible de l'auto-sauvegarde des reponses en
// evaluation, 24/07/2026). Chaque navigateur applique de toute facon son
// propre plafond si 86400s (24h) le depasse - aucun risque a viser large.
app.use(cors({ origin: true, maxAge: 86400 }));
app.use(express.json());
app.use((req, res, next) => {
  res.on("finish", () => console.log(`${req.method} ${req.path} -> ${res.statusCode}`));
  next();
});

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Non authentifié" });
  }
}

app.get("/health", (req, res) => res.send("OK"));

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Signatures ("magic bytes") des formats d'image reellement acceptes -
// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : `req.file.mimetype`
// est une simple DECLARATION du client (en-tete multipart), jamais
// verifiee jusqu'ici - un fichier renomme/falsifie passait tel quel.
// Cette verification lit les premiers octets REELS du fichier, qui ne
// peuvent pas etre falsifies sans casser le format lui-meme.
function isLikelyImage(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true; // JPEG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true; // PNG
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true; // GIF8
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return true; // WEBP
  return false;
}

const IMAGE_UPLOAD_COUNTERS_COLLECTION = "image_upload_counters";
const IMAGE_UPLOAD_MAX_PER_HOUR = 30;

// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : aucune limite
// n'existait jusqu'ici sur le nombre d'uploads par utilisateur - une
// rafale pouvait gonfler le stockage/la facturation sans aucun
// garde-fou. Fenetre glissante simple (transaction, pas de dependance
// externe) : au plus IMAGE_UPLOAD_MAX_PER_HOUR uploads par heure entamee.
async function checkAndIncrementUploadQuota(uid) {
  const ref = admin.firestore().collection(IMAGE_UPLOAD_COUNTERS_COLLECTION).doc(uid);
  const now = Date.now();
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data && data.windowStart ? data.windowStart : 0;
    const withinWindow = now - windowStart < 60 * 60 * 1000;
    const count = withinWindow ? (data.count || 0) : 0;
    if (count >= IMAGE_UPLOAD_MAX_PER_HOUR) return false;
    tx.set(ref, { windowStart: withinWindow ? windowStart : now, count: count + 1 });
    return true;
  });
}

app.post("/api/images", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier manquant." });
  if (!isLikelyImage(req.file.buffer) || !req.file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Le fichier envoyé n'est pas une image reconnue." });
  }
  const allowed = await checkAndIncrementUploadQuota(req.user.uid);
  if (!allowed) {
    return res.status(429).json({ error: "Trop d'envois d'images en une heure. Réessayez plus tard." });
  }
  const bucket = admin.storage().bucket();
  const blob = bucket.file(`justifications/${Date.now()}-${req.file.originalname}`);
  await blob.save(req.file.buffer, { contentType: req.file.mimetype });
  const [url] = await blob.getSignedUrl({ action: "read", expires: "2030-01-01" });
  res.json({ url });
});

const TAGS_COLLECTION = "tags";
const DEFAULT_TAGS_PAGE_SIZE = 200; // meme borne que tag-catalog-service.js (front)

// Reprend exactement listMostUsedTags() de js/services/tag-catalog-service.js,
// cote serveur avec le SDK Admin. Lecture ouverte a tout utilisateur
// authentifie, meme regle que firestore.rules (match /tags/{tagId}).
app.get("/api/tags/most-used", requireAuth, async (req, res) => {
  const pageSize = boundedNumberParam(req.query.pageSize, DEFAULT_TAGS_PAGE_SIZE, 500);
  try {
    const snap = await admin
      .firestore()
      .collection(TAGS_COLLECTION)
      .orderBy("usageCount", "desc")
      .limit(pageSize)
      .get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[tags/most-used]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend getTagsByIds() de js/services/tag-catalog-service.js. Meme regle
// que firestore.rules : tout utilisateur authentifie. Enregistree AVANT
// /api/tags/:tagId (sinon "by-ids" y serait intercepte comme un identifiant).
app.get("/api/tags/by-ids", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.json({});
  try {
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(uniqueIds.map((id) => admin.firestore().collection(TAGS_COLLECTION).doc(id).get()));
    const map = {};
    uniqueIds.forEach((id, i) => { if (results[i].exists) map[id] = results[i].data(); });
    res.json(map);
  } catch (err) {
    console.error("[tags/by-ids]", err && err.code, err);
    res.status(500).json({});
  }
});

// Reprend getTagById() de js/services/tag-catalog-service.js. Meme regle
// que firestore.rules (match /tags/{tagId}) : tout utilisateur authentifie.
app.get("/api/tags/:tagId", requireAuth, async (req, res) => {
  try {
    const snap = await admin.firestore().collection(TAGS_COLLECTION).doc(req.params.tagId).get();
    res.json({ data: snap.exists ? snap.data() : null, error: false });
  } catch (err) {
    console.error("[tags/:tagId]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend findOrCreateTag() de js/services/tag-catalog-service.js (moteur
// de synchronisation du catalogue, import Excel). Meme regle que
// firestore.rules (match /tags/{tagId}) : isRequesterCatalogAdmin(). Pas de
// transaction ici (meme choix assume que l'original - un compteur d'usage
// non critique, jamais une source d'incoherence sur les questions elles-memes).
app.post("/api/tags/find-or-create", requireAuth, async (req, res) => {
  const tagId = req.body && req.body.tagId;
  const label = req.body && req.body.label;
  if (!tagId) return res.status(400).json({ success: false, tagId: "", created: false, error: true });
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, tagId, created: false, error: true });
    }
    const ref = admin.firestore().collection(TAGS_COLLECTION).doc(tagId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ usageCount: FieldValue.increment(1) });
      return res.json({ success: true, tagId, created: false, error: false });
    }
    await ref.set({ id: tagId, label, usageCount: 1, createdAt: new Date().toISOString() });
    res.json({ success: true, tagId, created: true, error: false });
  } catch (err) {
    console.error("[tags/find-or-create]", err && err.code, err);
    res.status(500).json({ success: false, tagId, created: false, error: true });
  }
});

const THEME_CODES = {
  conseil: "CON", dermo: "DER", procedures: "PRO", medicaments: "MED",
  bppo: "BPP", ftm: "FTM", deon: "DEO", bapcoc: "BAP", etudiant: "ETU",
  legislation: "LEG", galenique: "GAL", adm: "ADM",
};
function formatPedagogicalId(themeCode3Letters, sequence) {
  return "PHARM-" + String(themeCode3Letters || "GEN").toUpperCase() + "-" + String(sequence).padStart(6, "0");
}

// Reprend allocatePedagogicalId() de js/services/catalog-sync-firestore-
// backend.js (moteur de synchronisation du catalogue). CORRIGE au passage
// une course non geree dans l'original (increment() puis un getDoc()
// SEPARE - deux appels non-atomiques ensemble, deux imports concurrents
// auraient pu lire la MEME valeur de sequence et generer un identifiant
// pedagogique en double) : desormais lecture+ecriture de la sequence dans
// UNE SEULE transaction Firestore. Meme regle que firestore.rules (match
// /pedagogical_id_counters/{counterId}) : isRequesterCatalogAdmin().
app.post("/api/catalog-sync/pedagogical-id", requireAuth, async (req, res) => {
  const theme = (req.body && req.body.theme) || "";
  const code3 = (THEME_CODES[theme] || "GEN").toUpperCase();
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ id: "ERR-ALLOC-" + Date.now(), error: true });
    }
    const ref = admin.firestore().collection("pedagogical_id_counters").doc(code3);
    const sequence = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = (snap.exists ? snap.data().count : 0) + 1;
      tx.set(ref, { count: next }, { merge: true });
      return next;
    });
    res.json({ id: formatPedagogicalId(code3, sequence), error: false });
  } catch (err) {
    console.error("[catalog-sync/pedagogical-id]", theme, err && err.code, err);
    res.status(500).json({ id: "ERR-ALLOC-" + Date.now(), error: true });
  }
});

// Meme verification que isRequesterAdmin() dans firestore.rules : role
// 'admin' ET statut 'active' sur le document users/{uid} du requerant.
async function isRequesterAdmin(requesterUid) {
  const snap = await admin.firestore().collection("users").doc(requesterUid).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data.role === "admin" && data.status === "active";
}

// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : pageSize/maxScan
// n'avaient jusqu'ici aucun PLAFOND - un utilisateur authentifie normal
// pouvait demander un balayage arbitrairement grand (ex. maxScan=5000000)
// en boucle, saturant les 10 instances disponibles (maxInstances:10,
// seule protection de concurrence existante) et gonflant le cout des
// lectures Firestore. `max` borne desormais toute valeur fournie par le
// client, quel que soit le nombre demande.
function boundedNumberParam(raw, defaultValue, max) {
  const n = Number(raw);
  if (!(n > 0)) return defaultValue;
  return Math.min(n, max);
}

const DAILY_CHALLENGE_COLLECTION = "daily_challenge_progress";

// Reprend getDailyChallengeProgress() de
// js/services/daily-challenge-catalog-service.js. Meme regle d'acces que
// firestore.rules (match /daily_challenge_progress/{uid}) : le proprietaire
// du document ou un admin, jamais un tiers.
app.get("/api/daily-challenge/:uid", requireAuth, async (req, res) => {
  const { uid } = req.params;
  try {
    if (req.user.uid !== uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ data: null, error: "Accès refusé" });
    }
    const snap = await admin.firestore().collection(DAILY_CHALLENGE_COLLECTION).doc(uid).get();
    res.json({ data: snap.exists ? snap.data() : null, error: false });
  } catch (err) {
    console.error("[daily-challenge]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend saveDailyChallengeProgress() de
// js/services/daily-challenge-catalog-service.js. Meme regle que
// firestore.rules (create ET update) : uniquement en son propre nom,
// document.userId == uid. Ecriture complete (jamais partielle), meme
// principe que le client.
app.put("/api/daily-challenge/:uid", requireAuth, async (req, res) => {
  const { uid } = req.params;
  const progress = req.body || {};
  if (req.user.uid !== uid || progress.userId !== uid) {
    return res.status(403).json({ success: false, error: true });
  }
  try {
    await admin.firestore().collection(DAILY_CHALLENGE_COLLECTION).doc(uid).set(progress);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[daily-challenge:put]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

const LUNDI_LEGI_COLLECTION = "lundi_legi_progress";

// Reprend getLundiLegiProgress() de
// js/services/lundi-legi-catalog-service.js. Meme regle d'acces que
// daily-challenge (match /lundi_legi_progress/{uid}) : le proprietaire
// du document ou un admin, jamais un tiers.
app.get("/api/lundi-legi/:uid", requireAuth, async (req, res) => {
  const { uid } = req.params;
  try {
    if (req.user.uid !== uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ data: null, error: true });
    }
    const snap = await admin.firestore().collection(LUNDI_LEGI_COLLECTION).doc(uid).get();
    res.json({ data: snap.exists ? snap.data() : null, error: false });
  } catch (err) {
    console.error("[lundi-legi]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend saveLundiLegiProgress() de
// js/services/lundi-legi-catalog-service.js. Ecriture complete,
// uniquement en son propre nom (progress.userId == uid).
app.put("/api/lundi-legi/:uid", requireAuth, async (req, res) => {
  const { uid } = req.params;
  const progress = req.body || {};
  if (req.user.uid !== uid || progress.userId !== uid) {
    return res.status(403).json({ success: false, error: true });
  }
  try {
    await admin.firestore().collection(LUNDI_LEGI_COLLECTION).doc(uid).set(progress);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[lundi-legi:put]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

const COMPETENCY_PROGRESS_COLLECTION = "competency_progress";

// Reprend listProgressionsByUser() de
// js/services/competency-progress-catalog-service.js (utilisee par "Mes
// competences"). Meme regle d'acces que firestore.rules (match
// /competency_progress/{progressId}) : le proprietaire ou un admin.
app.get("/api/competency-progress/:uid", requireAuth, async (req, res) => {
  const { uid } = req.params;
  try {
    if (req.user.uid !== uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    const snap = await admin
      .firestore()
      .collection(COMPETENCY_PROGRESS_COLLECTION)
      .where("userId", "==", uid)
      .orderBy("lastEvaluationAt", "desc")
      .limit(100)
      .get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[competency-progress]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend getProgressionById() de
// js/services/competency-progress-catalog-service.js. Meme regle que
// firestore.rules : le proprietaire ou un admin. Enregistre AVANT la route
// parametree /:uid ci-dessus (2 segments contre 1, aucune collision
// possible dans Express, mais gardee ici pour rester proche du fichier
// source qu'elle complete).
app.get("/api/competency-progress/by-id/:progressId", requireAuth, async (req, res) => {
  try {
    const snap = await admin.firestore().collection(COMPETENCY_PROGRESS_COLLECTION).doc(req.params.progressId).get();
    if (!snap.exists) return res.json({ data: null, error: false });
    const data = snap.data();
    if (data.userId !== req.user.uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ data: null, error: "Accès refusé" });
    }
    res.json({ data, error: false });
  } catch (err) {
    console.error("[competency-progress/by-id]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

const VALID_MASTERY_STATUSES = ["mastered", "to_reinforce", "not_acquired"];
const VALID_COMPETENCY_LEVELS = ["discovery", "beginner", "intermediate", "advanced", "expert"];
const VALID_PROGRESSION_TRENDS = ["improving", "stable", "declining"];

// Reprend saveProgressionDocument() de
// js/services/competency-progress-catalog-service.js. Meme regle que
// firestore.rules (create ET update, identiques ici) : uniquement en son
// propre nom, identifiant conforme a uid_competencyId. Ecriture complete
// (setDoc), jamais partielle - meme principe que le client.
//
// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : cette collection
// n'est plus alimentee par aucun flux d'evaluation reel aujourd'hui
// (aucune session ne renseigne `competencyId` - voir le commentaire de
// getMyCompetencyProgressFromQuestions(), js/services/competency-
// progress-service.js, qui l'a remplacee pour "Mes competences"). Un
// vrai recalcul server-side (comme pour evaluation-results/question-
// progress ci-dessus) serait donc disproportionne vu son usage actuel -
// on se limite a une validation de BORNES/ENUMS pour empecher une valeur
// totalement absurde d'etre ecrite, en attendant une decision sur le
// devenir de cette collection (retrait ou reactivation reelle).
app.post("/api/competency-progress", requireAuth, async (req, res) => {
  const progressDocument = req.body || {};
  const expectedId = `${req.user.uid}_${progressDocument.competencyId}`;
  if (progressDocument.userId !== req.user.uid || progressDocument.id !== expectedId) {
    return res.status(403).json({ success: false, error: true });
  }
  const numericFields = ["evaluationCount", "bestPercent", "lastPercent", "averagePercent", "confidenceScore"];
  for (const field of numericFields) {
    const value = progressDocument[field];
    if (value !== undefined && (typeof value !== "number" || value < 0 || value > (field === "evaluationCount" ? Number.MAX_SAFE_INTEGER : 100))) {
      return res.status(400).json({ success: false, error: true, message: `Champ "${field}" hors bornes.` });
    }
  }
  if (progressDocument.masteryStatus !== undefined && progressDocument.masteryStatus !== null && !VALID_MASTERY_STATUSES.includes(progressDocument.masteryStatus)) {
    return res.status(400).json({ success: false, error: true, message: "masteryStatus invalide." });
  }
  if (progressDocument.currentLevel !== undefined && !VALID_COMPETENCY_LEVELS.includes(progressDocument.currentLevel)) {
    return res.status(400).json({ success: false, error: true, message: "currentLevel invalide." });
  }
  if (progressDocument.trend !== undefined && !VALID_PROGRESSION_TRENDS.includes(progressDocument.trend)) {
    return res.status(400).json({ success: false, error: true, message: "trend invalide." });
  }
  try {
    await admin.firestore().collection(COMPETENCY_PROGRESS_COLLECTION).doc(progressDocument.id).set(progressDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[competency-progress:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

const EVALUATION_RESULTS_COLLECTION = "evaluation_results";
const DEFAULT_EVALUATIONS_PAGE_SIZE = 20;

// Reprend normalizeResult() de js/services/history-service.js — meme
// mapping V2 -> forme interne attendue par history.js/statistics-service.js.
function normalizeEvaluationResult(raw) {
  const score = raw.score || {};
  const allQuestions = [];
  (raw.competencyResults || []).forEach((cr) => {
    (cr.questionResults || []).forEach((qr) => {
      const options = qr.options || [];
      const userIdx = typeof qr.userAnswer === "number" ? qr.userAnswer : null;
      const correctIdx = typeof qr.correctAnswer === "number" ? qr.correctAnswer : null;
      let answerGivenText = "—";
      if (userIdx !== null && options[userIdx] !== undefined) {
        answerGivenText = String(options[userIdx]);
      } else if (typeof qr.userAnswer === "string" && qr.userAnswer !== "") {
        answerGivenText = qr.userAnswer;
      }
      allQuestions.push({
        questionId: qr.pedagogicalId,
        question: qr.question || "",
        options,
        userAnswer: userIdx,
        correctAnswer: correctIdx,
        answerGiven: answerGivenText,
        correct: qr.status === "correct",
      });
    });
  });

  return {
    id: raw.id,
    completedAt: raw.createdAt,
    score: {
      percentage: score.percent,
      correctAnswers: score.correctCount,
      totalQuestions: score.totalCount,
    },
    selection: { theme: raw.competencyId || null },
    competencyId: raw.competencyId,
    parcoursId: raw.parcoursId,
    sessionType: raw.dailyChallengeDate ? 'daily_challenge' : (raw.parcoursId ? 'parcours' : 'free_training'),
    questions: allQuestions,
  };
}

// Reprend getEvaluationsPage() de js/services/history-service.js ("Mes
// evaluations"). Toujours les evaluations du requerant lui-meme (jamais un
// uid en parametre) - meme regle que firestore.rules (userId ==
// request.auth.uid), pas de bypass admin ici (l'admin passe par une autre
// route/fiche, getRecentEvaluationsForUid, non migree).
// createdAt est un Timestamp Firestore (serverTimestamp() a l'ecriture,
// voir evaluation-service.js) : se serialise en JSON en
// {_seconds,_nanoseconds}, jamais un type reutilisable tel quel dans une
// URL. Le curseur echange avec le front est donc explicitement encode/
// decode en JSON plutot que suppose etre une simple chaine.
function parseCursorParam(raw) {
  if (!raw) return null;
  try {
    const { _seconds, _nanoseconds } = JSON.parse(raw);
    return new Timestamp(_seconds, _nanoseconds || 0);
  } catch {
    return null;
  }
}

app.get("/api/evaluations", requireAuth, async (req, res) => {
  const pageSize = boundedNumberParam(req.query.pageSize, DEFAULT_EVALUATIONS_PAGE_SIZE, 200);
  const cursorTimestamp = parseCursorParam(req.query.cursor);
  try {
    let q = admin
      .firestore()
      .collection(EVALUATION_RESULTS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc");
    if (cursorTimestamp) q = q.startAfter(cursorTimestamp);
    q = q.limit(pageSize + 1);

    const snap = await q.get();
    const rawAll = snap.docs.map((d) => {
      const data = d.data();
      if (!data.id) data.id = d.id;
      return data;
    });

    const hasMore = rawAll.length > pageSize;
    const rawPage = rawAll.slice(0, pageSize);
    const nextCursor = rawPage.length ? rawPage[rawPage.length - 1].createdAt : cursorTimestamp || null;
    const items = rawPage.map(normalizeEvaluationResult);

    res.json({ items, nextCursor, hasMore, error: false });
  } catch (err) {
    console.error("[evaluations]", err && err.code, err);
    res.status(500).json({ items: [], nextCursor: null, hasMore: false, error: true });
  }
});

const STATISTICS_FETCH_LIMIT = 100;

// Reprend getEvaluationsForStatistics() de js/services/history-service.js
// (donut de progression sur l'accueil, Mes evaluations, statistics.js).
// Toujours les evaluations du requerant lui-meme, meme regle que /api/evaluations.
app.get("/api/evaluations/for-statistics", requireAuth, async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_RESULTS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .limit(STATISTICS_FETCH_LIMIT + 1)
      .get();

    const rawAll = snap.docs.map((d) => {
      const data = d.data();
      if (!data.id) data.id = d.id;
      return data;
    });
    const truncated = rawAll.length > STATISTICS_FETCH_LIMIT;
    const items = rawAll.slice(0, STATISTICS_FETCH_LIMIT).map(normalizeEvaluationResult);

    res.json({ items, truncated, error: false });
  } catch (err) {
    console.error("[evaluations/for-statistics]", err && err.code, err);
    res.status(500).json({ items: [], truncated: false, error: true });
  }
});

const ASSIGNMENTS_COLLECTION = "assignments";
const PARCOURS_COLLECTION = "parcours";

// Reprend createAssignmentDocument() de js/services/assignment-catalog-
// service.js. Meme regle "create" que firestore.rules : isRequesterAdmin(),
// id == identifiant du document, parcoursId est une chaine, type parmi
// user/group/profile.
app.post("/api/assignments", requireAuth, async (req, res) => {
  const assignmentDocument = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    if (
      !assignmentDocument.id ||
      typeof assignmentDocument.parcoursId !== "string" ||
      !["user", "group", "profile"].includes(assignmentDocument.type)
    ) {
      return res.status(403).json({ success: false, error: true });
    }
    await admin.firestore().collection(ASSIGNMENTS_COLLECTION).doc(assignmentDocument.id).set(assignmentDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[assignments:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend deleteAssignmentDocument() de js/services/assignment-catalog-
// service.js. Meme regle "delete" que firestore.rules : isRequesterAdmin()
// uniquement - pas de workflow de suppression securisee ici (une
// attribution est un simple lien, suppression reelle et immediate).
app.delete("/api/assignments/:id", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    await admin.firestore().collection(ASSIGNMENTS_COLLECTION).doc(req.params.id).delete();
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[assignments/:id:delete]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend listAssignmentsByParcours() de js/services/assignment-catalog-
// service.js (ecran d'administration, section "Attributions" d'un
// parcours). Reservee aux administrateurs (voir assignment-service.js,
// MANAGE_PARCOURS) - la regle Firestore d'origine n'aurait de toute facon
// jamais pu autoriser cette requete pour un non-admin (aucun filtre par
// cible, resultat potentiellement mixte user/group/profile).
app.get("/api/assignments/by-parcours/:parcoursId", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ items: [], error: true });
    const snap = await admin
      .firestore()
      .collection(ASSIGNMENTS_COLLECTION)
      .where("parcoursId", "==", req.params.parcoursId)
      .orderBy("assignedAt", "desc")
      .limit(200)
      .get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[assignments/by-parcours]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend assignmentExists() de js/services/assignment-catalog-service.js
// (verification de doublon avant creation). Meme regle (admin uniquement).
app.get("/api/assignments/exists", requireAuth, async (req, res) => {
  const { parcoursId, type, targetId } = req.query;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ exists: false, error: true });
    const snap = await admin
      .firestore()
      .collection(ASSIGNMENTS_COLLECTION)
      .where("parcoursId", "==", parcoursId)
      .where("type", "==", type)
      .where("targetId", "==", targetId)
      .limit(1)
      .get();
    res.json({ exists: !snap.empty, error: false });
  } catch (err) {
    console.error("[assignments/exists]", err && err.code, err);
    res.status(500).json({ exists: false, error: true });
  }
});

async function listAssignmentsByTarget(type, targetId) {
  if (!targetId) return [];
  const snap = await admin
    .firestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .where("type", "==", type)
    .where("targetId", "==", targetId)
    .limit(200)
    .get();
  return snap.docs.map((d) => d.data());
}

async function listAssignmentsByTargetIn(type, targetIds) {
  const ids = (targetIds || []).filter(Boolean).slice(0, 30);
  if (ids.length === 0) return [];
  const snap = await admin
    .firestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .where("type", "==", type)
    .where("targetId", "in", ids)
    .limit(200)
    .get();
  return snap.docs.map((d) => d.data());
}

// Reprend getAssignedParcoursForUser() de js/services/assignment-service.js
// ("Mes parcours"). Toujours le requerant lui-meme (jamais un uid en
// parametre) - aucun des appelants reels (mes-parcours.js, home.js,
// parcours-completion/evaluation/view-service.js) ne demande les parcours
// d'un tiers ; pas de bypass admin necessaire ici.
app.get("/api/assigned-parcours", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    if (!userSnap.exists) return res.json({ items: [], error: true });
    const user = userSnap.data();

    const [directItems, profileItems, groupItems] = await Promise.all([
      listAssignmentsByTarget("user", uid),
      user.profileId ? listAssignmentsByTarget("profile", user.profileId) : [],
      Array.isArray(user.groupIds) && user.groupIds.length > 0
        ? listAssignmentsByTargetIn("group", user.groupIds)
        : [],
    ]);

    const allAssignments = [...directItems, ...profileItems, ...groupItems].filter(
      (a) => a.status === "active"
    );

    const byParcoursId = new Map();
    allAssignments.forEach((a) => {
      if (!byParcoursId.has(a.parcoursId)) byParcoursId.set(a.parcoursId, a);
    });

    const parcoursIds = Array.from(byParcoursId.keys());
    const parcoursDocs = await Promise.all(
      parcoursIds.map((pid) => admin.firestore().collection(PARCOURS_COLLECTION).doc(pid).get())
    );

    const items = [];
    parcoursIds.forEach((pid, i) => {
      const parcoursSnap = parcoursDocs[i];
      const parcours = parcoursSnap.exists ? parcoursSnap.data() : null;
      if (!parcours || parcours.status !== "published") return;
      items.push({ parcours, assignment: byParcoursId.get(pid) });
    });

    res.json({ items, error: false });
  } catch (err) {
    console.error("[assigned-parcours]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

const QUESTIONS_COLLECTION = "questions";
const DEFAULT_SEARCH_SCAN_LIMIT = 500; // meme defaut que question-catalog-service.js (front)
const MAX_QUESTIONS_PER_IMPORT = 500; // meme valeur que question-import-validator.js (front)

// Reprend buildFilterDescriptors() de js/services/question-filter-utils.js
// - logique pure dupliquee ici a l'identique (le fichier d'origine ne peut
// pas etre importe tel quel, ESM navigateur vs CommonJS Cloud Functions).
function buildQuestionFilterDescriptors(filters) {
  const descriptors = [];
  const f = filters || {};
  if (f.status) descriptors.push({ field: "status", op: "==", value: f.status });
  if (f.theme) descriptors.push({ field: "theme", op: "==", value: f.theme });
  if (f.difficulty) descriptors.push({ field: "difficulty", op: "==", value: f.difficulty });
  if (f.questionType) descriptors.push({ field: "questionType", op: "==", value: f.questionType });
  if (f.author) descriptors.push({ field: "author", op: "==", value: f.author });
  if (f.documentSourceId) descriptors.push({ field: "documentSourceId", op: "==", value: f.documentSourceId });
  if (f.documentSectionId) descriptors.push({ field: "documentSectionId", op: "==", value: f.documentSectionId });
  if (f.competencyId) descriptors.push({ field: "competencyId", op: "==", value: f.competencyId });
  if (f.tag) descriptors.push({ field: "tags", op: "array-contains", value: f.tag });
  return descriptors;
}

function parseFiltersParam(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

// Reprend resolveQuestionIdentity() de js/services/catalog-sync-firestore-
// backend.js (dedoublonnage par externalId avant import). Reservee aux
// administrateurs, meme principe que existing-editorial-ids ci-dessus.
app.get("/api/questions/resolve-identity", requireAuth, async (req, res) => {
  const externalId = req.query.externalId;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ found: false, pedagogicalId: null, existingDoc: null, error: true });
    const snap = await admin
      .firestore()
      .collection(QUESTIONS_COLLECTION)
      .where("externalIds.editorialCatalog", "==", externalId)
      .limit(1)
      .get();
    if (snap.empty) return res.json({ found: false, pedagogicalId: null, existingDoc: null, error: false });
    const d = snap.docs[0];
    res.json({ found: true, pedagogicalId: d.id, existingDoc: d.data(), error: false });
  } catch (err) {
    console.error("[questions/resolve-identity]", err && err.code, err);
    res.status(500).json({ found: false, pedagogicalId: null, existingDoc: null, error: true });
  }
});

// Reprend listExistingEditorialCatalogIds() de js/services/catalog-sync-
// firestore-backend.js (moteur de synchronisation, detection de doublons
// avant import). Reservee aux administrateurs (toutes questions, tout
// statut confondu, jamais uniquement les publiees).
app.get("/api/questions/existing-editorial-ids", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ ids: [], error: true });
    const snap = await admin
      .firestore()
      .collection(QUESTIONS_COLLECTION)
      .where("fromEditorialCatalog", "==", true)
      .limit(5000)
      .get();
    const ids = [];
    snap.forEach((d) => {
      const data = d.data();
      const id = data.externalIds && data.externalIds.editorialCatalog;
      if (id) ids.push(id);
    });
    res.json({ ids, error: false });
  } catch (err) {
    console.error("[questions/existing-editorial-ids]", err && err.code, err);
    res.status(500).json({ ids: [], error: true });
  }
});

// Reprend fetchAllQuestionsOfSource() de js/services/document-count-
// service.js (reconciliation des compteurs, admin/document-sources.js).
// Retourne TOUTES les questions d'une source quel que soit leur statut
// (necessaire pour un comptage reel) - reservee aux administrateurs du
// catalogue, contrairement aux lectures normales limitees aux publiees.
app.get("/api/questions/all-for-source/:sourceId", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: true });
    }
    const snap = await admin
      .firestore()
      .collection(QUESTIONS_COLLECTION)
      .where("documentSourceId", "==", req.params.sourceId)
      .limit(2000)
      .get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[questions/all-for-source]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend queryQuestionsPage() de js/services/question-catalog-service.js
// (Banque de questions, admin). Meme regle que firestore.rules : un filtre
// status=='published' est ouvert a tout utilisateur authentifie, tout AUTRE
// cas exige isRequesterAdmin() - jamais de fuite d'une question non publiee
// via un filtre absent ou un autre statut. Enregistree AVANT /search-bounded
// (methode GET distincte de toute facon, mais gardee ici pour la lisibilite).
app.get("/api/questions", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const pageSize = boundedNumberParam(req.query.pageSize, 25, 100);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (filters.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], lastDoc: null, hasMore: false, error: "Accès refusé" });
    }
    let q = admin.firestore().collection(QUESTIONS_COLLECTION);
    buildQuestionFilterDescriptors(filters).forEach((d) => { q = q.where(d.field, d.op, d.value); });
    q = q.orderBy(sortField, sortDirection).limit(pageSize + 1);
    if (req.query.cursor) {
      try { q = q.startAfter(JSON.parse(req.query.cursor)); } catch { /* curseur invalide, ignore */ }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, pageSize);
    res.json({
      items: docs.map((d) => d.data()),
      lastCursor: docs.length ? JSON.stringify(docs[docs.length - 1].data()[sortField]) : null,
      hasMore: snap.docs.length > pageSize,
      error: false,
    });
  } catch (err) {
    console.error("[questions]", err && err.code, err);
    const isIndexMissing = /index/i.test((err && err.message) || "");
    res.status(500).json({
      items: [], lastDoc: null, hasMore: false, error: true,
      message: isIndexMissing ? "Cette fonctionnalité nécessite un index Firestore qui n'est pas encore déployé." : null,
    });
  }
});

// Reprend searchQuestionsBounded() de js/services/question-catalog-service.js
// (composition du pool "Entrainement libre", question-search-provider.js).
// Meme regle que firestore.rules (match /questions/{pedagogicalId}) : tout
// utilisateur authentifie peut lire une question publiee.
app.get("/api/questions/search-bounded", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const scanLimit = boundedNumberParam(req.query.maxScan, DEFAULT_SEARCH_SCAN_LIMIT, 2000);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    let q = admin.firestore().collection(QUESTIONS_COLLECTION);
    buildQuestionFilterDescriptors(filters).forEach((d) => {
      q = q.where(d.field, d.op, d.value);
    });
    q = q.orderBy(sortField, sortDirection).limit(scanLimit + 1);

    const snap = await q.get();
    const all = snap.docs.map((d) => d.data());
    const truncated = all.length > scanLimit;

    res.json({ items: all.slice(0, scanLimit), truncated, error: false, scanLimit });
  } catch (err) {
    console.error("[questions/search-bounded]", err && err.code, err);
    const isIndexMissing = /index/i.test((err && err.message) || "");
    res.status(500).json({
      items: [],
      truncated: false,
      error: true,
      scanLimit,
      message: isIndexMissing
        ? "Cette fonctionnalité nécessite un index Firestore qui n'est pas encore déployé."
        : null,
    });
  }
});

// Reprend writeQuestionsBatch() de js/services/question-catalog-service.js
// (import Excel). Meme regle "create" que firestore.rules : isRequesterAdmin(),
// pedagogicalId == identifiant du document, statut TOUJOURS 'draft' - verifie
// PAR ENTREE (le validateur cote client refuse deja un fichier > 500
// questions, mais le SDK Admin contourne firestore.rules, la verification
// est donc refaite ici, defense en profondeur identique au commentaire
// d'origine). Un seul writeBatch (atomique : tout ou rien).
//
// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : chaque question
// est desormais revalidee avec validateQuestion() (copie fidele du
// validateur cote client, functions/lib/) AVANT ecriture - jusqu'ici,
// seuls pedagogicalId/status etaient verifies ici, un appel API direct
// pouvait donc ecrire une question structurellement absurde (theme
// inexistant, index de bonne reponse hors bornes...) malgre la promesse
// de "defense en profondeur identique" du commentaire d'origine.
app.post("/api/questions/batch", requireAuth, async (req, res) => {
  const documents = req.body && req.body.documents;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, writtenCount: 0, error: true });
    }
    if (!documents || typeof documents !== "object") {
      return res.status(400).json({ success: false, writtenCount: 0, error: true });
    }
    const entries = Object.entries(documents);
    if (entries.length === 0) return res.json({ success: true, writtenCount: 0, error: false });
    if (entries.length > MAX_QUESTIONS_PER_IMPORT) {
      return res.status(403).json({ success: false, writtenCount: 0, error: true });
    }
    const invalid = entries.some(([pedagogicalId, document]) => (
      document.pedagogicalId !== pedagogicalId || document.status !== "draft"
    ));
    if (invalid) {
      return res.status(403).json({ success: false, writtenCount: 0, error: true });
    }
    const validationErrors = entries.flatMap(([, document], index) => validateQuestion(document, index));
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, writtenCount: 0, error: true, validationErrors });
    }
    const batch = admin.firestore().batch();
    entries.forEach(([pedagogicalId, document]) => {
      batch.set(admin.firestore().collection(QUESTIONS_COLLECTION).doc(pedagogicalId), document);
    });
    await batch.commit();
    res.json({ success: true, writtenCount: entries.length, error: false });
  } catch (err) {
    console.error("[questions/batch]", err && err.code, err);
    res.status(500).json({ success: false, writtenCount: 0, error: true });
  }
});

// Reprend updateQuestionStatus() de js/services/question-catalog-service.js
// (Publier/Archiver/Remettre en brouillon depuis la Banque de questions, ET
// la transition securisee Archivee<->Corbeille - meme fonction cote client
// pour les deux, voir son unique appelant question-bank-service.js). Combine
// les 2 branches distinctes de firestore.rules (mise a jour n°2 et n°2b) :
// seul {status, updatedAt} est jamais ecrit, jamais un autre champ.
const QUESTION_STATUS_GENERAL_TARGETS = ["draft", "review", "published", "archived"];
app.patch("/api/questions/:id/status", requireAuth, async (req, res) => {
  const newStatus = req.body && req.body.status;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(QUESTIONS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const oldStatus = snap.data().status;

    const generalTransition = oldStatus !== "trash" && QUESTION_STATUS_GENERAL_TARGETS.includes(newStatus);
    const trashTransition = (oldStatus === "archived" && newStatus === "trash") || (oldStatus === "trash" && newStatus === "archived");
    if (!generalTransition && !trashTransition) {
      return res.status(403).json({ success: false, error: true });
    }

    await ref.update({ status: newStatus, updatedAt: new Date().toISOString() });
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[questions/:id/status]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// NOUVELLE ROUTE (correction du 24/07/2026 - voir git history pour l'ancienne
// updateQuestionFields() cote client, qui melangeait a tort 2 regles
// distinctes de firestore.rules derriere une seule liste blanche figee sur
// l'une d'elles seulement - bug de reclassement en masse jamais reellement
// ecrit, corrige ici plutot que reproduit). Reprend la mise a jour n°4 de
// firestore.rules ("classification documentaire") : isRequesterCatalogAdmin(),
// seuls documentSourceId/documentSectionId/functionalCode/classificationVersion
// (+updatedAt) modifiables, statut TOUJOURS inchange. Utilisee par
// document-count-service.js (classement individuel ET par lots).
const QUESTION_CLASSIFICATION_KEYS = ["documentSourceId", "documentSectionId", "functionalCode", "classificationVersion"];
app.patch("/api/questions/:id/classification", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    if (!Object.keys(fields).every((k) => QUESTION_CLASSIFICATION_KEYS.includes(k))) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(QUESTIONS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const payload = { ...fields, updatedAt: new Date().toISOString() };
    await ref.update(payload);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[questions/:id/classification]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend deleteQuestionDocument() de js/services/question-catalog-service.js.
// Meme regle "delete" que firestore.rules (suppression securisee) :
// isRequesterAdmin() ET la question doit DEJA etre a la corbeille - jamais
// un contournement du workflow Question -> Archivee -> Corbeille -> Suppression.
app.delete("/api/questions/:id", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(QUESTIONS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ success: true, error: false });
    if (snap.data().status !== "trash") {
      return res.status(403).json({ success: false, error: true });
    }
    await ref.delete();
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[questions/:id:delete]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend archiveQuestionsBySource() de js/services/question-catalog-
// service.js ("Supprimer le référentiel" -> archivage en cascade). Meme
// regle que la mise a jour n°2 (isRequesterAdmin()), n'ecrit jamais que
// {status,updatedAt}, ignore les questions deja a la corbeille (decision
// individuelle deja prise, independante du sort de la source).
app.post("/api/questions/archive-by-source", requireAuth, async (req, res) => {
  const { documentSourceId } = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, archivedCount: 0, error: true });
    }
    if (!documentSourceId) return res.status(400).json({ success: false, archivedCount: 0, error: true });
    const snap = await admin.firestore().collection(QUESTIONS_COLLECTION).where("documentSourceId", "==", documentSourceId).limit(2000).get();
    const refsToArchive = snap.docs.filter((d) => d.data().status !== "trash").map((d) => d.ref);

    const CHUNK_SIZE = 400;
    const now = new Date().toISOString();
    for (let i = 0; i < refsToArchive.length; i += CHUNK_SIZE) {
      const batch = admin.firestore().batch();
      refsToArchive.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.update(ref, { status: "archived", updatedAt: now }));
      await batch.commit();
    }
    res.json({ success: true, archivedCount: refsToArchive.length, error: false });
  } catch (err) {
    console.error("[questions/archive-by-source]", err && err.code, err);
    res.status(500).json({ success: false, archivedCount: 0, error: true });
  }
});

// Reprend publishAllDraftQuestions() de js/services/question-catalog-
// service.js. Meme regle que la mise a jour n°2 (isRequesterAdmin()).
app.post("/api/questions/publish-all-draft", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, publishedCount: 0, error: true });
    }
    const snap = await admin.firestore().collection(QUESTIONS_COLLECTION).where("status", "==", "draft").limit(2000).get();
    const refs = snap.docs.map((d) => d.ref);

    const CHUNK_SIZE = 400;
    const now = new Date().toISOString();
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = admin.firestore().batch();
      refs.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.update(ref, { status: "published", updatedAt: now }));
      await batch.commit();
    }
    res.json({ success: true, publishedCount: refs.length, error: false });
  } catch (err) {
    console.error("[questions/publish-all-draft]", err && err.code, err);
    res.status(500).json({ success: false, publishedCount: 0, error: true });
  }
});

// Reprend logQuestionAction() de js/services/question-audit-service.js.
// Meme regle "create" que firestore.rules (match /question_audit_logs/{logId}) :
// isRequesterAdmin(), adminUid == demandeur. Ecriture "best effort" (le
// front n'attend jamais cette route pour valider l'action elle-meme).
app.post("/api/question-audit-logs", requireAuth, async (req, res) => {
  const entry = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false });
    }
    if (entry.adminUid !== req.user.uid) {
      return res.status(403).json({ success: false });
    }
    await admin.firestore().collection("question_audit_logs").add({
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || "",
      pedagogicalId: entry.pedagogicalId || null,
      actionType: entry.actionType || "unknown",
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : "",
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[question-audit-logs:post]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

const DOCUMENT_SOURCES_COLLECTION = "document_sources";
const DEFAULT_SOURCES_PAGE_SIZE = 50;

// Meme verification que isRequesterCatalogAdmin() dans firestore.rules :
// role 'admin' OU 'super_admin', ET statut 'active'.
async function isRequesterCatalogAdmin(requesterUid) {
  const snap = await admin.firestore().collection("users").doc(requesterUid).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return (data.role === "admin" || data.role === "super_admin") && data.status === "active";
}

// Reprend queryDocumentSources() de
// js/services/document-source-catalog-service.js. Deux chemins reels bien
// distincts (document-source-service.js) : browseActiveDocumentSources()
// (Entrainement libre, tout utilisateur, TOUJOURS status=active) et
// browseDocumentSources() (administration, sans filtre de statut -> voit
// aussi les brouillons). Meme regle que firestore.rules : voir les sources
// non-actives exige isRequesterCatalogAdmin(), jamais un simple utilisateur
// authentifie.
app.get("/api/document-sources", requireAuth, async (req, res) => {
  const { sourceType, status } = req.query;
  const pageSize = boundedNumberParam(req.query.pageSize, DEFAULT_SOURCES_PAGE_SIZE, 500);
  try {
    if (status !== "active" && !(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    let q = admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION);
    if (sourceType) q = q.where("sourceType", "==", sourceType);
    if (status) q = q.where("status", "==", status);
    q = q.orderBy("display.order", "asc").limit(pageSize);

    const snap = await q.get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[document-sources]", err && err.code, err);
    const isIndexMissing = /index/i.test((err && err.message) || "");
    res.status(500).json({
      items: [],
      error: true,
      indexMissing: isIndexMissing,
      message: isIndexMissing
        ? "Cette fonctionnalité nécessite un index Firestore qui n'est pas encore déployé."
        : undefined,
    });
  }
});

// Reprend createDocumentSourceDoc() de js/services/document-source-
// catalog-service.js. Meme regle "create" que firestore.rules :
// isRequesterCatalogAdmin(), identifiant du document == champ `id`,
// statut TOUJOURS 'draft'. Refuse un identifiant deja existant (create
// strict, jamais un ecrasement silencieux du SDK Admin).
app.post("/api/document-sources", requireAuth, async (req, res) => {
  const sourceDocument = req.body || {};
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    if (!sourceDocument.id || sourceDocument.status !== "draft") {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(sourceDocument.id);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ success: false, error: true });
    }
    await ref.set(sourceDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sources:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateDocumentSourceFields() de js/services/document-source-
// catalog-service.js. Meme regle "update" que firestore.rules :
// isRequesterCatalogAdmin(), identifiant du document inchange (pas de
// hasOnly() cote regles - aucune restriction de champs ici).
app.patch("/api/document-sources/:id", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    if ("id" in fields && fields.id !== snap.data().id) {
      return res.status(403).json({ success: false, error: true });
    }
    await ref.update(fields);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sources/:id:patch]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend incrementDocumentSourceCounters() de js/services/document-
// source-catalog-service.js. Meme regle que ci-dessus (une incrementation
// est une mise a jour comme une autre du point de vue de firestore.rules).
app.post("/api/document-sources/:id/counters", requireAuth, async (req, res) => {
  const deltas = req.body || {};
  const payload = {};
  if (deltas.sectionCount) payload.sectionCount = FieldValue.increment(deltas.sectionCount);
  if (deltas.questionCount) payload.questionCount = FieldValue.increment(deltas.questionCount);
  if (Object.keys(payload).length === 0) return res.json({ success: true, error: false });
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    await admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(req.params.id).update(payload);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sources/:id/counters]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend activateAllDraftSources() de js/services/document-source-
// catalog-service.js. Meme regle (isRequesterCatalogAdmin()), un seul
// writeBatch (<=500 sources attendues, meme borne que le client).
app.post("/api/document-sources/activate-all-draft", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, activatedCount: 0, error: true });
    }
    const snap = await admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).where("status", "==", "draft").limit(500).get();
    if (snap.empty) return res.json({ success: true, activatedCount: 0, error: false });
    const now = new Date().toISOString();
    const batch = admin.firestore().batch();
    snap.docs.forEach((d) => batch.update(d.ref, { status: "active", isActive: true, updatedAt: now }));
    await batch.commit();
    res.json({ success: true, activatedCount: snap.size, error: false });
  } catch (err) {
    console.error("[document-sources/activate-all-draft]", err && err.code, err);
    res.status(500).json({ success: false, activatedCount: 0, error: true });
  }
});

const DOCUMENT_SECTIONS_COLLECTION = "document_sections";

// Reprend listSectionsBySource()/listActiveSectionsBySource() de
// js/services/document-section-catalog-service.js. Meme distinction que
// /api/document-sources : status=active ouvert a tout utilisateur
// authentifie, toute autre requete (admin, arborescence complete) exige
// isRequesterCatalogAdmin() - meme regle que firestore.rules.
app.get("/api/document-sections", requireAuth, async (req, res) => {
  const { documentSourceId, status } = req.query;
  if (!documentSourceId) return res.status(400).json({ items: [], error: "documentSourceId requis" });
  try {
    if (status !== "active" && !(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    let q = admin
      .firestore()
      .collection(DOCUMENT_SECTIONS_COLLECTION)
      .where("documentSourceId", "==", documentSourceId);
    if (status) q = q.where("status", "==", status);
    q = q.orderBy("displayOrder", "asc").limit(500);

    const snap = await q.get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[document-sections]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend createDocumentSectionDoc() de js/services/document-section-
// catalog-service.js. Meme regle "create" que firestore.rules :
// isRequesterCatalogAdmin(), identifiant du document == champ `id`.
// Refuse un identifiant deja existant (create strict).
app.post("/api/document-sections", requireAuth, async (req, res) => {
  const sectionDocument = req.body || {};
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    if (!sectionDocument.id) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(sectionDocument.id);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ success: false, error: true });
    }
    await ref.set(sectionDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sections:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateDocumentSectionFields() de js/services/document-section-
// catalog-service.js. Meme regle "update" que firestore.rules :
// isRequesterCatalogAdmin(), identifiant ET documentSourceId inchanges
// (une section ne change jamais de source par cette voie).
app.patch("/api/document-sections/:id", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    const ref = admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const current = snap.data();
    if ("id" in fields && fields.id !== current.id) {
      return res.status(403).json({ success: false, error: true });
    }
    if ("documentSourceId" in fields && fields.documentSourceId !== current.documentSourceId) {
      return res.status(403).json({ success: false, error: true });
    }
    await ref.update(fields);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sections/:id:patch]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend incrementDocumentSectionCounters() de js/services/document-
// section-catalog-service.js. Meme regle que ci-dessus.
app.post("/api/document-sections/:id/counters", requireAuth, async (req, res) => {
  const deltas = req.body || {};
  const payload = {};
  if (deltas.directQuestionCount) payload.directQuestionCount = FieldValue.increment(deltas.directQuestionCount);
  if (deltas.totalQuestionCount) payload.totalQuestionCount = FieldValue.increment(deltas.totalQuestionCount);
  if (deltas.childSectionCount) payload.childSectionCount = FieldValue.increment(deltas.childSectionCount);
  if (Object.keys(payload).length === 0) return res.json({ success: true, error: false });
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ success: false, error: true });
    }
    await admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(req.params.id).update(payload);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[document-sections/:id/counters]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// =========================================================================
// Reprend js/services/document-count-service.js (Correctif Sprint 20) :
// SEUL point du projet autorise a modifier questionCount (document_sources)
// et directQuestionCount/totalQuestionCount (document_sections). Fonctions
// PURES dupliquees ici a l'identique (memes raisons que
// buildQuestionFilterDescriptors() plus haut : le fichier d'origine ne peut
// pas etre importe tel quel, ESM navigateur vs CommonJS Cloud Functions).
// =========================================================================

const MAX_SECTION_DEPTH = 50;

function getSectionAncestorIdsServer(section) {
  const path = Array.isArray(section && section.path) ? section.path : [];
  const unique = new Set(path);
  if (unique.size !== path.length) {
    return { ancestorIds: [], anomaly: `Cycle détecté dans le chemin de la section "${section.id}" (un ancêtre apparaît plusieurs fois) — réconciliation recommandée.` };
  }
  if (path.length > MAX_SECTION_DEPTH) {
    return { ancestorIds: [], anomaly: `Profondeur anormale (${path.length} > ${MAX_SECTION_DEPTH}) pour la section "${section.id}" — réconciliation recommandée.` };
  }
  return { ancestorIds: path.slice(), anomaly: null };
}

function isSameDestinationServer(a, b) {
  const aSource = (a && a.sourceId) || null;
  const aSection = (a && a.sectionId) || null;
  const bSource = (b && b.sourceId) || null;
  const bSection = (b && b.sectionId) || null;
  return aSource === bSource && aSection === bSection;
}

function computeClassificationDeltaServer(oldDest, newDest, getAncestorIdsFn) {
  const sourceDeltas = {};
  const sectionDeltas = {};

  function addSource(id, delta) {
    if (!id) return;
    sourceDeltas[id] = (sourceDeltas[id] || 0) + delta;
  }
  function addSection(id, direct, total) {
    if (!id) return;
    if (!sectionDeltas[id]) sectionDeltas[id] = { direct: 0, total: 0 };
    sectionDeltas[id].direct += direct;
    sectionDeltas[id].total += total;
  }

  if (oldDest && oldDest.sourceId) {
    addSource(oldDest.sourceId, -1);
    if (oldDest.sectionId) {
      addSection(oldDest.sectionId, -1, -1);
      getAncestorIdsFn(oldDest.sectionId).forEach((ancId) => addSection(ancId, 0, -1));
    }
  }
  if (newDest && newDest.sourceId) {
    addSource(newDest.sourceId, 1);
    if (newDest.sectionId) {
      addSection(newDest.sectionId, 1, 1);
      getAncestorIdsFn(newDest.sectionId).forEach((ancId) => addSection(ancId, 0, 1));
    }
  }

  Object.keys(sourceDeltas).forEach((id) => { if (sourceDeltas[id] === 0) delete sourceDeltas[id]; });
  Object.keys(sectionDeltas).forEach((id) => {
    if (sectionDeltas[id].direct === 0 && sectionDeltas[id].total === 0) delete sectionDeltas[id];
  });

  return { sourceDeltas, sectionDeltas };
}

function clampNonNegativeServer(value) {
  if (value < 0) return { value: 0, wasClamped: true };
  return { value, wasClamped: false };
}

async function logAuditEvent(adminUid, actionType, oldValue, newValue) {
  try {
    await admin.firestore().collection("audit_logs").add({
      date: new Date().toISOString(),
      adminUid: adminUid || null,
      adminEmail: "",
      targetUid: null,
      targetEmail: null,
      actionType,
      oldValue: oldValue !== undefined && oldValue !== null ? String(oldValue) : "",
      newValue: newValue !== undefined && newValue !== null ? String(newValue) : "",
    });
  } catch (err) {
    console.error("[document-classification:audit]", err && err.code, err);
  }
}

// Reprend applyClassificationDelta() de document-count-service.js : reclasse
// UNE question de facon transactionnelle (la question ET tous les compteurs
// affectes, dans LA MEME transaction Firestore). Meme regle que la mise a
// jour n°4 de firestore.rules sur `questions` : isRequesterCatalogAdmin().
app.post("/api/document-classification/apply-single", requireAuth, async (req, res) => {
  const { pedagogicalId, newDest, extraFields } = req.body || {};
  const inconsistencies = [];
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ status: "error", message: "Accès refusé", inconsistencies: [] });
    }

    const result = await admin.firestore().runTransaction(async (tx) => {
      const questionRef = admin.firestore().collection(QUESTIONS_COLLECTION).doc(pedagogicalId);
      const questionSnap = await tx.get(questionRef);
      if (!questionSnap.exists) throw new Error("QUESTION_NOT_FOUND");
      const question = questionSnap.data();

      const oldDest = question.documentSourceId ? { sourceId: question.documentSourceId, sectionId: question.documentSectionId || null } : null;
      if (isSameDestinationServer(oldDest, newDest)) return { noop: true };

      const sectionIdsToRead = new Set();
      if (oldDest && oldDest.sectionId) sectionIdsToRead.add(oldDest.sectionId);
      if (newDest && newDest.sectionId) sectionIdsToRead.add(newDest.sectionId);

      const sectionDocs = {};
      for (const id of sectionIdsToRead) {
        const snap = await tx.get(admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(id));
        if (snap.exists) sectionDocs[id] = snap.data();
      }
      const ancestorIdsByLeaf = {};
      function resolveAncestors(sectionId) {
        if (ancestorIdsByLeaf[sectionId]) return ancestorIdsByLeaf[sectionId];
        const sec = sectionDocs[sectionId];
        if (!sec) { ancestorIdsByLeaf[sectionId] = []; return []; }
        const resolved = getSectionAncestorIdsServer(sec);
        if (resolved.anomaly) inconsistencies.push(resolved.anomaly);
        ancestorIdsByLeaf[sectionId] = resolved.ancestorIds;
        return resolved.ancestorIds;
      }
      if (oldDest && oldDest.sectionId) resolveAncestors(oldDest.sectionId).forEach((id) => sectionIdsToRead.add(id));
      if (newDest && newDest.sectionId) resolveAncestors(newDest.sectionId).forEach((id) => sectionIdsToRead.add(id));
      for (const id of sectionIdsToRead) {
        if (!sectionDocs[id]) {
          const snap = await tx.get(admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(id));
          if (snap.exists) sectionDocs[id] = snap.data();
        }
      }

      const sourceIdsToRead = new Set();
      if (oldDest && oldDest.sourceId) sourceIdsToRead.add(oldDest.sourceId);
      if (newDest && newDest.sourceId) sourceIdsToRead.add(newDest.sourceId);
      const sourceDocs = {};
      for (const id of sourceIdsToRead) {
        const snap = await tx.get(admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(id));
        if (snap.exists) sourceDocs[id] = snap.data();
      }

      const delta = computeClassificationDeltaServer(oldDest, newDest, (sectionId) => ancestorIdsByLeaf[sectionId] || []);

      const questionPayload = {
        documentSourceId: (newDest && newDest.sourceId) || null,
        documentSectionId: (newDest && newDest.sectionId) || null,
        classificationVersion: (question.classificationVersion || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      if (extraFields && extraFields.functionalCode) questionPayload.functionalCode = extraFields.functionalCode;
      tx.update(questionRef, questionPayload);

      Object.keys(delta.sourceDeltas).forEach((id) => {
        const current = (sourceDocs[id] && sourceDocs[id].questionCount) || 0;
        const clamped = clampNonNegativeServer(current + delta.sourceDeltas[id]);
        if (clamped.wasClamped) inconsistencies.push(`Le compteur de la source "${id}" serait devenu négatif (corrigé à 0) — réconciliation recommandée.`);
        tx.update(admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(id), { questionCount: clamped.value });
      });
      Object.keys(delta.sectionDeltas).forEach((id) => {
        const currentDirect = (sectionDocs[id] && sectionDocs[id].directQuestionCount) || 0;
        const currentTotal = (sectionDocs[id] && sectionDocs[id].totalQuestionCount) || 0;
        const clampedDirect = clampNonNegativeServer(currentDirect + delta.sectionDeltas[id].direct);
        const clampedTotal = clampNonNegativeServer(currentTotal + delta.sectionDeltas[id].total);
        if (clampedDirect.wasClamped || clampedTotal.wasClamped) inconsistencies.push(`Le compteur de la section "${id}" serait devenu négatif (corrigé à 0) — réconciliation recommandée.`);
        tx.update(admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(id), { directQuestionCount: clampedDirect.value, totalQuestionCount: clampedTotal.value });
      });

      return { noop: false, questionPayload };
    });

    if (result.noop) {
      return res.json({ status: "success", message: "Aucune modification nécessaire (destination identique).", inconsistencies: [] });
    }

    if (inconsistencies.length > 0) {
      await logAuditEvent(req.user.uid, "document_count_inconsistency_detected", pedagogicalId, inconsistencies.join(" | "));
    }
    await logAuditEvent(req.user.uid, "document_counts_updated", pedagogicalId, JSON.stringify(result.questionPayload));

    res.json({ status: "success", message: "Question et compteurs mis à jour de façon cohérente.", inconsistencies });
  } catch (err) {
    console.error("[document-classification/apply-single]", pedagogicalId, err && err.message);
    res.status(err.message === "QUESTION_NOT_FOUND" ? 404 : 500).json({
      status: "error",
      message: `La mise à jour transactionnelle a échoué (${err && err.message}).`,
      inconsistencies: [],
    });
  }
});

// Reprend applyAggregatedCounterDeltas() de document-count-service.js :
// applique une structure de deltas DEJA agregee (voir prepareBulkDeltas(),
// reste cote client - pure, sans Firestore) - une transaction PAR document
// affecte, jamais une transaction unique portant sur tout le lot. Utilisee
// par applyBulkClassificationDeltas() (reclassement en masse) APRES que le
// front a deja ecrit chaque question via PATCH /api/questions/:id/classification.
app.post("/api/document-classification/apply-aggregated-counters", requireAuth, async (req, res) => {
  const aggregated = (req.body && req.body.aggregated) || { sourceDeltas: {}, sectionDeltas: {} };
  const inconsistencies = [];
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ inconsistencies: [] });
    }

    for (const sourceId of Object.keys(aggregated.sourceDeltas || {})) {
      const delta = aggregated.sourceDeltas[sourceId];
      if (!delta) continue;
      try {
        await admin.firestore().runTransaction(async (tx) => {
          const ref = admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(sourceId);
          const snap = await tx.get(ref);
          const current = snap.exists ? (snap.data().questionCount || 0) : 0;
          const clamped = clampNonNegativeServer(current + delta);
          if (clamped.wasClamped) inconsistencies.push(`Le compteur de la source "${sourceId}" serait devenu négatif (corrigé à 0) — réconciliation recommandée.`);
          tx.update(ref, { questionCount: clamped.value });
        });
      } catch (err) {
        console.error("[document-classification/apply-aggregated-counters:source]", sourceId, err && err.code, err);
        inconsistencies.push(`Impossible de mettre à jour le compteur de la source "${sourceId}" — réconciliation recommandée.`);
      }
    }

    for (const sectionId of Object.keys(aggregated.sectionDeltas || {})) {
      const d = aggregated.sectionDeltas[sectionId];
      if (!d || (d.direct === 0 && d.total === 0)) continue;
      try {
        await admin.firestore().runTransaction(async (tx) => {
          const ref = admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(sectionId);
          const snap = await tx.get(ref);
          const currentDirect = snap.exists ? (snap.data().directQuestionCount || 0) : 0;
          const currentTotal = snap.exists ? (snap.data().totalQuestionCount || 0) : 0;
          const clampedDirect = clampNonNegativeServer(currentDirect + d.direct);
          const clampedTotal = clampNonNegativeServer(currentTotal + d.total);
          if (clampedDirect.wasClamped || clampedTotal.wasClamped) inconsistencies.push(`Le compteur de la section "${sectionId}" serait devenu négatif (corrigé à 0) — réconciliation recommandée.`);
          tx.update(ref, { directQuestionCount: clampedDirect.value, totalQuestionCount: clampedTotal.value });
        });
      } catch (err) {
        console.error("[document-classification/apply-aggregated-counters:section]", sectionId, err && err.code, err);
        inconsistencies.push(`Impossible de mettre à jour le compteur de la section "${sectionId}" — réconciliation recommandée.`);
      }
    }

    if (inconsistencies.length > 0) {
      await logAuditEvent(req.user.uid, "document_count_inconsistency_detected", "application de deltas agrégés", inconsistencies.join(" | "));
    }

    res.json({ inconsistencies });
  } catch (err) {
    console.error("[document-classification/apply-aggregated-counters]", err && err.code, err);
    res.status(500).json({ inconsistencies });
  }
});

const COMPETENCIES_COLLECTION = "competencies";

async function getVisibleCompetency(competencyId, requesterUid, requesterIsAdminCache) {
  const snap = await admin.firestore().collection(COMPETENCIES_COLLECTION).doc(competencyId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status === "published") return data;
  if (requesterIsAdminCache.value === null) {
    requesterIsAdminCache.value = await isRequesterAdmin(requesterUid);
  }
  return requesterIsAdminCache.value ? data : null;
}

// Reprend getCompetencyById()/getCompetenciesByIds() de
// js/services/competency-catalog-service.js (fiches liees a un parcours,
// resolution d'affichage dans evaluation.js/evaluation-result.js/Mes
// competences). Meme regle que firestore.rules (match /competencies/{id}) :
// publiee = tout utilisateur authentifie, sinon admin uniquement -
// verifiee document par document (un lot peut melanger publie/brouillon).
app.get("/api/competencies", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return res.json({});
  try {
    const adminCache = { value: null };
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(
      uniqueIds.map((id) => getVisibleCompetency(id, req.user.uid, adminCache))
    );
    const map = {};
    uniqueIds.forEach((id, i) => {
      if (results[i]) map[id] = results[i];
    });
    res.json(map);
  } catch (err) {
    console.error("[competencies]", err && err.code, err);
    res.status(500).json({});
  }
});

function buildCompetenciesFilterClauses(query, filters) {
  const f = filters || {};
  let q = query;
  if (f.status) q = q.where("status", "==", f.status);
  if (f.category) q = q.where("category", "==", f.category);
  if (f.author) q = q.where("author", "==", f.author);
  return q;
}

// Reprend queryCompetenciesPage() de js/services/competency-catalog-
// service.js (Banque des competences, admin). Meme regle que ci-dessus :
// filtre status=='published' ouvert a tout utilisateur authentifie, tout
// autre cas exige isRequesterAdmin().
app.get("/api/competencies/page", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const pageSize = boundedNumberParam(req.query.pageSize, 25, 100);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (filters.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], lastDoc: null, hasMore: false, error: "Accès refusé" });
    }
    let q = buildCompetenciesFilterClauses(admin.firestore().collection(COMPETENCIES_COLLECTION), filters);
    q = q.orderBy(sortField, sortDirection).limit(pageSize + 1);
    if (req.query.cursor) {
      try { q = q.startAfter(JSON.parse(req.query.cursor)); } catch { /* curseur invalide, ignore */ }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, pageSize);
    res.json({
      items: docs.map((d) => d.data()),
      lastCursor: docs.length ? JSON.stringify(docs[docs.length - 1].data()[sortField]) : null,
      hasMore: snap.docs.length > pageSize,
      error: false,
    });
  } catch (err) {
    console.error("[competencies/page]", err && err.code, err);
    res.status(500).json({ items: [], lastDoc: null, hasMore: false, error: true });
  }
});

// Reprend searchCompetenciesBounded(). Meme regle que ci-dessus.
app.get("/api/competencies/search-bounded", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const scanLimit = boundedNumberParam(req.query.maxScan, 500, 2000);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (filters.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], truncated: false, error: "Accès refusé" });
    }
    let q = buildCompetenciesFilterClauses(admin.firestore().collection(COMPETENCIES_COLLECTION), filters);
    q = q.orderBy(sortField, sortDirection).limit(scanLimit + 1);
    const snap = await q.get();
    const all = snap.docs.map((d) => d.data());
    res.json({ items: all.slice(0, scanLimit), truncated: all.length > scanLimit, error: false, scanLimit });
  } catch (err) {
    console.error("[competencies/search-bounded]", err && err.code, err);
    res.status(500).json({ items: [], truncated: false, error: true, scanLimit });
  }
});

// Reprend createCompetencyDocument() de js/services/competency-catalog-
// service.js. Meme regle "create" que firestore.rules : isRequesterAdmin(),
// id == identifiant du document, statut TOUJOURS 'draft'.
app.post("/api/competencies", requireAuth, async (req, res) => {
  const competencyDocument = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    if (!competencyDocument.id || competencyDocument.status !== "draft") return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(COMPETENCIES_COLLECTION).doc(competencyDocument.id);
    if ((await ref.get()).exists) return res.status(409).json({ success: false, error: true });
    await ref.set(competencyDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[competencies:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateCompetencyFields() de js/services/competency-catalog-
// service.js (edition complete). Meme regle "update n°1" : isRequesterAdmin(),
// id ET statut inchanges.
app.patch("/api/competencies/:id/fields", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(COMPETENCIES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    if ("status" in fields && fields.status !== snap.data().status) return res.status(403).json({ success: false, error: true });
    await ref.update({ ...fields, updatedAt: new Date().toISOString() });
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[competencies/:id/fields]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateCompetencyStatus(). Combine les regles "update n°2"
// (transitions generales draft/published/archived) et "n°2b"
// (Archive<->Corbeille).
const COMPETENCY_STATUS_GENERAL_TARGETS = ["draft", "published", "archived"];
app.patch("/api/competencies/:id/status", requireAuth, async (req, res) => {
  const newStatus = req.body && req.body.status;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(COMPETENCIES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const oldStatus = snap.data().status;
    const generalOk = oldStatus !== "trash" && COMPETENCY_STATUS_GENERAL_TARGETS.includes(newStatus);
    const trashOk = (oldStatus === "archived" && newStatus === "trash") || (oldStatus === "trash" && newStatus === "archived");
    if (!generalOk && !trashOk) return res.status(403).json({ success: false, error: true });
    await ref.update({ status: newStatus, updatedAt: new Date().toISOString() });
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[competencies/:id/status]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend publishAllDraftCompetencies().
app.post("/api/competencies/publish-all-draft", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, publishedCount: 0, error: true });
    const snap = await admin.firestore().collection(COMPETENCIES_COLLECTION).where("status", "==", "draft").limit(2000).get();
    const refs = snap.docs.map((d) => d.ref);
    const CHUNK_SIZE = 400;
    const now = new Date().toISOString();
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = admin.firestore().batch();
      refs.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.update(ref, { status: "published", updatedAt: now }));
      await batch.commit();
    }
    res.json({ success: true, publishedCount: refs.length, error: false });
  } catch (err) {
    console.error("[competencies/publish-all-draft]", err && err.code, err);
    res.status(500).json({ success: false, publishedCount: 0, error: true });
  }
});

// Reprend deleteCompetencyDocument(). Meme regle "delete" : isRequesterAdmin(),
// uniquement depuis la corbeille.
app.delete("/api/competencies/:id", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(COMPETENCIES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ success: true, error: false });
    if (snap.data().status !== "trash") return res.status(403).json({ success: false, error: true });
    await ref.delete();
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[competencies/:id:delete]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend logCompetencyAction() de js/services/competency-audit-service.js.
// Meme regle que firestore.rules (match /competency_audit_logs/{logId}) :
// isRequesterAdmin(), adminUid == demandeur.
app.post("/api/competency-audit-logs", requireAuth, async (req, res) => {
  const entry = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false });
    if (entry.adminUid !== req.user.uid) return res.status(403).json({ success: false });
    await admin.firestore().collection("competency_audit_logs").add({
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || "",
      competencyId: entry.competencyId || null,
      actionType: entry.actionType || "unknown",
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : "",
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[competency-audit-logs:post]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

const PARCOURS_COLLECTION_FOR_GETBYID = "parcours";

function buildParcoursFilterClauses(query, filters) {
  const f = filters || {};
  let q = query;
  if (f.status) q = q.where("status", "==", f.status);
  if (f.author) q = q.where("author", "==", f.author);
  // AJOUT (chantier "Mes parcours en self-service" / "Mon organisation",
  // demande directe de David, 28/07/2026) : organizationId===null cible le
  // catalogue global (self-service), une valeur precise cible les
  // parcours propres a une organisation (ex. cours d'universite) -
  // Firestore supporte nativement l'egalite avec null.
  if (Object.prototype.hasOwnProperty.call(f, "organizationId")) {
    q = q.where("organizationId", "==", f.organizationId);
  }
  if (Object.prototype.hasOwnProperty.call(f, "editorialOnly")) {
    q = q.where("editorialOnly", "==", f.editorialOnly);
  }
  return q;
}

// Reprend queryParcoursPage() de js/services/parcours-catalog-service.js
// (Banque de parcours, admin). Meme regle que firestore.rules : un filtre
// status=='published' est ouvert a tout utilisateur authentifie, tout
// AUTRE cas (pas de filtre, ou un statut non-publie) exige isRequesterAdmin() -
// jamais de fuite d'un parcours non publie via un filtre absent.
app.get("/api/parcours", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const pageSize = boundedNumberParam(req.query.pageSize, 25, 100);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (filters.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], lastDoc: null, hasMore: false, error: "Accès refusé" });
    }
    let q = buildParcoursFilterClauses(admin.firestore().collection(PARCOURS_COLLECTION_FOR_GETBYID), filters);
    q = q.orderBy(sortField, sortDirection).limit(pageSize + 1);
    if (req.query.cursor) {
      // Curseur = valeur brute du champ de tri sur le dernier document de la
      // page precedente (ex. une chaine ISO pour createdAt - jamais un
      // Timestamp Firestore ici, contrairement a evaluation_sessions/
      // evaluation_results : parcours/competencies stockent createdAt en
      // ISO string, voir parcours-service.js). Encodee en JSON pour
      // preserver le type exact (nombre, chaine...) a travers l'URL.
      try { q = q.startAfter(JSON.parse(req.query.cursor)); } catch { /* curseur invalide, ignore */ }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, pageSize);
    res.json({
      items: docs.map((d) => d.data()),
      lastCursor: docs.length ? JSON.stringify(docs[docs.length - 1].data()[sortField]) : null,
      hasMore: snap.docs.length > pageSize,
      error: false,
    });
  } catch (err) {
    console.error("[parcours]", err && err.code, err);
    res.status(500).json({ items: [], lastDoc: null, hasMore: false, error: true });
  }
});

// Reprend searchParcoursBounded(). Meme regle que ci-dessus.
app.get("/api/parcours/search-bounded", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const scanLimit = boundedNumberParam(req.query.maxScan, 500, 2000);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (filters.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], truncated: false, error: "Accès refusé" });
    }
    let q = buildParcoursFilterClauses(admin.firestore().collection(PARCOURS_COLLECTION_FOR_GETBYID), filters);
    q = q.orderBy(sortField, sortDirection).limit(scanLimit + 1);
    const snap = await q.get();
    const all = snap.docs.map((d) => d.data());
    res.json({ items: all.slice(0, scanLimit), truncated: all.length > scanLimit, error: false, scanLimit });
  } catch (err) {
    console.error("[parcours/search-bounded]", err && err.code, err);
    res.status(500).json({ items: [], truncated: false, error: true, scanLimit });
  }
});

// Reprend getParcoursById() de js/services/parcours-catalog-service.js
// (evaluation.js/evaluation-result.js, resolution d'affichage lors d'une
// evaluation liee a un parcours ; createAssignment() cote admin). Meme
// regle que firestore.rules (match /parcours/{id}) : publie = tout
// utilisateur authentifie, sinon admin uniquement.
app.get("/api/parcours/:id", requireAuth, async (req, res) => {
  try {
    const snap = await admin.firestore().collection(PARCOURS_COLLECTION_FOR_GETBYID).doc(req.params.id).get();
    if (!snap.exists) return res.json({ data: null, error: false });
    const data = snap.data();
    if (data.status !== "published" && !(await isRequesterAdmin(req.user.uid))) {
      return res.json({ data: null, error: false });
    }
    res.json({ data, error: false });
  } catch (err) {
    console.error("[parcours/:id]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend createParcoursDocument() de js/services/parcours-catalog-service.js.
// Meme regle "create" que firestore.rules : isRequesterAdmin(), id ==
// identifiant du document, statut TOUJOURS 'draft'. Refuse un doublon.
app.post("/api/parcours", requireAuth, async (req, res) => {
  const parcoursDocument = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    if (!parcoursDocument.id || parcoursDocument.status !== "draft") return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(PARCOURS_COLLECTION).doc(parcoursDocument.id);
    if ((await ref.get()).exists) return res.status(409).json({ success: false, error: true });
    await ref.set(parcoursDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[parcours:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateParcoursFields() de js/services/parcours-catalog-service.js
// (edition complete). Meme regle "update n°1" : isRequesterAdmin(), id ET
// statut inchanges - jamais un changement de statut "au passage".
app.patch("/api/parcours/:id/fields", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(PARCOURS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    if ("status" in fields && fields.status !== snap.data().status) return res.status(403).json({ success: false, error: true });
    await ref.update({ ...fields, updatedAt: new Date().toISOString() });
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[parcours/:id/fields]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateParcoursStatus() de js/services/parcours-catalog-service.js.
// Combine les regles "update n°2" (transitions generales) et "n°2b"
// (Archive<->Corbeille), meme principe que /api/questions/:id/status.
const PARCOURS_STATUS_GENERAL_TARGETS = ["draft", "review", "published", "archived"];
app.patch("/api/parcours/:id/status", requireAuth, async (req, res) => {
  const newStatus = req.body && req.body.status;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(PARCOURS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const oldStatus = snap.data().status;
    const generalOk = oldStatus !== "trash" && PARCOURS_STATUS_GENERAL_TARGETS.includes(newStatus);
    const trashOk = (oldStatus === "archived" && newStatus === "trash") || (oldStatus === "trash" && newStatus === "archived");
    if (!generalOk && !trashOk) return res.status(403).json({ success: false, error: true });
    await ref.update({ status: newStatus, updatedAt: new Date().toISOString() });
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[parcours/:id/status]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend deleteParcoursDocument() de js/services/parcours-catalog-service.js.
// Meme regle "delete" : isRequesterAdmin(), uniquement depuis la corbeille.
app.delete("/api/parcours/:id", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false, error: true });
    const ref = admin.firestore().collection(PARCOURS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ success: true, error: false });
    if (snap.data().status !== "trash") return res.status(403).json({ success: false, error: true });
    await ref.delete();
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[parcours/:id:delete]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend logParcoursAction() de js/services/parcours-audit-service.js.
// Meme regle que firestore.rules (match /parcours_audit_logs/{logId}) :
// isRequesterAdmin(), adminUid == demandeur.
app.post("/api/parcours-audit-logs", requireAuth, async (req, res) => {
  const entry = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false });
    if (entry.adminUid !== req.user.uid) return res.status(403).json({ success: false });
    await admin.firestore().collection("parcours_audit_logs").add({
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || "",
      parcoursId: entry.parcoursId || null,
      actionType: entry.actionType || "unknown",
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : "",
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[parcours-audit-logs:post]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

const USERS_LIST_FETCH_LIMIT = 500;

// Reprend fetchAllUsersBounded() de js/services/user-management-service.js
// (admin/users.js via user-directory-service.js, et la recherche de cible
// utilisateur pour une attribution). Lecture de TOUS les utilisateurs :
// reservee aux administrateurs, meme principe que firestore.rules
// (match /users/{userId} - lecture de la fiche d'un tiers = isRequesterAdmin()).
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], truncated: false, error: "Accès refusé" });
    }
    const snap = await admin
      .firestore()
      .collection("users")
      .orderBy("createdAt", "desc")
      .limit(USERS_LIST_FETCH_LIMIT + 1)
      .get();
    const all = snap.docs.map((d) => d.data());
    const truncated = all.length > USERS_LIST_FETCH_LIMIT;
    res.json({ items: all.slice(0, USERS_LIST_FETCH_LIMIT), truncated, error: false });
  } catch (err) {
    console.error("[users]", err && err.code, err);
    res.status(500).json({ items: [], truncated: false, error: true });
  }
});

// =========================================================================
// Reprend js/services/admin-service.js (changeRole/changeUserStatus) +
// js/services/user-management-service.js (updateUserRole/updateUserStatus/
// countActiveAdmins). MEME regle "update n°2" que firestore.rules
// (isRequesterAdmin(), jamais sur soi-meme, hasOnly(['role','status'])) -
// mais AJOUTE ICI la protection "toujours au moins un administrateur actif"
// de facon reellement ATOMIQUE (transaction Firestore), ce que le
// commentaire d'origine de admin-service.js signalait explicitement comme
// une limite connue ("protection appliquee UNIQUEMENT au niveau
// applicatif... une protection serveur plus robuste devra etre mise en
// place ulterieurement") : deux requetes concurrentes ne peuvent plus
// toutes les deux passer le controle de comptage avant qu'aucune n'ait
// encore ecrit, ce qui aurait pu laisser la plateforme sans administrateur.
// =========================================================================

// Reprend logAction() de js/services/audit-service.js. Meme regle que
// firestore.rules (match /audit_logs/{logId}) : isRequesterAdmin(),
// adminUid == demandeur. Appelee SEPAREMENT par le client apres chaque
// action sensible (role/statut/champs metier) - jamais automatiquement
// par les routes ci-dessous, pour eviter une double journalisation (une
// version anterieure de ce fichier journalisait ICI ET le client
// journalisait aussi de son cote ; corrige au profit d'un point unique,
// comme pour question/parcours/competency-audit-logs).
app.post("/api/audit-logs", requireAuth, async (req, res) => {
  const entry = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false });
    if (entry.adminUid !== req.user.uid) return res.status(403).json({ success: false });
    await admin.firestore().collection("audit_logs").add({
      date: new Date().toISOString(),
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || "",
      targetUid: entry.targetUid || null,
      targetEmail: entry.targetEmail || "",
      actionType: entry.actionType || "unknown",
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : "",
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[audit-logs:post]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

app.patch("/api/users/:uid/role", requireAuth, async (req, res) => {
  const targetUid = req.params.uid;
  const newRole = req.body && req.body.newRole;
  if (targetUid === req.user.uid) {
    return res.status(403).json({ status: "denied", message: "Vous ne pouvez pas modifier votre propre rôle." });
  }
  if (!["user", "admin", "teacher", "manager"].includes(newRole)) {
    return res.status(400).json({ status: "error", message: "Rôle demandé invalide." });
  }
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ status: "denied", message: "Cette action est réservée aux administrateurs." });
    }
    const usersCol = admin.firestore().collection("users");
    try {
      await admin.firestore().runTransaction(async (tx) => {
        const targetSnap = await tx.get(usersCol.doc(targetUid));
        if (!targetSnap.exists) throw new Error("TARGET_NOT_FOUND");
        const target = targetSnap.data();
        const oldRole = target.role || "user";
        if (oldRole === newRole) throw new Error("SAME_ROLE");

        if (oldRole === "admin" && newRole !== "admin") {
          const activeAdminsSnap = await tx.get(usersCol.where("role", "==", "admin").where("status", "==", "active"));
          if (activeAdminsSnap.size <= 1) throw new Error("LAST_ADMIN");
        }
        tx.update(targetSnap.ref, { role: newRole });
      });
    } catch (txErr) {
      if (txErr.message === "TARGET_NOT_FOUND") return res.status(404).json({ status: "error", message: "Utilisateur cible introuvable." });
      if (txErr.message === "SAME_ROLE") return res.status(409).json({ status: "denied", message: "Cet utilisateur possède déjà ce rôle." });
      if (txErr.message === "LAST_ADMIN") {
        return res.status(409).json({ status: "denied", message: "Impossible de retirer ce rôle : il s'agit du dernier administrateur actif de la plateforme. Désignez d'abord un autre administrateur." });
      }
      throw txErr;
    }

    res.json({ status: "success" });
  } catch (err) {
    console.error("[users/:uid/role]", err && err.code, err);
    res.status(500).json({ status: "error", message: "La mise à jour du rôle a échoué. Veuillez réessayer." });
  }
});

app.patch("/api/users/:uid/status", requireAuth, async (req, res) => {
  const targetUid = req.params.uid;
  const newStatus = req.body && req.body.newStatus;
  if (targetUid === req.user.uid) {
    return res.status(403).json({ status: "denied", message: "Vous ne pouvez pas modifier votre propre statut." });
  }
  if (!["pending", "active", "suspended"].includes(newStatus)) {
    return res.status(400).json({ status: "error", message: "Statut demandé invalide." });
  }
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ status: "denied", message: "Cette action est réservée aux administrateurs." });
    }
    const usersCol = admin.firestore().collection("users");
    try {
      await admin.firestore().runTransaction(async (tx) => {
        const targetSnap = await tx.get(usersCol.doc(targetUid));
        if (!targetSnap.exists) throw new Error("TARGET_NOT_FOUND");
        const target = targetSnap.data();
        const oldStatus = target.status || "active";
        if (oldStatus === newStatus) throw new Error("SAME_STATUS");

        const targetRole = target.role || "user";
        if (targetRole === "admin" && oldStatus === "active" && newStatus === "suspended") {
          const activeAdminsSnap = await tx.get(usersCol.where("role", "==", "admin").where("status", "==", "active"));
          if (activeAdminsSnap.size <= 1) throw new Error("LAST_ADMIN");
        }
        tx.update(targetSnap.ref, { status: newStatus });
      });
    } catch (txErr) {
      if (txErr.message === "TARGET_NOT_FOUND") return res.status(404).json({ status: "error", message: "Utilisateur cible introuvable." });
      if (txErr.message === "SAME_STATUS") return res.status(409).json({ status: "denied", message: "Cet utilisateur possède déjà ce statut." });
      if (txErr.message === "LAST_ADMIN") {
        return res.status(409).json({ status: "denied", message: "Impossible de suspendre ce compte : il s'agit du dernier administrateur actif de la plateforme. Désignez d'abord un autre administrateur." });
      }
      throw txErr;
    }

    res.json({ status: "success" });
  } catch (err) {
    console.error("[users/:uid/status]", err && err.code, err);
    res.status(500).json({ status: "error", message: "La mise à jour du statut a échoué. Veuillez réessayer." });
  }
});

// Reprend updateUserBusinessFields() (champs metier Sprint 14). Meme regle
// "update n°3" que firestore.rules : isRequesterAdmin(), hasOnly sur ces 5
// champs uniquement, autorise sur N'IMPORTE QUEL document (y compris le
// sien - aucune incidence sur les permissions).
const USER_BUSINESS_FIELD_KEYS = ["firstName", "lastName", "organizationId", "profileId", "groupIds"];
app.patch("/api/users/:uid/business-fields", requireAuth, async (req, res) => {
  const targetUid = req.params.uid;
  const fields = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ status: "denied", message: "Cette action est réservée aux administrateurs." });
    }
    if (!Object.keys(fields).every((k) => USER_BUSINESS_FIELD_KEYS.includes(k))) {
      return res.status(403).json({ status: "error", message: "Champ non autorisé." });
    }
    const ref = admin.firestore().collection("users").doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: "error", message: "Utilisateur cible introuvable." });
    await ref.update(fields);
    res.json({ status: "success" });
  } catch (err) {
    console.error("[users/:uid/business-fields]", err && err.code, err);
    res.status(500).json({ status: "error", message: "L'enregistrement des modifications a échoué. Veuillez réessayer." });
  }
});

const AUDIT_LOGS_COLLECTION = "audit_logs";
const DEFAULT_AUDIT_READ_LIMIT = 50;

// Reprend getRecentAuditEntries() de js/services/audit-service.js (journal
// d'audit, fiche utilisateur admin + tableau de bord admin). Meme regle
// que firestore.rules (match /audit_logs/{logId}) : administrateurs
// uniquement, sans exception (peut contenir des infos sur n'importe qui).
app.get("/api/audit-logs", requireAuth, async (req, res) => {
  const max = boundedNumberParam(req.query.limit, DEFAULT_AUDIT_READ_LIMIT, 500);
  const { targetUid } = req.query;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    let q = admin.firestore().collection(AUDIT_LOGS_COLLECTION);
    if (targetUid) q = q.where("targetUid", "==", targetUid);
    q = q.orderBy("date", "desc").limit(max);

    const snap = await q.get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[audit-logs]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

const QUESTION_PROGRESS_COLLECTION = "question_progress";

// Reprend getAllQuestionProgressForUser() de
// js/services/question-progress-catalog-service.js (progression globale
// de l'accueil, Mes competences, classification du pool Entrainement
// libre). Toujours le requerant lui-meme (ctx.uid chez tous les
// appelants reels) - pas de bypass admin necessaire.
app.get("/api/question-progress", requireAuth, async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection(QUESTION_PROGRESS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[question-progress]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend getQuestionProgressForMany() de js/services/question-progress-
// catalog-service.js (verification du pool Entrainement libre, progression
// d'un parcours). Toujours le requerant lui-meme (ctx.uid/uid chez tous les
// appelants reels, jamais un tiers, meme regle que firestore.rules) -
// enregistree AVANT la route parametree /:pedagogicalId ci-dessous (sinon
// "many" y serait intercepte comme un identifiant de question).
app.get("/api/question-progress/many", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return res.json({});
  try {
    const results = await Promise.all(uniqueIds.map(async (pid) => {
      const snap = await admin.firestore().collection(QUESTION_PROGRESS_COLLECTION).doc(`${req.user.uid}_${pid}`).get();
      return { pedagogicalId: pid, data: snap.exists ? snap.data() : null };
    }));
    const map = {};
    results.forEach((r) => { map[r.pedagogicalId] = r.data; }); // null explicitement conserve = "jamais vue"
    res.json(map);
  } catch (err) {
    console.error("[question-progress/many]", err && err.code, err);
    res.status(500).json({});
  }
});

const APPLIED_RESULTS_COLLECTION = "question_progress_applied_results";

// Reprend applyEvaluationResultIfNew() de js/services/question-progress-
// catalog-service.js - POINT D'ENTREE UNIQUE pour appliquer un resultat
// d'evaluation a la progression par question, avec la MEME garantie
// d'idempotence qu'auparavant cote client (un marqueur
// question_progress_applied_results/{resultId} pose dans une TRANSACTION
// avant tout increment - si le marqueur existe deja, no-op silencieux).
//
// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : les `entries`
// (quelle question, correcte ou non) ne sont PLUS jamais acceptees
// depuis le corps de la requete - un utilisateur pouvait auparavant
// gonfler sa progression en envoyant n'importe quelle liste avec
// `isCorrect:true`, sans rapport avec ses reponses reelles. Les entrees
// sont desormais DERIVEES exclusivement du document `evaluation_results`
// deja enregistre (lui-meme recalcule server-side, voir POST
// /api/evaluation-results ci-dessus) - seul `resultId` reste fourni par
// le client, pour identifier QUEL resultat appliquer.
app.post("/api/question-progress/apply", requireAuth, async (req, res) => {
  const { resultId } = req.body || {};
  if (!resultId) {
    return res.status(403).json({ success: false, applied: false, error: true });
  }

  let entries;
  let resultData;
  try {
    const resultSnap = await admin.firestore().collection(EVALUATION_RESULTS_COLLECTION).doc(resultId).get();
    if (!resultSnap.exists || resultSnap.data().userId !== req.user.uid) {
      return res.status(403).json({ success: false, applied: false, error: true });
    }
    resultData = resultSnap.data();
    entries = [];
    (resultData.competencyResults || []).forEach((cr) => {
      (cr.questionResults || []).forEach((qr) => {
        entries.push({ userId: resultData.userId, pedagogicalId: qr.pedagogicalId, isCorrect: qr.status === "correct" });
      });
    });
  } catch (err) {
    console.error("[question-progress/apply:check]", err && err.code, err);
    return res.status(500).json({ success: false, applied: false, error: true });
  }

  const markerRef = admin.firestore().collection(APPLIED_RESULTS_COLLECTION).doc(resultId);
  let alreadyApplied = false;
  try {
    await admin.firestore().runTransaction(async (tx) => {
      const markerSnap = await tx.get(markerRef);
      if (markerSnap.exists) {
        alreadyApplied = true;
        return;
      }
      tx.set(markerRef, { resultId, appliedAt: new Date().toISOString() });
    });
  } catch (err) {
    console.error("[question-progress/apply:marker]", err && err.code, err);
    return res.status(500).json({ success: false, applied: false, error: true });
  }

  if (alreadyApplied) {
    return res.json({ success: true, applied: false, error: false });
  }

  const nowIso = new Date().toISOString();
  const lastSessionType = resultData.dailyChallengeDate
    ? "daily_challenge"
    : (resultData.sessionType || "free_training");
  try {
    await Promise.all(entries.map((e) => {
      const ref = admin.firestore().collection(QUESTION_PROGRESS_COLLECTION).doc(`${e.userId}_${e.pedagogicalId}`);
      return ref.set({
        userId: e.userId,
        pedagogicalId: e.pedagogicalId,
        timesSeen: FieldValue.increment(1),
        timesCorrect: FieldValue.increment(e.isCorrect ? 1 : 0),
        lastSeenAt: nowIso,
        lastStatus: e.isCorrect ? "correct" : "not_correct",
        lastSessionType: lastSessionType,
      }, { merge: true });
    }));
    res.json({ success: true, applied: true, error: false });
  } catch (err) {
    console.error("[question-progress/apply:increment]", err && err.code, err);
    // le marqueur EST pose (meme limite honnete que la version client) -
    // ne jamais presenter ce cas comme "non applique" a ce stade
    res.status(500).json({ success: false, applied: true, error: true });
  }
});

// CORRECTIF (bug 01/08/2026, resultData hors scope dans /apply) : reconstruit
// question_progress depuis zero a partir de tous les evaluation_results de
// l'utilisateur, sans passer par le systeme de marqueurs (bypasse les
// marqueurs poses alors que les increments n'avaient pas ete ecrits). Peut
// etre appele plusieurs fois sans danger (set sans merge = toujours correct).
app.post("/api/question-progress/rebuild", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const snap = await admin.firestore()
      .collection(EVALUATION_RESULTS_COLLECTION)
      .where("userId", "==", uid)
      .get();

    const progressMap = new Map();
    const docs = snap.docs.map((d) => d.data()).sort(function(a, b) {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
    docs.forEach((resultData) => {
      const sessionType = resultData.dailyChallengeDate
        ? "daily_challenge"
        : (resultData.sessionType || "free_training");
      (resultData.competencyResults || []).forEach((cr) => {
        (cr.questionResults || []).forEach((qr) => {
          const pid = qr.pedagogicalId;
          if (!pid) return;
          const p = progressMap.get(pid) || { timesCorrect: 0, timesSeen: 0, lastSeenAt: null, lastStatus: null, lastSessionType: null };
          p.timesSeen += 1;
          if (qr.status === "correct") p.timesCorrect += 1;
          p.lastSeenAt = resultData.createdAt || p.lastSeenAt;
          p.lastStatus = qr.status === "correct" ? "correct" : "not_correct";
          p.lastSessionType = sessionType;
          progressMap.set(pid, p);
        });
      });
    });

    await Promise.all(Array.from(progressMap.entries()).map(([pedagogicalId, p]) => {
      const ref = admin.firestore().collection(QUESTION_PROGRESS_COLLECTION).doc(`${uid}_${pedagogicalId}`);
      return ref.set({ userId: uid, pedagogicalId, timesCorrect: p.timesCorrect, timesSeen: p.timesSeen, lastSeenAt: p.lastSeenAt, lastStatus: p.lastStatus, lastSessionType: p.lastSessionType });
    }));

    res.json({ success: true, questionsRebuilt: progressMap.size, error: false });
  } catch (err) {
    console.error("[question-progress/rebuild]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend getAllResultsForUser() de
// js/services/evaluation-result-catalog-service.js (reconciliation de
// progression, "Activite recente" de l'accueil via recent-activity-
// service.js). Toujours le requerant lui-meme, documents bruts (pas la
// normalisation de history-service.js, usage different).
app.get("/api/evaluation-results", requireAuth, async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_RESULTS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .get();
    const items = snap.docs.map((d) => d.data());
    res.json({ items, error: false });
  } catch (err) {
    console.error("[evaluation-results]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend getResultById() de js/services/evaluation-result-catalog-service.js
// (page de resultat d'evaluation). Meme regle que firestore.rules (match
// /evaluation_results/{resultId}) : proprietaire ou admin, jamais un tiers.
app.get("/api/evaluation-results/:id", requireAuth, async (req, res) => {
  try {
    const snap = await admin.firestore().collection(EVALUATION_RESULTS_COLLECTION).doc(req.params.id).get();
    if (!snap.exists) return res.json({ data: null, error: false });
    const data = snap.data();
    if (data.userId !== req.user.uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.json({ data: null, error: false });
    }
    res.json({ data, error: false });
  } catch (err) {
    console.error("[evaluation-results/:id]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend getRecentEvaluationsForUid() de js/services/history-service.js
// (fiche detaillee admin/users.js). Reservee aux administrateurs - meme
// regle que firestore.rules (isRequesterAdmin() peut lire n'importe quel
// document evaluation_results).
app.get("/api/evaluation-results/for-user/:uid", requireAuth, async (req, res) => {
  const max = boundedNumberParam(req.query.limit, 20, 200);
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    const snap = await admin
      .firestore()
      .collection(EVALUATION_RESULTS_COLLECTION)
      .where("userId", "==", req.params.uid)
      .orderBy("createdAt", "desc")
      .limit(max)
      .get();
    const items = snap.docs.map((d) => { const data = d.data(); if (!data.id) data.id = d.id; return data; });
    res.json({ items, error: false });
  } catch (err) {
    console.error("[evaluation-results/for-user]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend createResultDocument() de js/services/evaluation-result-catalog-
// service.js. Meme regle "create" que firestore.rules : uniquement en son
// propre nom, identifiant du document == sessionId, ecriture unique
// (refuse si un resultat existe deja, jamais un ecrasement), et la
// session correspondante doit exister, appartenir au demandeur et etre
// deja 'submitted' - conditions verifiees ici via un get() explicite,
// comme le fait la regle Firestore.
//
// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : le score et les
// competencyResults envoyes par le client (`resultDocument.score`, etc.)
// ne sont PLUS jamais ecrits tels que recus - un utilisateur pouvait
// auparavant s'auto-attribuer n'importe quel score par simple appel API
// direct, sans passer par l'UI. Le resultat est desormais RECALCULE en
// integralite server-side, via correctEvaluationSession() (copie fidele
// du moteur de correction, functions/lib/), a partir de la session DEJA
// STOCKEE (questionSnapshot + answers, jamais modifiable par le client
// une fois la session soumise) - seuls `resultDocument.userId/id/
// sessionId` servent encore a identifier QUELLE session corriger, jamais
// a fournir le resultat lui-meme.
app.post("/api/evaluation-results", requireAuth, async (req, res) => {
  const resultDocument = req.body || {};
  if (
    resultDocument.userId !== req.user.uid ||
    !resultDocument.id ||
    resultDocument.sessionId !== resultDocument.id
  ) {
    return res.status(403).json({ success: false, error: true });
  }
  try {
    const resultRef = admin.firestore().collection(EVALUATION_RESULTS_COLLECTION).doc(resultDocument.id);
    const existingResult = await resultRef.get();
    if (existingResult.exists) {
      return res.status(409).json({ success: false, error: true });
    }
    const sessionSnap = await admin.firestore().collection(EVALUATION_SESSIONS_COLLECTION).doc(resultDocument.id).get();
    const session = sessionSnap.data();
    if (
      !sessionSnap.exists ||
      session.userId !== req.user.uid ||
      session.status !== "submitted"
    ) {
      return res.status(403).json({ success: false, error: true });
    }
    const computedResult = correctEvaluationSession(session);
    await resultRef.set(computedResult);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[evaluation-results:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

const EVALUATION_SESSIONS_COLLECTION = "evaluation_sessions";

// Reprend findActiveSession() (parcours/competence). Toujours le
// requerant lui-meme (ctx.uid chez tous les appelants reels).
app.get("/api/sessions/active", requireAuth, async (req, res) => {
  const { parcoursId, competencyId } = req.query;
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_SESSIONS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .where("parcoursId", "==", parcoursId || null)
      .where("competencyId", "==", competencyId || null)
      .where("status", "==", "in_progress")
      .limit(1)
      .get();
    res.json({ data: snap.empty ? null : snap.docs[0].data(), error: false });
  } catch (err) {
    console.error("[sessions/active]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend countPreviousAttempts().
app.get("/api/sessions/attempts-count", requireAuth, async (req, res) => {
  const { parcoursId, competencyId } = req.query;
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_SESSIONS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .where("parcoursId", "==", parcoursId || null)
      .where("competencyId", "==", competencyId || null)
      .orderBy("startedAt", "desc")
      .limit(50)
      .get();
    res.json({ count: snap.size, error: false });
  } catch (err) {
    console.error("[sessions/attempts-count]", err && err.code, err);
    res.status(500).json({ count: 0, error: true });
  }
});

// Reprend findActiveFreeTrainingSession() / findActiveDailyChallengeSession()
// - meme requete Firestore que le front (correctif du 22/07/2026), filtre
// dailyChallengeDate applique ICI cote serveur (equivalent du filtre
// cote client d'origine).
app.get("/api/sessions/active-free-training", requireAuth, async (req, res) => {
  const { dailyChallengeDate } = req.query;
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_SESSIONS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .where("sessionType", "==", "free_training")
      .where("status", "==", "in_progress")
      .limit(5)
      .get();
    const items = snap.docs.map((d) => d.data());
    const match = dailyChallengeDate
      ? items.find((s) => s.dailyChallengeDate === dailyChallengeDate)
      : items.find((s) => !s.dailyChallengeDate);
    res.json({ data: match || null, error: false });
  } catch (err) {
    console.error("[sessions/active-free-training]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend countPreviousFreeTrainingAttempts().
app.get("/api/sessions/free-training-attempts-count", requireAuth, async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection(EVALUATION_SESSIONS_COLLECTION)
      .where("userId", "==", req.user.uid)
      .where("sessionType", "==", "free_training")
      .orderBy("startedAt", "desc")
      .limit(50)
      .get();
    res.json({ count: snap.size, error: false });
  } catch (err) {
    console.error("[sessions/free-training-attempts-count]", err && err.code, err);
    res.status(500).json({ count: 0, error: true });
  }
});

// Reprend getSessionById() de js/services/evaluation-session-catalog-service.js
// (reprise/redemarrage d'une session). Meme regle que firestore.rules
// (match /evaluation_sessions/{sessionId}) : proprietaire ou admin.
// DOIT rester APRES les routes statiques ci-dessus (sinon ":id" les
// intercepterait, ex. "active" traite comme un identifiant de session).
app.get("/api/sessions/:id", requireAuth, async (req, res) => {
  try {
    const snap = await admin.firestore().collection(EVALUATION_SESSIONS_COLLECTION).doc(req.params.id).get();
    if (!snap.exists) return res.json({ data: null, error: false });
    const data = snap.data();
    if (data.userId !== req.user.uid && !(await isRequesterAdmin(req.user.uid))) {
      return res.json({ data: null, error: false });
    }
    res.json({ data, error: false });
  } catch (err) {
    console.error("[sessions/:id]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend createSessionDocument() de js/services/evaluation-session-catalog-
// service.js. Meme regle "create" que firestore.rules : uniquement en son
// propre nom, identifiant du document == champ `id` du document,
// TOUJOURS au statut 'in_progress' (jamais une creation directe
// "submitted"/"abandoned" - ces transitions passent par PATCH ci-dessous).
// "Cree une nouvelle session (jamais pour une mise a jour)" (doc source) :
// refuse explicitement si un document existe deja a cet identifiant,
// plutot que de l'ecraser silencieusement (le SDK Admin ignore sinon la
// distinction create/update de firestore.rules).
app.post("/api/sessions", requireAuth, async (req, res) => {
  const sessionDocument = req.body || {};
  if (
    sessionDocument.userId !== req.user.uid ||
    !sessionDocument.id ||
    sessionDocument.status !== "in_progress"
  ) {
    return res.status(403).json({ success: false, error: true });
  }
  try {
    const ref = admin.firestore().collection(EVALUATION_SESSIONS_COLLECTION).doc(sessionDocument.id);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ success: false, error: true });
    }
    await ref.set(sessionDocument);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[sessions:post]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

// Reprend updateSessionFields() de js/services/evaluation-session-catalog-
// service.js. Reproduit EXACTEMENT les 3 branches de mise a jour de
// firestore.rules (autosave / soumission / abandon), le SDK Admin
// contournant firestore.rules - cette verification doit donc etre refaite
// ici a l'identique, champ par champ.
const SESSION_UPDATE_ALLOWED_KEYS = {
  in_progress: ["answers", "currentQuestionIndex", "updatedAt", "events"],
  submitted: ["answers", "currentQuestionIndex", "status", "submittedAt", "updatedAt", "events"],
  abandoned: ["status", "updatedAt", "events"],
};

app.patch("/api/sessions/:id", requireAuth, async (req, res) => {
  const fields = req.body || {};
  try {
    const ref = admin.firestore().collection(EVALUATION_SESSIONS_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: true });
    const current = snap.data();

    if (current.userId !== req.user.uid || current.status !== "in_progress") {
      return res.status(403).json({ success: false, error: true });
    }
    if ("userId" in fields && fields.userId !== current.userId) {
      return res.status(403).json({ success: false, error: true });
    }

    const newStatus = "status" in fields ? fields.status : current.status;
    const allowedKeys = SESSION_UPDATE_ALLOWED_KEYS[newStatus];
    if (!allowedKeys) {
      return res.status(403).json({ success: false, error: true });
    }
    if (newStatus === "submitted" && fields.submittedAt == null) {
      return res.status(403).json({ success: false, error: true });
    }
    // Notation pointee Firestore ("answers.q123") pour une mise a jour
    // partielle d'une map imbriquee (voir saveAnswer(), evaluation-session-
    // service.js) : seul le segment avant le premier "." compte comme champ
    // affecte, exactement comme affectedKeys() dans firestore.rules.
    const topLevelKeys = Object.keys(fields).map((k) => k.split(".")[0]);
    if (!topLevelKeys.every((k) => allowedKeys.includes(k))) {
      return res.status(403).json({ success: false, error: true });
    }

    await ref.update(fields);
    res.json({ success: true, error: false });
  } catch (err) {
    console.error("[sessions/:id:patch]", err && err.code, err);
    res.status(500).json({ success: false, error: true });
  }
});

const PENDING_INVITES_COLLECTION = "pending_user_invites";

// Reprend listPendingInvites() de js/services/user-invite-service.js
// (admin/users.js). Reservee aux administrateurs.
app.get("/api/pending-invites", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    const snap = await admin
      .firestore()
      .collection(PENDING_INVITES_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const items = snap.docs.map((d) => d.data()).filter((data) => !data.consumedAt);
    res.json({ items, error: false });
  } catch (err) {
    console.error("[pending-invites]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend getPendingInviteByEmail() de js/services/user-invite-service.js
// (user-service.js, ensureUserDocument() a la toute premiere connexion
// reelle). Meme regle que firestore.rules (match /pending_user_invites/{email}) :
// l'administrateur, OU l'utilisateur dont l'e-mail AUTHENTIFIE (dans le
// jeton, pas juste un parametre) correspond exactement.
app.get("/api/pending-invites/:email", requireAuth, async (req, res) => {
  const normalized = (req.params.email || "").trim().toLowerCase();
  try {
    const requesterEmail = (req.user.email || "").toLowerCase();
    if (requesterEmail !== normalized && !(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ data: null, error: "Accès refusé" });
    }
    const snap = await admin.firestore().collection(PENDING_INVITES_COLLECTION).doc(normalized).get();
    if (!snap.exists) return res.json({ data: null, error: false });
    const data = snap.data();
    res.json({ data: data.consumedAt ? null : data, error: false });
  } catch (err) {
    console.error("[pending-invites/:email]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend getById()/getByIds() de js/services/reference-bank-service.js
// (createReferenceBankService), pour les 3 banques concretes (groups-,
// profiles-, organizations-bank-service.js). Collection resolue via un
// allowlist explicite (jamais le parametre directement) - aucun autre nom
// de collection ne doit etre atteignable par cette route. Reservee aux
// administrateurs (meme regle que firestore.rules : les 3 collections
// n'ont aucune exception "publie", contrairement a questions/parcours/
// competencies).
const REFERENCE_BANK_COLLECTIONS = {
  group: "groups",
  profile: "profiles",
  organization: "organizations",
};

app.get("/api/reference-bank/:bankType", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({});
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({});
    }
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(
      uniqueIds.map((id) => admin.firestore().collection(collectionName).doc(id).get())
    );
    const map = {};
    uniqueIds.forEach((id, i) => {
      if (results[i].exists) map[id] = results[i].data();
    });
    res.json(map);
  } catch (err) {
    console.error("[reference-bank]", req.params.bankType, err && err.code, err);
    res.status(500).json({});
  }
});

// Reprend queryPage() de la factory js/services/reference-bank-service.js
// (ecran d'administration des 3 banques). Meme regle que firestore.rules :
// isRequesterAdmin() TOUJOURS (contrairement a questions/parcours/
// competencies, aucun cas "publie = ouvert a tous" ici).
app.get("/api/reference-bank/:bankType/page", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ items: [], lastDoc: null, hasMore: false, error: true });
  const filters = parseFiltersParam(req.query.filters);
  const pageSize = boundedNumberParam(req.query.pageSize, 25, 100);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], lastDoc: null, hasMore: false, error: "Accès refusé" });
    }
    let q = admin.firestore().collection(collectionName);
    if (filters.status) q = q.where("status", "==", filters.status);
    q = q.orderBy(sortField, sortDirection).limit(pageSize + 1);
    if (req.query.cursor) {
      try { q = q.startAfter(JSON.parse(req.query.cursor)); } catch { /* curseur invalide, ignore */ }
    }
    const snap = await q.get();
    const docs = snap.docs.slice(0, pageSize);
    res.json({
      items: docs.map((d) => d.data()),
      lastCursor: docs.length ? JSON.stringify(docs[docs.length - 1].data()[sortField]) : null,
      hasMore: snap.docs.length > pageSize,
      error: false,
    });
  } catch (err) {
    console.error("[reference-bank/page]", req.params.bankType, err && err.code, err);
    res.status(500).json({ items: [], lastDoc: null, hasMore: false, error: true });
  }
});

// Reprend searchBounded(). Meme regle que ci-dessus.
app.get("/api/reference-bank/:bankType/search-bounded", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ items: [], truncated: false, error: true });
  const filters = parseFiltersParam(req.query.filters);
  const scanLimit = boundedNumberParam(req.query.maxScan, 500, 2000);
  const sortField = req.query.sortField || "createdAt";
  const sortDirection = req.query.sortDirection || "desc";
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], truncated: false, error: "Accès refusé" });
    }
    let q = admin.firestore().collection(collectionName);
    if (filters.status) q = q.where("status", "==", filters.status);
    q = q.orderBy(sortField, sortDirection).limit(scanLimit + 1);
    const snap = await q.get();
    const all = snap.docs.map((d) => d.data());
    res.json({ items: all.slice(0, scanLimit), truncated: all.length > scanLimit, error: false });
  } catch (err) {
    console.error("[reference-bank/search-bounded]", req.params.bankType, err && err.code, err);
    res.status(500).json({ items: [], truncated: false, error: true });
  }
});

// Reprend getTimeline() (lecture de reference_bank_audit_logs pour UN
// element). Meme regle : isRequesterAdmin().
app.get("/api/reference-bank/:bankType/timeline/:entityId", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ items: [], error: true });
    const snap = await admin
      .firestore()
      .collection("reference_bank_audit_logs")
      .where("bankType", "==", req.params.bankType)
      .where("entityId", "==", req.params.entityId)
      .orderBy("date", "desc")
      .limit(100)
      .get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[reference-bank/timeline]", req.params.bankType, err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

// Reprend create()/edit()/publish()/archive()/revertToDraft()/moveToTrash()/
// restoreFromTrash()/permanentlyDelete() de la factory js/services/
// reference-bank-service.js. UNE seule implementation parametree par
// :bankType (organization/profile/group -> organizations/profiles/groups),
// les 3 collections etant structurellement identiques cote firestore.rules
// (isRequesterAdmin(), memes 3 regles de mise a jour, meme suppression
// securisee - voir le commentaire de firestore.rules juste avant match
// /organizations/{orgId}).
app.post("/api/reference-bank/:bankType", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ status: "error" });
  const metadata = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ status: "denied" });
    if (!metadata.id || metadata.status !== "draft") return res.status(403).json({ status: "error" });
    const ref = admin.firestore().collection(collectionName).doc(metadata.id);
    if ((await ref.get()).exists) return res.status(409).json({ status: "error" });
    await ref.set(metadata);
    res.json({ status: "success" });
  } catch (err) {
    console.error("[reference-bank:post]", req.params.bankType, err && err.code, err);
    res.status(500).json({ status: "error" });
  }
});

// Reprend edit() : id ET statut inchanges (meme regle "update n°1" que
// competencies/parcours), aucune autre restriction de champ (pas de
// hasOnly cote firestore.rules pour cette branche).
app.patch("/api/reference-bank/:bankType/:id/fields", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ status: "error" });
  const fields = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ status: "denied" });
    const ref = admin.firestore().collection(collectionName).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: "error" });
    if ("status" in fields && fields.status !== snap.data().status) return res.status(403).json({ status: "error" });
    await ref.update({ ...fields, updatedAt: new Date().toISOString() });
    res.json({ status: "success" });
  } catch (err) {
    console.error("[reference-bank/:bankType/:id/fields]", req.params.bankType, err && err.code, err);
    res.status(500).json({ status: "error" });
  }
});

// Reprend publish()/archive()/revertToDraft() (transitions generales) +
// moveToTrash()/restoreFromTrash() (Archive<->Corbeille) - meme combinaison
// que /api/competencies/:id/status.
const REFERENCE_BANK_STATUS_GENERAL_TARGETS = ["draft", "published", "archived"];
app.patch("/api/reference-bank/:bankType/:id/status", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ status: "error" });
  const newStatus = req.body && req.body.status;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ status: "denied" });
    const ref = admin.firestore().collection(collectionName).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: "error" });
    const oldStatus = snap.data().status;
    const generalOk = oldStatus !== "trash" && REFERENCE_BANK_STATUS_GENERAL_TARGETS.includes(newStatus);
    const trashOk = (oldStatus === "archived" && newStatus === "trash") || (oldStatus === "trash" && newStatus === "archived");
    if (!generalOk && !trashOk) return res.status(403).json({ status: "error" });
    await ref.update({ status: newStatus, updatedAt: new Date().toISOString() });
    res.json({ status: "success" });
  } catch (err) {
    console.error("[reference-bank/:bankType/:id/status]", req.params.bankType, err && err.code, err);
    res.status(500).json({ status: "error" });
  }
});

// Reprend permanentlyDelete(). Meme regle "delete" : isRequesterAdmin(),
// uniquement depuis la corbeille (la permission purgePermission dediee
// reste un controle client-side, voir reference-bank-service.js#checkAccess -
// meme principe que PURGE_QUESTIONS ailleurs dans le projet).
app.delete("/api/reference-bank/:bankType/:id", requireAuth, async (req, res) => {
  const collectionName = REFERENCE_BANK_COLLECTIONS[req.params.bankType];
  if (!collectionName) return res.status(400).json({ status: "error" });
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ status: "denied" });
    const ref = admin.firestore().collection(collectionName).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ status: "success" });
    if (snap.data().status !== "trash") return res.status(403).json({ status: "error" });
    await ref.delete();
    res.json({ status: "success" });
  } catch (err) {
    console.error("[reference-bank/:bankType/:id:delete]", req.params.bankType, err && err.code, err);
    res.status(500).json({ status: "error" });
  }
});

// Reprend logAction() (interne a la factory) - journal PARTAGE des 3
// banques. Meme regle que firestore.rules (match /reference_bank_audit_logs/{logId}) :
// isRequesterAdmin(), adminUid == demandeur.
app.post("/api/reference-bank-audit-logs", requireAuth, async (req, res) => {
  const entry = req.body || {};
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ success: false });
    if (entry.adminUid !== req.user.uid) return res.status(403).json({ success: false });
    await admin.firestore().collection("reference_bank_audit_logs").add({
      date: new Date().toISOString(),
      bankType: entry.bankType || null,
      entityId: entry.entityId || null,
      adminUid: entry.adminUid || null,
      adminEmail: entry.adminEmail || "",
      actionType: entry.actionType || "unknown",
      oldValue: (entry.oldValue !== undefined && entry.oldValue !== null) ? String(entry.oldValue) : "",
      newValue: (entry.newValue !== undefined && entry.newValue !== null) ? String(entry.newValue) : "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[reference-bank-audit-logs:post]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

// AJOUT (page "Journal d'audit" consolidee, demande directe de David,
// 27/07/2026) : flux global recent (toutes organisations/profils/groupes
// confondus, ou filtre sur UN bankType) - la route existante
// (/timeline/:entityId ci-dessus) exige un element precis, aucune ne
// permettait jusqu'ici "les N dernieres actions, tous elements confondus"
// comme pour audit_logs/question_audit_logs/parcours_audit_logs/
// competency_audit_logs.
app.get("/api/reference-bank-audit-logs", requireAuth, async (req, res) => {
  const max = boundedNumberParam(req.query.limit, DEFAULT_CONTENT_AUDIT_LIMIT, 500);
  const { bankType } = req.query;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    let q = admin.firestore().collection("reference_bank_audit_logs");
    if (bankType) q = q.where("bankType", "==", bankType);
    q = q.orderBy("date", "desc").limit(max);
    const snap = await q.get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[reference-bank-audit-logs]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

const QUESTION_REPORTS_COLLECTION = "question_reports";

// Reprend getOpenReportCounts() de js/services/question-report-service.js
// (badge de signalements dans la Banque de questions). Reservee aux
// administrateurs - meme regle que firestore.rules (le role 'editor'
// possede MANAGE_QUESTIONS cote client mais firestore.rules n'autorise
// que isRequesterAdmin() a lire tous les signalements ; cette route
// reproduit fidelement la garantie reelle, pas la verification cote
// client optimiste).
app.get("/api/question-reports/open-counts", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return res.json({ counts: {}, error: false });
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.json({ counts: {}, error: false });
    }
    const results = await Promise.all(
      ids.map(async (pid) => {
        const snap = await admin
          .firestore()
          .collection(QUESTION_REPORTS_COLLECTION)
          .where("pedagogicalId", "==", pid)
          .where("status", "==", "open")
          .get();
        return { pedagogicalId: pid, count: snap.size };
      })
    );
    const counts = {};
    results.forEach((r) => {
      if (r.count > 0) counts[r.pedagogicalId] = r.count;
    });
    res.json({ counts, error: false });
  } catch (err) {
    console.error("[question-reports/open-counts]", err && err.code, err);
    res.status(500).json({ counts: {}, error: true });
  }
});

// Reprend getReportsForQuestion() de js/services/question-report-service.js.
// Reservee aux administrateurs (meme raisonnement que ci-dessus).
app.get("/api/question-reports", requireAuth, async (req, res) => {
  const { pedagogicalId } = req.query;
  if (!pedagogicalId) return res.status(400).json({ items: [], error: false, authorized: true });
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.json({ items: [], error: false, authorized: false });
    }
    const snap = await admin
      .firestore()
      .collection(QUESTION_REPORTS_COLLECTION)
      .where("pedagogicalId", "==", pedagogicalId)
      .get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    res.json({ items, error: false, authorized: true });
  } catch (err) {
    console.error("[question-reports]", err && err.code, err);
    res.status(500).json({ items: [], error: true, authorized: true });
  }
});

const QUESTION_REPORTS_LIST_LIMIT = 300;

// AJOUT (demande directe de David, 29/07/2026, "un menu d'ouverture de
// ticket dans le menu Admin") : la route ci-dessus ne renvoie que les
// signalements d'UNE question precise (pedagogicalId obligatoire) - aucune
// vue d'ensemble n'existait. Cette route liste TOUS les signalements
// (toutes questions confondues), filtres sur le statut. Deux requetes
// distinctes SANS jamais les combiner (where + orderBy sur des champs
// differents exigerait un index compose) : `status=open|resolved` fait un
// simple where() (tri fait cote client, meme principe que la route
// ci-dessus) ; `status=all` fait un orderBy(createdAt) seul (fonctionne
// sans index compose), borne a QUESTION_REPORTS_LIST_LIMIT.
app.get("/api/question-reports/all", requireAuth, async (req, res) => {
  const status = ["open", "resolved", "all"].includes(req.query.status) ? req.query.status : "open";
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.json({ items: [], error: false, authorized: false });
    }
    let snap;
    if (status === "all") {
      snap = await admin
        .firestore()
        .collection(QUESTION_REPORTS_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(QUESTION_REPORTS_LIST_LIMIT)
        .get();
    } else {
      snap = await admin
        .firestore()
        .collection(QUESTION_REPORTS_COLLECTION)
        .where("status", "==", status)
        .get();
    }
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    res.json({ items: items.slice(0, QUESTION_REPORTS_LIST_LIMIT), error: false, authorized: true });
  } catch (err) {
    console.error("[question-reports/all]", err && err.code, err);
    res.status(500).json({ items: [], error: true, authorized: true });
  }
});

const REPORT_REASONS = ["wrong_answer", "inconsistency", "duplicate", "typo", "other"];
const REPORT_COMMENT_MAX_LENGTH = 1000;
const QUESTION_REPORT_COUNTERS_COLLECTION = "question_report_counters";
const QUESTION_REPORT_MAX_PER_HOUR = 20;

// CORRECTIF (audit "mauvais utilisateur", 27/07/2026) : la creation d'un
// signalement se faisait jusqu'ici en ecriture Firestore DIRECTE
// (question-report-service.js, addDoc), contournant entierement les
// Cloud Functions - aucune limite de frequence possible cote serveur, et
// aucune borne de longueur sur `comment`. Migre vers cette route (meme
// principe que toutes les autres ecritures deja migrees) pour appliquer
// une fenetre glissante (meme mecanisme que checkAndIncrementUploadQuota()
// ci-dessus) et une borne de taille. firestore.rules verrouille desormais
// cette collection a `if false` (ecriture exclusivement via cette route).
async function checkAndIncrementReportQuota(uid) {
  const ref = admin.firestore().collection(QUESTION_REPORT_COUNTERS_COLLECTION).doc(uid);
  const now = Date.now();
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data && data.windowStart ? data.windowStart : 0;
    const withinWindow = now - windowStart < 60 * 60 * 1000;
    const count = withinWindow ? (data.count || 0) : 0;
    if (count >= QUESTION_REPORT_MAX_PER_HOUR) return false;
    tx.set(ref, { windowStart: withinWindow ? windowStart : now, count: count + 1 });
    return true;
  });
}

app.post("/api/question-reports", requireAuth, async (req, res) => {
  const fields = req.body || {};
  if (typeof fields.pedagogicalId !== "string" || !fields.pedagogicalId) {
    return res.status(400).json({ success: false, message: "Question cible introuvable." });
  }
  if (!REPORT_REASONS.includes(fields.reason)) {
    return res.status(400).json({ success: false, message: "Motif de signalement invalide." });
  }
  const comment = (fields.comment || "").toString().trim().slice(0, REPORT_COMMENT_MAX_LENGTH);
  try {
    const allowed = await checkAndIncrementReportQuota(req.user.uid);
    if (!allowed) {
      return res.status(429).json({ success: false, message: "Trop de signalements envoyés récemment. Réessayez plus tard." });
    }
    await admin.firestore().collection(QUESTION_REPORTS_COLLECTION).add({
      pedagogicalId: fields.pedagogicalId,
      userId: req.user.uid,
      userEmail: req.user.email || "",
      reason: fields.reason,
      comment,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    });
    res.json({ success: true, message: "Merci, votre signalement a été transmis." });
  } catch (err) {
    console.error("[question-reports:post]", err && err.code, err);
    res.status(500).json({ success: false, message: "Impossible d'envoyer le signalement pour le moment." });
  }
});

// Reprend markReportResolved() de js/services/question-report-service.js.
// Reservee aux administrateurs - ne modifie jamais pedagogicalId/userId/
// reason/comment (memes champs figes que l'ancienne regle Firestore).
app.patch("/api/question-reports/:id/resolve", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ success: false });
    }
    await admin.firestore().collection(QUESTION_REPORTS_COLLECTION).doc(req.params.id).update({
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: req.user.uid,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[question-reports/resolve]", err && err.code, err);
    res.status(500).json({ success: false });
  }
});

const DEFAULT_CONTENT_AUDIT_LIMIT = 50;

// Reprend getRecentQuestionAuditLogs()/getRecentParcoursAuditLogs()/
// getRecentCompetencyAuditLogs() (question-, parcours-, competency-audit-
// service.js) - 3 fichiers miroirs exacts, une seule route parametree.
// Collection resolue via allowlist explicite. Reservee aux administrateurs
// (meme regle que firestore.rules pour les 3 collections).
const CONTENT_AUDIT_CONFIG = {
  question: { collection: "question_audit_logs", filterField: "pedagogicalId" },
  parcours: { collection: "parcours_audit_logs", filterField: "parcoursId" },
  competency: { collection: "competency_audit_logs", filterField: "competencyId" },
};

app.get("/api/content-audit-logs/:logType", requireAuth, async (req, res) => {
  const config = CONTENT_AUDIT_CONFIG[req.params.logType];
  if (!config) return res.status(400).json({ items: [], error: false });
  const max = boundedNumberParam(req.query.limit, DEFAULT_CONTENT_AUDIT_LIMIT, 500);
  const filterId = req.query.filterId;
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    let q = admin.firestore().collection(config.collection);
    if (filterId) q = q.where(config.filterField, "==", filterId);
    q = q.orderBy("date", "desc").limit(max);
    const snap = await q.get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[content-audit-logs]", req.params.logType, err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

const IMPORT_LOGS_COLLECTION = "importLogs";
const DEFAULT_IMPORT_LOGS_LIMIT = 50;

// Reprend getRecentImportLogs() de js/services/import-log-service.js.
// Reservee aux administrateurs (meme regle que firestore.rules).
app.get("/api/import-logs", requireAuth, async (req, res) => {
  const max = boundedNumberParam(req.query.limit, DEFAULT_IMPORT_LOGS_LIMIT, 500);
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ items: [], error: "Accès refusé" });
    }
    const snap = await admin
      .firestore()
      .collection(IMPORT_LOGS_COLLECTION)
      .orderBy("date", "desc")
      .limit(max)
      .get();
    res.json({ items: snap.docs.map((d) => d.data()), error: false });
  } catch (err) {
    console.error("[import-logs]", err && err.code, err);
    res.status(500).json({ items: [], error: true });
  }
});

const MIGRATION_JOBS_COLLECTION = "document_migration_jobs";

// Reprend getMigrationJobById() de js/services/document-migration-job-service.js.
// Reservee aux administrateurs du catalogue (meme regle que firestore.rules).
app.get("/api/migration-jobs/:id", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterCatalogAdmin(req.user.uid))) {
      return res.status(403).json({ data: null, error: "Accès refusé" });
    }
    const snap = await admin.firestore().collection(MIGRATION_JOBS_COLLECTION).doc(req.params.id).get();
    res.json({ data: snap.exists ? snap.data() : null, error: false });
  } catch (err) {
    console.error("[migration-jobs/:id]", err && err.code, err);
    res.status(500).json({ data: null, error: true });
  }
});

// Reprend getDocumentSourceById()/getDocumentSourcesByIds() de
// document-source-catalog-service.js. Meme regle que firestore.rules
// (match /document_sources/{sourceId}) : verifiee document par document
// (un lot peut melanger actif/brouillon).
async function getVisibleDocumentSource(sourceId, requesterUid, adminCache) {
  const snap = await admin.firestore().collection(DOCUMENT_SOURCES_COLLECTION).doc(sourceId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status === "active") return data;
  if (adminCache.value === null) adminCache.value = await isRequesterCatalogAdmin(requesterUid);
  return adminCache.value ? data : null;
}

// Reprend getPublishedQuestionIdsBySourceIds() de js/services/question-
// catalog-service.js (pool d'evaluation de parcours mixte, calcul de
// progression). Filtre status=='published' toujours applique - ouvert a
// tout utilisateur authentifie, meme regle que firestore.rules.
app.post("/api/questions/published-ids-by-sources", requireAuth, async (req, res) => {
  const sourceIds = (req.body && req.body.sourceIds) || [];
  const unique = Array.from(new Set(sourceIds.filter(Boolean)));
  if (unique.length === 0) return res.json({ ids: [] });
  const CHUNK_SIZE = 30;
  try {
    const ids = [];
    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      const chunk = unique.slice(i, i + CHUNK_SIZE);
      const snap = await admin
        .firestore()
        .collection(QUESTIONS_COLLECTION)
        .where("status", "==", "published")
        .where("documentSourceId", "in", chunk)
        .get();
      snap.forEach((d) => ids.push(d.id));
    }
    res.json({ ids });
  } catch (err) {
    console.error("[questions/published-ids-by-sources]", err && err.code, err);
    res.status(500).json({ ids: [] });
  }
});

app.get("/api/document-sources-by-ids", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.json({});
  try {
    const adminCache = { value: null };
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(uniqueIds.map((id) => getVisibleDocumentSource(id, req.user.uid, adminCache)));
    const map = {};
    uniqueIds.forEach((id, i) => { if (results[i]) map[id] = results[i]; });
    res.json(map);
  } catch (err) {
    console.error("[document-sources-by-ids]", err && err.code, err);
    res.status(500).json({});
  }
});

// Reprend getDocumentSectionById()/getDocumentSectionsByIds() de
// document-section-catalog-service.js. Meme principe que ci-dessus.
async function getVisibleDocumentSection(sectionId, requesterUid, adminCache) {
  const snap = await admin.firestore().collection(DOCUMENT_SECTIONS_COLLECTION).doc(sectionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status === "active") return data;
  if (adminCache.value === null) adminCache.value = await isRequesterCatalogAdmin(requesterUid);
  return adminCache.value ? data : null;
}

app.get("/api/document-sections-by-ids", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.json({});
  try {
    const adminCache = { value: null };
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(uniqueIds.map((id) => getVisibleDocumentSection(id, req.user.uid, adminCache)));
    const map = {};
    uniqueIds.forEach((id, i) => { if (results[i]) map[id] = results[i]; });
    res.json(map);
  } catch (err) {
    console.error("[document-sections-by-ids]", err && err.code, err);
    res.status(500).json({});
  }
});

// Reprend getExistingQuestionByPedagogicalId()/getExistingQuestionsByPedagogicalIds()
// de question-catalog-service.js. Meme regle que firestore.rules (match
// /questions/{pedagogicalId}) : publiee = tout utilisateur authentifie,
// sinon isRequesterAdmin() - verifiee document par document.
async function getVisibleQuestion(pedagogicalId, requesterUid, adminCache) {
  const snap = await admin.firestore().collection(QUESTIONS_COLLECTION).doc(pedagogicalId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status === "published") return data;
  if (adminCache.value === null) adminCache.value = await isRequesterAdmin(requesterUid);
  return adminCache.value ? data : null;
}

app.get("/api/questions-by-ids", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.json({});
  try {
    const adminCache = { value: null };
    const uniqueIds = Array.from(new Set(ids));
    const results = await Promise.all(uniqueIds.map((id) => getVisibleQuestion(id, req.user.uid, adminCache)));
    const map = {};
    uniqueIds.forEach((id, i) => { if (results[i]) map[id] = results[i]; });
    res.json(map);
  } catch (err) {
    console.error("[questions-by-ids]", err && err.code, err);
    res.status(500).json({});
  }
});

// ===================== TABLEAU DE BORD ORGANISATION (B2B) =====================
// Accessible aux rôles 'teacher', 'manager' ET 'admin' (un admin peut aussi avoir une
// org rattachée pour tester la vue). Retourne en UN seul aller-retour :
// - le nom de l'organisation du requérant
// - la liste de ses membres (même organizationId)
// - pour chaque membre : stats agrégées des 50 dernières évaluations
//   (totalEvals, lastEvalAt, avgScore) + parcoursStatus (parcours commencé ou non)
// - orgParcours : liste des parcours actifs assignés à l'organisation
// Jamais d'accès aux réponses détaillées — statistiques uniquement.
app.get("/api/org-dashboard", requireAuth, async (req, res) => {
  // Découpe un tableau en lots de 30 (limite Firestore 'in')
  function inChunks(arr) {
    const result = [];
    for (let i = 0; i < arr.length; i += 30) result.push(arr.slice(i, i + 30));
    return result;
  }

  try {
    const requesterSnap = await admin.firestore().collection("users").doc(req.user.uid).get();
    if (!requesterSnap.exists) {
      return res.status(403).json({ error: true, message: "Compte introuvable." });
    }
    const requester = requesterSnap.data();
    if (!["teacher", "manager", "admin"].includes(requester.role) || requester.status !== "active") {
      return res.status(403).json({ error: true, message: "Cette fonctionnalité est réservée aux enseignants et aux administrateurs." });
    }

    const orgId = requester.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: true, noOrg: true, message: "Vous n'êtes rattaché à aucune organisation. Demandez à votre administrateur de vous assigner une organisation." });
    }

    const orgSnap = await admin.firestore().collection("organizations").doc(orgId).get();
    const orgName = orgSnap.exists ? (orgSnap.data().name || orgId) : orgId;

    const membersSnap = await admin.firestore().collection("users")
      .where("organizationId", "==", orgId)
      .get();

    if (membersSnap.empty) {
      return res.json({ error: false, orgName, orgId, members: [], orgParcours: [] });
    }

    // Résolution en lot des profils (sans dupliquer les lectures)
    const profileIds = [...new Set(membersSnap.docs.map((d) => d.data().profileId).filter(Boolean))];
    const profileMap = {};
    if (profileIds.length > 0) {
      const profileSnaps = await Promise.all(profileIds.map((id) => admin.firestore().collection("profiles").doc(id).get()));
      profileIds.forEach((id, i) => {
        if (profileSnaps[i].exists) profileMap[id] = profileSnaps[i].data().name || id;
      });
    }

    // Stats par membre — best-effort : une erreur sur un membre n'empêche pas
    // les autres de s'afficher (catch local, jamais un reject global).
    const members = await Promise.all(membersSnap.docs.map(async (d) => {
      const u = d.data();
      try {
        const evalsSnap = await admin.firestore()
          .collection(EVALUATION_RESULTS_COLLECTION)
          .where("userId", "==", u.uid)
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();
        const evals = evalsSnap.docs.map((ev) => ev.data());
        const totalEvals = evals.length;
        const lastRaw = totalEvals > 0 ? evals[0].createdAt : null;
        const lastEvalAt = lastRaw
          ? (lastRaw.toDate ? lastRaw.toDate().toISOString() : String(lastRaw))
          : null;
        const avgScore = totalEvals > 0
          ? Math.round(evals.reduce((sum, e) => sum + ((e.score && e.score.percent) || 0), 0) / totalEvals)
          : null;
        return { uid: u.uid, firstName: u.firstName || "", lastName: u.lastName || "", displayName: u.displayName || "", email: u.email || "", groupIds: u.groupIds || [], profileId: u.profileId || null, profileLabel: u.profileId ? (profileMap[u.profileId] || null) : null, status: u.status || "active", totalEvals, lastEvalAt, avgScore, parcoursStatus: [] };
      } catch (err) {
        console.error("[org-dashboard] stats for", u.uid, err && err.code);
        return { uid: u.uid, firstName: u.firstName || "", lastName: u.lastName || "", displayName: u.displayName || "", email: u.email || "", groupIds: u.groupIds || [], profileId: u.profileId || null, profileLabel: u.profileId ? (profileMap[u.profileId] || null) : null, status: u.status || "active", totalEvals: 0, lastEvalAt: null, avgScore: null, parcoursStatus: [] };
      }
    }));

    // Tri : actifs en premier, puis par dernière activité décroissante
    members.sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (a.lastEvalAt && b.lastEvalAt) return new Date(b.lastEvalAt) - new Date(a.lastEvalAt);
      if (a.lastEvalAt) return -1;
      if (b.lastEvalAt) return 1;
      return 0;
    });

    // ---- Parcours assignés à l'organisation (best-effort, non bloquant) ----
    let orgParcours = [];
    try {
      // Compte combien de membres de l'org partagent chaque groupId / profileId.
      // Seuls les groupes/profils partagés par ≥2 membres sont considérés
      // "collectifs" : évite d'afficher les parcours assignés à titre individuel.
      const groupCount = {};
      const profileCount = {};
      members.forEach((m) => {
        m.groupIds.forEach((g) => { if (g) groupCount[g] = (groupCount[g] || 0) + 1; });
        if (m.profileId) profileCount[m.profileId] = (profileCount[m.profileId] || 0) + 1;
      });

      const sharedGroupIds = Object.keys(groupCount).filter((g) => groupCount[g] >= 2);
      const sharedProfileIds = Object.keys(profileCount).filter((p) => profileCount[p] >= 2);

      // Requêtes d'attributions en lots (index composite type+targetId existant)
      const assignmentQueries = [];
      inChunks(sharedGroupIds).forEach((chunk) =>
        assignmentQueries.push(
          admin.firestore().collection(ASSIGNMENTS_COLLECTION)
            .where("type", "==", "group").where("targetId", "in", chunk).get()
        )
      );
      inChunks(sharedProfileIds).forEach((chunk) =>
        assignmentQueries.push(
          admin.firestore().collection(ASSIGNMENTS_COLLECTION)
            .where("type", "==", "profile").where("targetId", "in", chunk).get()
        )
      );
      // Attributions directes user intentionnellement exclues :
      // elles sont personnelles et non représentatives de l'organisation.

      const assignmentSnaps = await Promise.all(assignmentQueries);

      // Déduplication des parcoursIds actifs
      const parcoursIdSet = new Set();
      assignmentSnaps.forEach((snap) =>
        snap.docs.forEach((d) => {
          const a = d.data();
          if (a.parcoursId && a.status === "active") parcoursIdSet.add(a.parcoursId);
        })
      );

      const assignedParcoursIds = Array.from(parcoursIdSet);

      if (assignedParcoursIds.length > 0) {
        // Noms des parcours publiés — le champ est "name" dans Firestore
        const parcoursSnaps = await Promise.all(
          assignedParcoursIds.map((id) => admin.firestore().collection(PARCOURS_COLLECTION).doc(id).get())
        );
        orgParcours = assignedParcoursIds
          .map((id, i) => {
            const snap = parcoursSnaps[i];
            if (!snap.exists) return null;
            const data = snap.data();
            if (data.status !== "published") return null;
            return { parcoursId: id, title: data.name || id };
          })
          .filter(Boolean);

        if (orgParcours.length > 0) {
          const activePIds = orgParcours.map((p) => p.parcoursId);

          // Pour chaque membre : quels parcours ont-ils commencé ?
          // Requête sur les 200 dernières évaluations (index userId+createdAt existant).
          // Limite documentée : si un membre a fait >200 évaluations libres depuis
          // sa dernière session de parcours, celle-ci ne sera pas détectée.
          await Promise.all(members.map(async (m) => {
            try {
              const parcoursEvalsSnap = await admin.firestore()
                .collection(EVALUATION_RESULTS_COLLECTION)
                .where("userId", "==", m.uid)
                .orderBy("createdAt", "desc")
                .limit(200)
                .get();

              const donePIds = new Set(
                parcoursEvalsSnap.docs
                  .map((d) => d.data().parcoursId)
                  .filter((pid) => pid && activePIds.includes(pid))
              );

              m.parcoursStatus = activePIds.map((pid) => ({
                parcoursId: pid,
                hasStarted: donePIds.has(pid),
              }));
            } catch (err) {
              console.error("[org-dashboard] parcours for", m.uid, err && err.code);
            }
          }));
        }
      }
    } catch (err) {
      console.error("[org-dashboard] parcours lookup", err && err.code, err);
      // Non-bloquant : les stats de base restent disponibles même en cas d'erreur
    }

    // groupIds et profileId ne sont pas nécessaires côté client — on les retire
    members.forEach((m) => { delete m.groupIds; delete m.profileId; });

    res.json({ error: false, orgName, orgId, members, orgParcours });
  } catch (err) {
    console.error("[org-dashboard]", err && err.code, err);
    res.status(500).json({ error: true, message: "Impossible de charger le tableau de bord de l'organisation pour le moment." });
  }
});

// OUTIL ADMIN — export CSV de toutes les questions (revue editoriale)
// Acces : admin uniquement. Telecharge directement depuis le navigateur.
app.get("/api/admin/export-questions-csv", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const snap = await admin.firestore().collection(QUESTIONS_COLLECTION).get();
    function esc(v) {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    const header = ["pedagogicalId","domain","theme","subtheme","difficulty","question","reponse_A","reponse_B","reponse_C","reponse_D","bonne_reponse_index","bonne_reponse_texte","explication","status"];
    const rows = [header.map(esc).join(",")];
    snap.forEach((doc) => {
      const d = doc.data();
      const ans = Array.isArray(d.answers) ? d.answers : [];
      const idx = typeof d.correctAnswer === "number" ? d.correctAnswer : null;
      rows.push([
        d.pedagogicalId, d.domain, d.theme, d.subtheme, d.difficulty,
        d.question, ans[0] || "", ans[1] || "", ans[2] || "", ans[3] || "",
        idx !== null ? idx : "", idx !== null ? (ans[idx] || "") : "",
        d.explanation, d.status,
      ].map(esc).join(","));
    });
    const csv = "﻿" + rows.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="questions-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error("[export-questions-csv]", err && err.code, err);
    res.status(500).send("Erreur serveur");
  }
});

// OUTIL ADMIN — import corrections CSV par pedagogicalId
// Reçoit un tableau JSON de lignes (parsing fait côté client).
// Chaque ligne identifiée par pedagogicalId : mise à jour des champs
// présents, ou suppression si status === 'deleted'.
app.post("/api/admin/import-corrections-csv", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ error: "Accès refusé" });
    const { rows, dryRun } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "Aucune ligne fournie" });
    if (rows.length > 1200) return res.status(400).json({ error: "Trop de lignes (max 1200)" });

    const db = admin.firestore();
    let updated = 0, deleted = 0, skipped = 0;
    const notFound = [];

    const commitQueue = [];
    let writeBatch = db.batch();
    let writeCount = 0;

    function flushBatch() {
      if (writeCount > 0) { commitQueue.push(writeBatch.commit()); writeBatch = db.batch(); writeCount = 0; }
    }
    function enqueue(type, ref, data) {
      if (type === "delete") writeBatch.delete(ref); else writeBatch.update(ref, data);
      writeCount++;
      if (writeCount >= 499) flushBatch();
    }

    const ids = [...new Set(rows.map((r) => r.pedagogicalId).filter(Boolean))];
    const docMap = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const snaps = await Promise.all(chunk.map((id) => db.collection(QUESTIONS_COLLECTION).doc(id).get()));
      chunk.forEach((id, j) => { docMap[id] = snaps[j]; });
    }

    for (const row of rows) {
      const pid = row.pedagogicalId;
      if (!pid) { skipped++; continue; }
      const snap = docMap[pid];
      if (!snap || !snap.exists) { notFound.push(pid); continue; }
      const ref = db.collection(QUESTIONS_COLLECTION).doc(pid);

      if (row.status === "deleted") {
        deleted++;
        if (!dryRun) enqueue("delete", ref);
      } else {
        const update = { updatedAt: FieldValue.serverTimestamp() };
        if (row.question) update.question = row.question;
        if (row.explication) update.explanation = row.explication;
        if (row.status) update.status = row.status;
        if (row.difficulty) update.difficulty = row.difficulty;
        const answersChanged = [row.reponse_A, row.reponse_B, row.reponse_C, row.reponse_D].some(Boolean);
        if (answersChanged) {
          const ea = Array.isArray(snap.data().answers) ? snap.data().answers : ["", "", "", ""];
          update.answers = [
            row.reponse_A || ea[0], row.reponse_B || ea[1],
            row.reponse_C || ea[2], row.reponse_D || ea[3],
          ];
        }
        const idx = parseInt(row.bonne_reponse_index, 10);
        if (!isNaN(idx) && idx >= 0 && idx <= 3) update.correctAnswer = idx;
        updated++;
        if (!dryRun) enqueue("update", ref, update);
      }
    }

    if (!dryRun) { flushBatch(); await Promise.all(commitQueue); }
    res.json({ updated, deleted, skipped, notFound, dryRun: !!dryRun });
  } catch (err) {
    console.error("[import-corrections-csv]", err && err.code, err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
// TABLEAU DE BORD ADMIN — comptages globaux
// Remplace les appels getCountFromServer() côté client qui échouent depuis
// que toutes les collections ont été verrouillées (allow read, write: if false)
// pour les accès client directs (Étape 13, 24/07/2026). Le SDK Admin SDK
// (côté serveur) contourne ces règles Firestore et peut compter sans lecture
// des documents — aucune donnée éditoriale n'est exposée, seul le count().
app.get("/api/admin/stats", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) {
      return res.status(403).json({ error: "Réservé aux administrateurs." });
    }
    const db = admin.firestore();
    const [qTotal, qDraft, pTotal, pDraft, rOpen] = await Promise.all([
      db.collection("questions").count().get(),
      db.collection("questions").where("status", "==", "draft").count().get(),
      db.collection("parcours").count().get(),
      db.collection("parcours").where("status", "==", "draft").count().get(),
      db.collection("question_reports").where("status", "==", "open").count().get(),
    ]);
    res.json({
      questions: { total: qTotal.data().count, draft: qDraft.data().count },
      parcours:  { total: pTotal.data().count,  draft: pDraft.data().count  },
      reports:   { open:  rOpen.data().count  },
    });
  } catch (err) {
    console.error("[admin/stats]", err && err.code, err);
    res.status(500).json({ error: "Impossible de charger les statistiques." });
  }
});

// OUTIL ADMIN — export CSV d'audit parcours/questions
// Pour chaque parcours, liste les questions liees (via competences ou
// directement) avec domaine/theme/sous-theme/difficulte.
// Permet de reperer les questions hors-theme dans un parcours.
app.get("/api/admin/export-parcours-questions", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const db = admin.firestore();

    // 1. Tous les parcours (Admin SDK contourne les règles Firestore)
    const parcoursSnap = await db.collection("parcours").orderBy("name").get();

    // 2. Lignes à générer + ensemble des questionIds à résoudre
    const rows = [];
    const questionIdSet = new Set();
    parcoursSnap.forEach((doc) => {
      const p = doc.data();
      const pid = doc.id;
      const pName = p.name || "";
      const pStatus = p.status || "";
      (p.competencies || []).forEach((comp) => {
        const compName = comp.name || "";
        (comp.questionIds || []).forEach((qid) => {
          rows.push({ pid, pName, pStatus, compName, qid });
          questionIdSet.add(qid);
        });
      });
      (p.directQuestionIds || []).forEach((qid) => {
        rows.push({ pid, pName, pStatus, compName: "(directe)", qid });
        questionIdSet.add(qid);
      });
    });

    // 3. Batch-fetch questions (blocs de 500 — limite Admin SDK getAll)
    const questionIds = Array.from(questionIdSet);
    const questionsMap = {};
    for (let i = 0; i < questionIds.length; i += 500) {
      const chunk = questionIds.slice(i, i + 500);
      const refs = chunk.map((qid) => db.collection("questions").doc(qid));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap) => {
        if (snap.exists) questionsMap[snap.id] = snap.data();
      });
    }

    // 4. CSV avec BOM UTF-8 (ouverture directe dans Excel)
    function esc(v) {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    const header = ["parcours_id","parcours_nom","parcours_statut","competence","question_id","domaine","theme","sous_theme","difficulte","question_texte","question_statut"];
    const csvRows = [header.map(esc).join(",")];
    for (const row of rows) {
      const q = questionsMap[row.qid] || {};
      csvRows.push([
        row.pid, row.pName, row.pStatus, row.compName, row.qid,
        q.domain || "", q.theme || "", q.subtheme || "", q.difficulty || "",
        q.question || "", q.status || "",
      ].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="parcours-questions-audit.csv"');
    res.send("﻿" + csvRows.join("\r\n"));
  } catch (err) {
    console.error("[export-parcours-questions]", err && err.code, err);
    res.status(500).send("Erreur serveur");
  }
});

// ─── LOT 1 — RÉAFFECTATIONS + RATTACHEMENT NOUVELLES QUESTIONS ─────────────
// Endpoint one-shot pour le chantier de recomposition Lot 1 (04/08/2026).
// dryRun:true (défaut) = lecture seule, rapport complet.
// dryRun:false = écriture réelle dans Firestore.
app.post("/api/admin/execute-lot1-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 29 réaffectations depuis le fichier Pharmeval_Lot1_reaffectations.csv
    const REASSIGNMENTS = [
      // Depuis Reflux (PARC-dfd3dba2)
      { qid: "PHARM-MED-001573", src: "PARC-dfd3dba2", tgt: "PARC-16c6ead8", op: "move" },
      { qid: "PHARM-MED-001574", src: "PARC-dfd3dba2", tgt: "PARC-2d6d79e4", op: "move" },
      { qid: "PHARM-MED-001575", src: "PARC-dfd3dba2", tgt: "PARC-2d6d79e4", op: "move" },
      { qid: "PHARM-MED-001576", src: "PARC-dfd3dba2", tgt: "PARC-3f777035", op: "move" },
      { qid: "PHARM-MED-001580", src: "PARC-dfd3dba2", tgt: "PARC-74295162", op: "move" },
      // Depuis Parkinson (PARC-1a819423)
      { qid: "PHARM-MED-001782", src: "PARC-1a819423", tgt: "PARC-15da76fe", op: "move" },
      { qid: "PHARM-MED-001783", src: "PARC-1a819423", tgt: "PARC-7fd267b1", op: "move" },
      { qid: "PHARM-MED-001784", src: "PARC-1a819423", tgt: "PARC-5d51e294", op: "move" },
      { qid: "PHARM-MED-001785", src: "PARC-1a819423", tgt: "PARC-ea3ac86c", op: "move" },
      { qid: "PHARM-MED-001787", src: "PARC-1a819423", tgt: "PARC-2b499f41", op: "move" },
      { qid: "PHARM-MED-001788", src: "PARC-1a819423", tgt: "PARC-079e1eb2", op: "move" },
      { qid: "PHARM-MED-001790", src: "PARC-1a819423", tgt: "PARC-518cf48c", op: "move" },
      { qid: "PHARM-MED-001791", src: "PARC-1a819423", tgt: "PARC-518cf48c", op: "move" },
      { qid: "PHARM-MED-001794", src: "PARC-1a819423", tgt: "PARC-ea3ac86c", op: "move" },
      { qid: "PHARM-MED-001796", src: "PARC-1a819423", tgt: "PARC-ea3ac86c", op: "move" },
      // Depuis Antibiotiques (PARC-3f777035)
      { qid: "PHARM-MED-001707", src: "PARC-3f777035", tgt: "PARC-45a033c3", op: "move" },
      { qid: "PHARM-MED-001710", src: "PARC-3f777035", tgt: "PARC-2d6d79e4", op: "move" },
      { qid: "PHARM-MED-001711", src: "PARC-3f777035", tgt: "PARC-8a51e8d5", op: "move" },
      { qid: "PHARM-MED-001712", src: "PARC-3f777035", tgt: "PARC-976f4c1b", op: "move" },
      { qid: "PHARM-MED-001715", src: "PARC-3f777035", tgt: "PARC-53201adc", op: "move" },
      { qid: "PHARM-MED-001717", src: "PARC-3f777035", tgt: "PARC-53201adc", op: "move" },
      { qid: "PHARM-MED-001718", src: "PARC-3f777035", tgt: "PARC-48df029a", op: "move" },
      { qid: "PHARM-MED-001719", src: "PARC-3f777035", tgt: "PARC-218ef505", op: "move" },
      { qid: "PHARM-MED-001721", src: "PARC-3f777035", tgt: "PARC-48df029a", op: "move" },
      // Depuis Transit → Reflux
      { qid: "PHARM-MED-001559", src: "PARC-74295162", tgt: "PARC-dfd3dba2", op: "move" },
      // Ajouter aussi (garder source ET ajouter cible)
      { qid: "PHARM-MED-001774", src: "PARC-2d6d79e4", tgt: "PARC-1a819423", op: "addAlso" },
      // Depuis Psychotropes/Lithium → Antibiotiques
      { qid: "PHARM-MED-001736", src: "PARC-5d51e294", tgt: "PARC-3f777035", op: "move" },
      { qid: "PHARM-MED-001769", src: "PARC-2d6d79e4", tgt: "PARC-3f777035", op: "move" },
      { qid: "PHARM-MED-001724", src: "PARC-5d51e294", tgt: "PARC-3f777035", op: "move" },
    ];

    // 18 nouvelles questions (par ID éditorial → parcours cible)
    const NEW_LINKS = [
      { eid: "LEGACY-LOT1_GI-reflux-001", tgt: "PARC-dfd3dba2" },
      { eid: "LEGACY-LOT1_GI-reflux-002", tgt: "PARC-dfd3dba2" },
      { eid: "LEGACY-LOT1_GI-reflux-003", tgt: "PARC-dfd3dba2" },
      { eid: "LEGACY-LOT1_GI-reflux-004", tgt: "PARC-dfd3dba2" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-001", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-002", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-003", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-004", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-005", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-006", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-007", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-008", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_NEURO-parkinson-009", tgt: "PARC-1a819423" },
      { eid: "LEGACY-LOT1_IATB-atbint-001", tgt: "PARC-3f777035" },
      { eid: "LEGACY-LOT1_IATB-atbint-002", tgt: "PARC-3f777035" },
      { eid: "LEGACY-LOT1_IATB-atbint-003", tgt: "PARC-3f777035" },
      { eid: "LEGACY-LOT1_IATB-atbint-004", tgt: "PARC-3f777035" },
      { eid: "LEGACY-LOT1_IATB-atbint-005", tgt: "PARC-3f777035" },
    ];

    // Helper: retire une question de TOUS les emplacements d'un parcours
    // (directQuestionIds ET competencies[].questionIds — une question peut être aux deux endroits)
    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};

      // 1. directQuestionIds
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }

      // 2. competencies[].questionIds (toutes les compétences concernées)
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }

      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    // Helper: ajoute une question dans directQuestionIds d'un parcours
    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    // 1. Réaffectations
    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    // 2. Nouvelles questions
    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-lot1-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ─── Lot 2 : recomposition de 3 parcours (Durées / Alertes / KQT) ────────────
app.post("/api/admin/execute-lot2-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 43 réaffectations depuis le fichier Pharmeval_Lot2_reaffectations.csv
    const REASSIGNMENTS = [
      // ─── Depuis DUREE (PARC-a14a3328) — 12 questions retirées ───────────────
      { qid: "PHARM-MED-001887", src: "PARC-a14a3328", tgt: "PARC-ca21a957", op: "move" },
      { qid: "PHARM-MED-001888", src: "PARC-a14a3328", tgt: "PARC-12bfd424", op: "move" },
      { qid: "PHARM-MED-001889", src: "PARC-a14a3328", tgt: "PARC-12bfd424", op: "move" },
      { qid: "PHARM-MED-001890", src: "PARC-a14a3328", tgt: "PARC-ca21a957", op: "move" },
      { qid: "PHARM-MED-001891", src: "PARC-a14a3328", tgt: "PARC-ca21a957", op: "move" },
      { qid: "PHARM-MED-001892", src: "PARC-a14a3328", tgt: "PARC-d0f2d36d", op: "move" },
      { qid: "PHARM-MED-001893", src: "PARC-a14a3328", tgt: "PARC-d0f2d36d", op: "move" },
      { qid: "PHARM-MED-001894", src: "PARC-a14a3328", tgt: "PARC-976f4c1b", op: "move" },
      { qid: "PHARM-MED-001895", src: "PARC-a14a3328", tgt: "PARC-12bfd424", op: "move" },
      { qid: "PHARM-MED-001896", src: "PARC-a14a3328", tgt: "PARC-ca21a957", op: "move" },
      { qid: "PHARM-MED-001899", src: "PARC-a14a3328", tgt: "PARC-12bfd424", op: "move" },
      { qid: "PHARM-MED-001900", src: "PARC-a14a3328", tgt: "PARC-16c6ead8", op: "move" },
      // ─── Vers DUREE — 1 déplacement entrant + 4 "ajouter aussi" ─────────────
      { qid: "PHARM-MED-001840", src: "PARC-ca21a957", tgt: "PARC-a14a3328", op: "move"    },
      { qid: "PHARM-MED-001876", src: "PARC-3f4a7070", tgt: "PARC-a14a3328", op: "addAlso" },
      { qid: "PHARM-MED-001423", src: "PARC-d0cd45dd", tgt: "PARC-a14a3328", op: "addAlso" },
      { qid: "PHARM-MED-001577", src: "PARC-dfd3dba2", tgt: "PARC-a14a3328", op: "addAlso" },
      { qid: "PHARM-MED-001677", src: "PARC-73cd2233", tgt: "PARC-a14a3328", op: "addAlso" },
      // ─── Depuis ALERTE (PARC-1d6d7bda) — 12 questions retirées ─────────────
      { qid: "PHARM-MED-001962", src: "PARC-1d6d7bda", tgt: "PARC-1c2fbf22", op: "move" },
      { qid: "PHARM-MED-001963", src: "PARC-1d6d7bda", tgt: "PARC-74295162", op: "move" },
      { qid: "PHARM-MED-001964", src: "PARC-1d6d7bda", tgt: "PARC-6135d803", op: "move" },
      { qid: "PHARM-MED-001965", src: "PARC-1d6d7bda", tgt: "PARC-02472517", op: "move" },
      { qid: "PHARM-MED-001966", src: "PARC-1d6d7bda", tgt: "PARC-d0cd45dd", op: "move" },
      { qid: "PHARM-MED-001968", src: "PARC-1d6d7bda", tgt: "PARC-0ad0bf47", op: "move" },
      { qid: "PHARM-MED-001969", src: "PARC-1d6d7bda", tgt: "PARC-7fd267b1", op: "move" },
      { qid: "PHARM-MED-001970", src: "PARC-1d6d7bda", tgt: "PARC-6d6a71d0", op: "move" },
      { qid: "PHARM-MED-001972", src: "PARC-1d6d7bda", tgt: "PARC-31e6e4cf", op: "move" },
      { qid: "PHARM-MED-001973", src: "PARC-1d6d7bda", tgt: "PARC-663880f0", op: "move" },
      { qid: "PHARM-MED-001974", src: "PARC-1d6d7bda", tgt: "PARC-7f7e8849", op: "move" },
      { qid: "PHARM-MED-001976", src: "PARC-1d6d7bda", tgt: "PARC-f64bdabf", op: "move" },
      // ─── Vers ALERTE — 2 "ajouter aussi" ─────────────────────────────────────
      { qid: "PHARM-MED-002005", src: "PARC-a219d70f", tgt: "PARC-1d6d7bda", op: "addAlso" },
      { qid: "PHARM-MED-002006", src: "PARC-a219d70f", tgt: "PARC-1d6d7bda", op: "addAlso" },
      // ─── Depuis KQT (PARC-123d62aa) — 6 déplacements + 1 archivage ──────────
      { qid: "PHARM-MED-001693", src: "PARC-123d62aa", tgt: "PARC-1c2fbf22", op: "move" },
      { qid: "PHARM-MED-001694", src: "PARC-123d62aa", tgt: "PARC-eed443e5", op: "move" },
      { qid: "PHARM-MED-001698", src: "PARC-123d62aa", tgt: "PARC-eed443e5", op: "move" },
      { qid: "PHARM-MED-001699", src: "PARC-123d62aa", tgt: "PARC-7f7e8849", op: "move" },
      { qid: "PHARM-MED-001703", src: "PARC-123d62aa", tgt: "PARC-48df029a", op: "move" },
      { qid: "PHARM-MED-001704", src: "PARC-123d62aa", tgt: "PARC-16c6ead8", op: "move" },
      { qid: "PHARM-MED-001705", src: "PARC-123d62aa", tgt: "PARC-48df029a", op: "move" },
      { qid: "PHARM-MED-001706", src: "PARC-123d62aa", tgt: null,            op: "remove" }, // Archiver
      // ─── Vers KQT — 4 "ajouter aussi" ────────────────────────────────────────
      { qid: "PHARM-MED-001576", src: "PARC-3f777035", tgt: "PARC-123d62aa", op: "addAlso" },
      { qid: "PHARM-MED-001441", src: "PARC-16c6ead8", tgt: "PARC-123d62aa", op: "addAlso" },
      { qid: "PHARM-MED-001446", src: "PARC-16c6ead8", tgt: "PARC-123d62aa", op: "addAlso" },
      { qid: "PHARM-MED-002041", src: "PARC-242d66e1", tgt: "PARC-123d62aa", op: "addAlso" },
    ];

    // 21 nouvelles questions (à lier après import catalog-sync Lot 2)
    const NEW_LINKS = [
      { eid: "LEGACY-LOT2_DUREE-durees-001",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-002",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-003",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-004",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-005",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-006",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_DUREE-durees-007",   tgt: "PARC-a14a3328" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-001", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-002", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-003", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-004", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-005", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-006", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-007", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-008", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-009", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_ALERTE-alertes-010", tgt: "PARC-1d6d7bda" },
      { eid: "LEGACY-LOT2_KQT-qtcardio-001",   tgt: "PARC-123d62aa" },
      { eid: "LEGACY-LOT2_KQT-qtcardio-002",   tgt: "PARC-123d62aa" },
      { eid: "LEGACY-LOT2_KQT-qtcardio-003",   tgt: "PARC-123d62aa" },
      { eid: "LEGACY-LOT2_KQT-qtcardio-004",   tgt: "PARC-123d62aa" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move" || r.op === "remove") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        if (r.op === "move") await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-lot2-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ─── Lot 3 : recomposition de 3 parcours (AGE-RISK / HTA / RENAL) ────────────
app.post("/api/admin/execute-lot3-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 28 réaffectations depuis le fichier Pharmeval_Lot3_reaffectations.csv
    const REASSIGNMENTS = [
      // ─── Depuis AGE-RISK (PARC-148548ee) — 7 questions retirées ─────────────
      { qid: "PHARM-MED-001587", src: "PARC-148548ee", tgt: "PARC-16c6ead8", op: "move" },
      { qid: "PHARM-MED-001588", src: "PARC-148548ee", tgt: "PARC-1c2fbf22", op: "move" },
      { qid: "PHARM-MED-001589", src: "PARC-148548ee", tgt: "PARC-d0cd45dd", op: "move" },
      { qid: "PHARM-MED-001590", src: "PARC-148548ee", tgt: "PARC-d0cd45dd", op: "move" },
      { qid: "PHARM-MED-001592", src: "PARC-148548ee", tgt: "PARC-d94beb97", op: "move" },
      { qid: "PHARM-MED-001596", src: "PARC-148548ee", tgt: "PARC-7d813ae0", op: "move" },
      { qid: "PHARM-MED-001601", src: "PARC-148548ee", tgt: "PARC-f64bdabf", op: "move" },
      // ─── Depuis HTA (PARC-d0cd45dd) — 5 questions retirées ──────────────────
      { qid: "PHARM-MED-001428", src: "PARC-d0cd45dd", tgt: "PARC-f64bdabf", op: "move" },
      { qid: "PHARM-MED-001429", src: "PARC-d0cd45dd", tgt: "PARC-31e6e4cf", op: "move" },
      { qid: "PHARM-MED-001434", src: "PARC-d0cd45dd", tgt: "PARC-31e6e4cf", op: "move" },
      { qid: "PHARM-MED-001435", src: "PARC-d0cd45dd", tgt: "PARC-123d62aa", op: "move" },
      { qid: "PHARM-MED-001436", src: "PARC-d0cd45dd", tgt: "PARC-16c6ead8", op: "move" },
      // ─── Depuis RENAL (PARC-72e1ed10) — 6 questions retirées ────────────────
      { qid: "PHARM-MED-001632", src: "PARC-72e1ed10", tgt: "PARC-d0cd45dd", op: "move" },
      { qid: "PHARM-MED-001634", src: "PARC-72e1ed10", tgt: "PARC-5aa8f0d6", op: "move" },
      { qid: "PHARM-MED-001635", src: "PARC-72e1ed10", tgt: "PARC-148548ee", op: "move" },
      { qid: "PHARM-MED-001636", src: "PARC-72e1ed10", tgt: "PARC-d0cd45dd", op: "move" },
      { qid: "PHARM-MED-001639", src: "PARC-72e1ed10", tgt: "PARC-7e183e7c", op: "move" },
      { qid: "PHARM-MED-001641", src: "PARC-72e1ed10", tgt: "PARC-c8dae3d2", op: "move" },
      // ─── Vers AGE-RISK — 2 déplacements entrants + 3 "ajouter aussi" ─────────
      { qid: "PHARM-MED-001612", src: "PARC-1c2fbf22", tgt: "PARC-148548ee", op: "move"    },
      { qid: "PHARM-MED-001748", src: "PARC-b593f716", tgt: "PARC-148548ee", op: "move"    },
      { qid: "PHARM-MED-001617", src: "PARC-079e1eb2", tgt: "PARC-148548ee", op: "addAlso" },
      { qid: "PHARM-MED-001406", src: "PARC-48df029a", tgt: "PARC-148548ee", op: "addAlso" },
      { qid: "PHARM-MED-002038", src: "PARC-242d66e1", tgt: "PARC-148548ee", op: "addAlso" },
      // ─── Vers RENAL — 4 "ajouter aussi" ──────────────────────────────────────
      { qid: "PHARM-MED-001930", src: "PARC-cb994abd", tgt: "PARC-72e1ed10", op: "addAlso" },
      { qid: "PHARM-MED-001523", src: "PARC-7e183e7c", tgt: "PARC-72e1ed10", op: "addAlso" },
      { qid: "PHARM-MED-001524", src: "PARC-7e183e7c", tgt: "PARC-72e1ed10", op: "addAlso" },
      { qid: "PHARM-MED-001617", src: "PARC-079e1eb2", tgt: "PARC-72e1ed10", op: "addAlso" },
      { qid: "PHARM-MED-001406", src: "PARC-48df029a", tgt: "PARC-72e1ed10", op: "addAlso" },
    ];

    // 10 nouvelles questions (à lier après import catalog-sync Lot 3)
    const NEW_LINKS = [
      { eid: "LEGACY-LOT3_AGE_RISK-risquerenal-001", tgt: "PARC-148548ee" },
      { eid: "LEGACY-LOT3_AGE_RISK-risquerenal-002", tgt: "PARC-148548ee" },
      { eid: "LEGACY-LOT3_AGE_RISK-risquerenal-003", tgt: "PARC-148548ee" },
      { eid: "LEGACY-LOT3_HTA-hta-001",              tgt: "PARC-d0cd45dd"  },
      { eid: "LEGACY-LOT3_HTA-hta-002",              tgt: "PARC-d0cd45dd"  },
      { eid: "LEGACY-LOT3_HTA-hta-003",              tgt: "PARC-d0cd45dd"  },
      { eid: "LEGACY-LOT3_RENAL-renal-001",          tgt: "PARC-72e1ed10"  },
      { eid: "LEGACY-LOT3_RENAL-renal-002",          tgt: "PARC-72e1ed10"  },
      { eid: "LEGACY-LOT3_RENAL-renal-003",          tgt: "PARC-72e1ed10"  },
      { eid: "LEGACY-LOT3_RENAL-renal-004",          tgt: "PARC-72e1ed10"  },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-lot3-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ─── Lot 4 : recomposition de 3 parcours (LITH / HEAT / NAT) ─────────────────
app.post("/api/admin/execute-lot4-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 28 réaffectations depuis le fichier Pharmeval_Lot4_reaffectations.csv
    const REASSIGNMENTS = [
      // ─── Depuis LITH (PARC-2d6d79e4) — 5 questions retirées ─────────────────
      { qid: "PHARM-MED-001767", src: "PARC-2d6d79e4", tgt: "PARC-ca21a957", op: "move" },
      { qid: "PHARM-MED-001769", src: "PARC-2d6d79e4", tgt: "PARC-3f777035", op: "move" },
      { qid: "PHARM-MED-001770", src: "PARC-2d6d79e4", tgt: "PARC-15da76fe", op: "move" },
      { qid: "PHARM-MED-001773", src: "PARC-2d6d79e4", tgt: "PARC-123d62aa", op: "move" },
      { qid: "PHARM-MED-001777", src: "PARC-2d6d79e4", tgt: "PARC-8290ad3a", op: "move" },
      // ─── Depuis HEAT (PARC-53465b78) — 6 questions retirées + 1 archivée ─────
      { qid: "PHARM-MED-001452", src: "PARC-53465b78", tgt: "PARC-47e2d2dc", op: "move"   },
      { qid: "PHARM-MED-001456", src: "PARC-53465b78", tgt: "PARC-31e6e4cf", op: "move"   },
      { qid: "PHARM-MED-001459", src: "PARC-53465b78", tgt: "PARC-31e6e4cf", op: "move"   },
      { qid: "PHARM-MED-001460", src: "PARC-53465b78", tgt: "PARC-21003a1e", op: "move"   },
      { qid: "PHARM-MED-001461", src: "PARC-53465b78", tgt: "PARC-2d6d79e4", op: "move"   },
      { qid: "PHARM-MED-001465", src: "PARC-53465b78", tgt: "PARC-7e183e7c", op: "move"   },
      { qid: "PHARM-MED-001464", src: "PARC-53465b78", tgt: null,            op: "remove"  }, // Archiver
      // ─── Depuis NAT (PARC-0059d77a) — 6 questions retirées ──────────────────
      { qid: "PHARM-MED-001332", src: "PARC-0059d77a", tgt: "PARC-976f4c1b", op: "move" },
      { qid: "PHARM-MED-001333", src: "PARC-0059d77a", tgt: "PARC-d0f2d36d", op: "move" },
      { qid: "PHARM-MED-001334", src: "PARC-0059d77a", tgt: "PARC-7f7e8849", op: "move" },
      { qid: "PHARM-MED-001336", src: "PARC-0059d77a", tgt: "PARC-1c2fbf22", op: "move" },
      { qid: "PHARM-MED-001338", src: "PARC-0059d77a", tgt: "PARC-15da76fe", op: "move" },
      { qid: "PHARM-MED-001345", src: "PARC-0059d77a", tgt: "PARC-853cf7e5", op: "move" },
      // ─── Vers LITH — 4 "ajouter aussi" ───────────────────────────────────────
      { qid: "PHARM-MED-001833", src: "PARC-ca21a957", tgt: "PARC-2d6d79e4", op: "addAlso" },
      { qid: "PHARM-MED-001985", src: "PARC-1c37cd49", tgt: "PARC-2d6d79e4", op: "addAlso" },
      { qid: "PHARM-MED-002112", src: "PARC-ea3ac86c", tgt: "PARC-2d6d79e4", op: "addAlso" },
      { qid: "PHARM-MED-001940", src: "PARC-02472517", tgt: "PARC-2d6d79e4", op: "addAlso" },
      // ─── Vers HEAT — 2 "ajouter aussi" ───────────────────────────────────────
      { qid: "PHARM-CON-000377", src: "PARC-e7b8e5f7", tgt: "PARC-53465b78", op: "addAlso" },
      { qid: "PHARM-CON-000378", src: "PARC-e7b8e5f7", tgt: "PARC-53465b78", op: "addAlso" },
      // ─── Vers NAT — 4 "ajouter aussi" ────────────────────────────────────────
      { qid: "PHARM-MED-001399", src: "PARC-48df029a", tgt: "PARC-0059d77a", op: "addAlso" },
      { qid: "PHARM-MED-001408", src: "PARC-7f7e8849", tgt: "PARC-0059d77a", op: "addAlso" },
      { qid: "PHARM-MED-001762", src: "PARC-7fd267b1", tgt: "PARC-0059d77a", op: "addAlso" },
      { qid: "PHARM-MED-002014", src: "PARC-218ef505", tgt: "PARC-0059d77a", op: "addAlso" },
    ];

    // 11 nouvelles questions (à lier après import catalog-sync Lot 4)
    const NEW_LINKS = [
      { eid: "LEGACY-LOT4_LITH-lithium-001", tgt: "PARC-2d6d79e4" },
      { eid: "LEGACY-LOT4_LITH-lithium-002", tgt: "PARC-2d6d79e4" },
      { eid: "LEGACY-LOT4_LITH-lithium-003", tgt: "PARC-2d6d79e4" },
      { eid: "LEGACY-LOT4_LITH-lithium-004", tgt: "PARC-2d6d79e4" },
      { eid: "LEGACY-LOT4_HEAT-chaleur-001", tgt: "PARC-53465b78" },
      { eid: "LEGACY-LOT4_HEAT-chaleur-002", tgt: "PARC-53465b78" },
      { eid: "LEGACY-LOT4_HEAT-chaleur-003", tgt: "PARC-53465b78" },
      { eid: "LEGACY-LOT4_HEAT-chaleur-004", tgt: "PARC-53465b78" },
      { eid: "LEGACY-LOT4_HEAT-chaleur-005", tgt: "PARC-53465b78" },
      { eid: "LEGACY-LOT4_NAT-naturels-001", tgt: "PARC-0059d77a" },
      { eid: "LEGACY-LOT4_NAT-naturels-002", tgt: "PARC-0059d77a" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move" || r.op === "remove") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        if (r.op === "move") await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-lot4-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ─── Lot 5 : recomposition de 3 parcours (RESP / PSY / AGE-FALL) ─────────────
app.post("/api/admin/execute-lot5-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 9 réaffectations depuis Pharmeval_Lot5_recomposition_3_parcours.xlsx (feuille Réaffectations)
    const REASSIGNMENTS = [
      // ─── Depuis AGE-FALL (PARC-1c2fbf22) — 3 questions retirées ─────────────
      { qid: "PHARM-MED-001609", src: "PARC-1c2fbf22", tgt: "PARC-518cf48c", op: "move" },
      { qid: "PHARM-MED-001610", src: "PARC-1c2fbf22", tgt: "PARC-f4d2be14", op: "move" },
      { qid: "PHARM-MED-001612", src: "PARC-1c2fbf22", tgt: "PARC-7e183e7c", op: "move" },
      // ─── Depuis PSY (PARC-5d51e294) — 3 questions retirées ───────────────────
      { qid: "PHARM-MED-001724", src: "PARC-5d51e294", tgt: "PARC-cb994abd", op: "move" },
      { qid: "PHARM-MED-001732", src: "PARC-5d51e294", tgt: "PARC-218ef505", op: "move" },
      { qid: "PHARM-MED-001736", src: "PARC-5d51e294", tgt: "PARC-f64bdabf", op: "move" },
      // ─── Depuis RESP (PARC-5aa8f0d6) — 3 questions retirées ──────────────────
      { qid: "PHARM-CON-000208", src: "PARC-5aa8f0d6", tgt: "PARC-0da80efd", op: "move" },
      { qid: "PHARM-CON-000213", src: "PARC-5aa8f0d6", tgt: "PARC-47e2d2dc", op: "move" },
      { qid: "PHARM-CON-000218", src: "PARC-5aa8f0d6", tgt: "PARC-47e2d2dc", op: "move" },
    ];

    // 7 nouvelles questions (à lier après import catalog-sync Lot 5)
    const NEW_LINKS = [
      { eid: "LEGACY-LOT5_RESP-resp-001",      tgt: "PARC-5aa8f0d6" },
      { eid: "LEGACY-LOT5_RESP-resp-002",      tgt: "PARC-5aa8f0d6" },
      { eid: "LEGACY-LOT5_RESP-resp-003",      tgt: "PARC-5aa8f0d6" },
      { eid: "LEGACY-LOT5_PSY-psycho-001",     tgt: "PARC-5d51e294" },
      { eid: "LEGACY-LOT5_PSY-psycho-002",     tgt: "PARC-5d51e294" },
      { eid: "LEGACY-LOT5_AGE_FALL-chutes-001", tgt: "PARC-1c2fbf22" },
      { eid: "LEGACY-LOT5_AGE_FALL-chutes-002", tgt: "PARC-1c2fbf22" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      const rem = await removeFromParcours(r.src, r.qid);
      entry.removeFrom = rem;
      if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
      await addToParcours(r.tgt, r.qid);
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-lot5-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ─── Macro-lot 6 : recomposition de 13 parcours ───────────────────────────────
app.post("/api/admin/execute-macrolot6-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 28 réaffectations depuis Pharmeval_MacroLot6_recomposition_13_parcours.xlsx (feuille Réaffectations)
    const REASSIGNMENTS = [
      // ─── CYP (PARC-b593f716) ─────────────────────────────────────────────────
      { qid: "PHARM-MED-001748", src: "PARC-b593f716", tgt: "PARC-123d62aa", op: "move" },
      // ─── MÉDICAMENTS À RISQUE (PARC-02472517) ────────────────────────────────
      { qid: "PHARM-MED-001936", src: "PARC-02472517", tgt: "PARC-2b499f41", op: "move" },
      { qid: "PHARM-MED-001935", src: "PARC-02472517", tgt: "PARC-e7b8e5f7", op: "move" },
      // ─── SIGNAUX D'ALERTE REIN/IONS (PARC-1c37cd49) ─────────────────────────
      { qid: "PHARM-MED-001977", src: "PARC-1c37cd49", tgt: "PARC-7e183e7c", op: "move" },
      { qid: "PHARM-MED-001980", src: "PARC-1c37cd49", tgt: "PARC-7e183e7c", op: "move" },
      // ─── SÉCURISER LA DÉLIVRANCE (PARC-b8b5e707) ────────────────────────────
      { qid: "PHARM-BPP-000093", src: "PARC-b8b5e707", tgt: "PARC-0967ca1e", op: "move" },
      { qid: "PHARM-GAL-000067", src: "PARC-b8b5e707", tgt: "PARC-72d442c7", op: "move" },
      // ─── FOIE ET MÉDICAMENTS (PARC-cf14b388) ─────────────────────────────────
      { qid: "PHARM-MED-002315", src: "PARC-cf14b388", tgt: "PARC-27eff0ee", op: "move" },
      { qid: "PHARM-MED-002316", src: "PARC-cf14b388", tgt: "PARC-218ef505", op: "move" },
      { qid: "PHARM-MED-002322", src: "PARC-cf14b388", tgt: "PARC-7f7e8849", op: "move" },
      // ─── ANTIBIOTIQUES BON USAGE (PARC-54c6557a) ────────────────────────────
      { qid: "PHARM-BPP-000064", src: "PARC-54c6557a", tgt: "PARC-0967ca1e", op: "move" },
      { qid: "PHARM-BPP-000063", src: "PARC-54c6557a", tgt: "PARC-0967ca1e", op: "move" },
      // ─── ANTIBIOTIQUES POSOLOGIES (PARC-12bfd424) ───────────────────────────
      { qid: "PHARM-MED-001368", src: "PARC-12bfd424", tgt: "PARC-6c4a784b", op: "move" },
      { qid: "PHARM-MED-001370", src: "PARC-12bfd424", tgt: "PARC-f40cf133", op: "move" },
      // ─── CANCER ET IMMUNOSUPPRESSION (PARC-ca2b6d43) ────────────────────────
      { qid: "PHARM-MED-001813", src: "PARC-ca2b6d43", tgt: "PARC-2b499f41", op: "move" },
      { qid: "PHARM-MED-001821", src: "PARC-ca2b6d43", tgt: "PARC-f88ff159", op: "move" },
      // ─── DÉPISTAGE DES CANCERS (PARC-f88ff159) ──────────────────────────────
      { qid: "PHARM-CON-000187", src: "PARC-f88ff159", tgt: "PARC-c8dae3d2", op: "move" },
      { qid: "PHARM-CON-000185", src: "PARC-f88ff159", tgt: "PARC-c8dae3d2", op: "move" },
      // ─── SANTÉ SEXUELLE (PARC-142924a5) ─────────────────────────────────────
      { qid: "PHARM-MED-002162", src: "PARC-142924a5", tgt: "PARC-f64bdabf", op: "move" },
      // ─── NAUSÉES/TRANSIT (PARC-74295162) ────────────────────────────────────
      { qid: "PHARM-MED-001563", src: "PARC-74295162", tgt: "PARC-976f4c1b", op: "move" },
      { qid: "PHARM-MED-001565", src: "PARC-74295162", tgt: "PARC-d0f2d36d", op: "move" },
      // ─── ANTIDÉPRESSEURS (PARC-7fd267b1) ────────────────────────────────────
      { qid: "PHARM-MED-001755", src: "PARC-7fd267b1", tgt: "PARC-b5c17256", op: "move" },
      // ─── ANTIÉPILEPTIQUES (PARC-53201adc) ───────────────────────────────────
      { qid: "PHARM-MED-001800", src: "PARC-53201adc", tgt: "PARC-7fd267b1", op: "move" },
      { qid: "PHARM-MED-001801", src: "PARC-53201adc", tgt: "PARC-1d6d7bda", op: "move" },
      // ─── "Ajouter aussi" ─────────────────────────────────────────────────────
      { qid: "PHARM-MED-001999", src: "PARC-a219d70f", tgt: "PARC-54c6557a", op: "addAlso" },
      { qid: "PHARM-MED-001545", src: "PARC-663880f0", tgt: "PARC-02472517", op: "addAlso" },
      { qid: "PHARM-MED-001492", src: "PARC-31e6e4cf", tgt: "PARC-1c37cd49", op: "addAlso" },
      { qid: "PHARM-MED-001495", src: "PARC-31e6e4cf", tgt: "PARC-1c37cd49", op: "addAlso" },
    ];

    // 11 nouvelles questions (à lier après import catalog-sync Macro-lot 6)
    const NEW_LINKS = [
      { eid: "LEGACY-MACRO6_LIVER-foie-001",        tgt: "PARC-cf14b388" },
      { eid: "LEGACY-MACRO6_LIVER-foie-002",        tgt: "PARC-cf14b388" },
      { eid: "LEGACY-MACRO6_LIVER-foie-003",        tgt: "PARC-cf14b388" },
      { eid: "LEGACY-MACRO6_SCREEN-depistage-001",  tgt: "PARC-f88ff159"  },
      { eid: "LEGACY-MACRO6_ABXSAFE-abxsafe-001",   tgt: "PARC-54c6557a"  },
      { eid: "LEGACY-MACRO6_ONCO-onco-001",         tgt: "PARC-ca2b6d43"  },
      { eid: "LEGACY-MACRO6_ONCO-onco-002",         tgt: "PARC-ca2b6d43"  },
      { eid: "LEGACY-MACRO6_DISP-delivrance-001",   tgt: "PARC-b8b5e707"  },
      { eid: "LEGACY-MACRO6_DISP-delivrance-002",   tgt: "PARC-b8b5e707"  },
      { eid: "LEGACY-MACRO6_WOMEN-sexuelle-001",    tgt: "PARC-142924a5"  },
      { eid: "LEGACY-MACRO6_CYP-cyp-001",           tgt: "PARC-b593f716"  },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const locations = [];
      const updates = {};
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-macrolot6-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ===================== MACRO-LOT 7 — 12 parcours, 0 nouvelles questions =====================
app.post("/api/admin/execute-macrolot7-reassignments", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    const REASSIGNMENTS = [
      // Déplacer (11)
      { qid: "PHARM-MED-001994", op: "move", src: "PARC-a219d70f", tgt: "PARC-142924a5" },
      { qid: "PHARM-MED-001877", op: "move", src: "PARC-3f4a7070",  tgt: "PARC-cb85e54b" },
      { qid: "PHARM-DEO-000107", op: "move", src: "PARC-43217a1e", tgt: "PARC-cf324063" },
      { qid: "PHARM-BAP-000065", op: "move", src: "PARC-7d813ae0", tgt: "PARC-73cd2233" },
      { qid: "PHARM-BAP-000092", op: "move", src: "PARC-1a62a13e", tgt: "PARC-73cd2233" },
      { qid: "PHARM-MED-001297", op: "move", src: "PARC-27eff0ee", tgt: "PARC-7fd267b1" },
      { qid: "PHARM-MED-001548", op: "move", src: "PARC-663880f0", tgt: "PARC-a14a3328" },
      { qid: "PHARM-MED-001622", op: "move", src: "PARC-079e1eb2", tgt: "PARC-7e183e7c" },
      { qid: "PHARM-MED-001488", op: "move", src: "PARC-31e6e4cf", tgt: "PARC-f40cf133" },
      { qid: "PHARM-CON-000204", op: "move", src: "PARC-8d7e93ee", tgt: "PARC-93f80356" },
      { qid: "PHARM-MED-001912", op: "move", src: "PARC-cb85e54b", tgt: "PARC-6135d803" },
      // Ajouter aussi (5)
      { qid: "PHARM-MED-002050", op: "addAlso", src: "PARC-242d66e1", tgt: "PARC-a219d70f" },
      { qid: "PHARM-MED-001901", op: "addAlso", src: "PARC-a14a3328", tgt: "PARC-3f4a7070" },
      { qid: "PHARM-BPP-000092", op: "addAlso", src: "PARC-cf324063", tgt: "PARC-43217a1e" },
      { qid: "PHARM-BAP-000064", op: "addAlso", src: "PARC-7d813ae0", tgt: "PARC-1a62a13e" },
      { qid: "PHARM-MED-001459", op: "addAlso", src: "PARC-31e6e4cf", tgt: "PARC-8d7e93ee" },
    ];
    const NEW_LINKS = [];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const updates = {};
      const locations = [];
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, reassignments: [], newLinks: [], errors: [] };

    for (const r of REASSIGNMENTS) {
      const entry = { questionId: r.qid, from: r.src, to: r.tgt, op: r.op, status: "ok" };
      if (r.op === "move") {
        const rem = await removeFromParcours(r.src, r.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = "Question absente du parcours source."; }
        await addToParcours(r.tgt, r.qid);
      } else if (r.op === "addAlso") {
        await addToParcours(r.tgt, r.qid);
        entry.note = "conservée dans la source, ajoutée à la cible";
      }
      report.reassignments.push(entry);
    }

    for (const link of NEW_LINKS) {
      const entry = { editorialId: link.eid, targetParcours: link.tgt, status: "ok" };
      const qSnap = await db.collection("questions")
        .where("externalIds.editorialCatalog", "==", link.eid).limit(1).get();
      if (qSnap.empty) {
        entry.status = "error"; entry.error = "Question introuvable par ID éditorial";
        report.errors.push(entry);
      } else {
        entry.questionId = qSnap.docs[0].id;
        await addToParcours(link.tgt, entry.questionId);
      }
      report.newLinks.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-macrolot7-reassignments]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ===================== AUDIT FINAL 05/08/2026 — 4 corrections certaines =====================
app.post("/api/admin/execute-audit-final-corrections", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 1 rattachement manquant (Critique) + 3 retraits redondants (Lithium)
    const CORRECTIONS = [
      { op: "addAlso", qid: "PHARM-MED-001559", tgt: "PARC-74295162",  note: "Critique — rattachement manquant Nausées/transit" },
      { op: "remove",  qid: "PHARM-MED-001574", src: "PARC-2d6d79e4",  note: "Lithium +3 — gastro-entérite doublon PHARM-MED-001461" },
      { op: "remove",  qid: "PHARM-MED-001575", src: "PARC-2d6d79e4",  note: "Lithium +3 — régime sans sel doublon bloc déshydratation" },
      { op: "remove",  qid: "PHARM-MED-001710", src: "PARC-2d6d79e4",  note: "Lithium +3 — interaction thiazidique doublon PHARM-MED-001771" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const updates = {};
      const locations = [];
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    async function addToParcours(parcoursId, questionId) {
      if (!dryRun) {
        await db.collection("parcours").doc(parcoursId).update({
          directQuestionIds: admin.firestore.FieldValue.arrayUnion(questionId),
        });
      }
    }

    const report = { dryRun, corrections: [], errors: [] };

    for (const c of CORRECTIONS) {
      const entry = { questionId: c.qid, op: c.op, note: c.note, status: "ok" };
      if (c.op === "addAlso") {
        entry.target = c.tgt;
        await addToParcours(c.tgt, c.qid);
      } else if (c.op === "remove") {
        entry.source = c.src;
        const rem = await removeFromParcours(c.src, c.qid);
        entry.removeFrom = rem;
        if (!rem.found) { entry.status = "warning"; entry.warning = rem.error; }
      }
      report.corrections.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-audit-final-corrections]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ===================== AUDIT FINAL — 20 retraits doublons (exacts + quasi identiques) =====================
app.post("/api/admin/execute-audit-doublons-correction", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    // 11 doublons exacts + 9 quasi identiques — retrait de la question redondante uniquement
    const RETRAITS = [
      // — Doublons exacts (11) —
      { qid: "PHARM-CON-000290", src: "PARC-0da80efd", note: "Alcool : risques — doublon sédation/dépression respiratoire" },
      { qid: "PHARM-MED-002164", src: "PARC-eed443e5", note: "Alcool, digestion — doublon ibuprofène + alcool" },
      { qid: "PHARM-MED-002237", src: "PARC-6135d803", note: "Tuberculose — doublon coloration orange-rouge rifampicine" },
      { qid: "PHARM-MED-002281", src: "PARC-6d6a71d0", note: "Sevrage tabagique — doublon substituts nicotiniques post-infarctus" },
      { qid: "PHARM-CON-000331", src: "PARC-93f80356", note: "Cancer colorectal — doublon comportement réduisant le risque" },
      { qid: "PHARM-MED-001370", src: "PARC-f40cf133", note: "Pharmacie du voyageur — doublon cauchemars méfloquine" },
      { qid: "PHARM-MED-001488", src: "PARC-f40cf133", note: "Pharmacie du voyageur — doublon adaptation basal-bolus décalage horaire" },
      { qid: "PHARM-MED-002073", src: "PARC-518cf48c", note: "Médicaments et troubles cognitifs — doublon rispéridone personne âgée démence" },
      { qid: "PHARM-MED-002078", src: "PARC-518cf48c", note: "Médicaments et troubles cognitifs — doublon Alzheimer léger sans traitement cognitif" },
      { qid: "PHARM-MED-002218", src: "PARC-15da76fe", note: "Sommeil — doublon zolpidem 6 mois demande augmentation dose" },
      { qid: "PHARM-MED-002335", src: "PARC-47e2d2dc", note: "Pédiatrie — doublon ibuprofène enfant déshydraté" },
      // — Doublons quasi identiques (9) —
      { qid: "PHARM-FTM-000079", src: "PARC-72d442c7", note: "Préparations magistrales — quasi doublon rappel lot matière première" },
      { qid: "PHARM-MED-002168", src: "PARC-eed443e5", note: "Alcool, digestion — quasi doublon metformine + alcool" },
      { qid: "PHARM-MED-002270", src: "PARC-8a51e8d5", note: "Hypertension — quasi doublon ramipril–valsartan double blocage" },
      { qid: "PHARM-MED-002156", src: "PARC-f4d2be14", note: "BPCO — quasi doublon prednisone long cours GOLD III" },
      { qid: "PHARM-MED-002098", src: "PARC-2b499f41", note: "Cancer du sein — quasi doublon antidépresseur + tamoxifène" },
      { qid: "PHARM-BPP-000093", src: "PARC-0967ca1e", note: "BPPO — quasi doublon critères sélection fournisseurs" },
      { qid: "PHARM-MED-002076", src: "PARC-518cf48c", note: "Médicaments et troubles cognitifs — quasi doublon rispéridone troubles comportementaux démence" },
      { qid: "PHARM-MED-002122", src: "PARC-ea3ac86c", note: "Psychotropes — quasi doublon lorazépam sans traitement de fond" },
      { qid: "PHARM-CON-000386", src: "PARC-47e2d2dc", note: "Pédiatrie — quasi doublon nourrisson < 3 mois ≥ 38 °C" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const updates = {};
      const locations = [];
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    const report = { dryRun, retraits: [], warnings: 0 };

    for (const r of RETRAITS) {
      const entry = { questionId: r.qid, parcours: r.src, note: r.note, status: "ok" };
      const rem = await removeFromParcours(r.src, r.qid);
      entry.removeFrom = rem;
      if (!rem.found) { entry.status = "warning"; entry.warning = rem.error; report.warnings++; }
      report.retraits.push(entry);
    }

    res.json(report);
  } catch (err) {
    console.error("[execute-audit-doublons-correction]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ===================== PATCH ÉNONCÉS V3 — conflit-aware =====================
app.post("/api/admin/apply-question-patch-v3", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).json({ error: "Accès refusé" });
    const { items, dryRun } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items manquants" });
    if (items.length > 1000) return res.status(400).json({ error: "Trop d'items (max 1000)" });

    const db = admin.firestore();
    const ids = [...new Set(items.map((it) => it.pedagogicalId).filter(Boolean))];
    const docMap = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const snaps = await Promise.all(chunk.map((id) => db.collection(QUESTIONS_COLLECTION).doc(id).get()));
      chunk.forEach((id, j) => { docMap[id] = snaps[j]; });
    }

    const report = { dryRun: !!dryRun, mis_a_jour: [], deja_conforme: [], conflits: [], introuvables: [] };
    let writeBatch = db.batch(), writeCount = 0;
    const commitQueue = [];

    function flushBatch() {
      if (writeCount > 0) { commitQueue.push(writeBatch.commit()); writeBatch = db.batch(); writeCount = 0; }
    }

    for (const item of items) {
      const { pedagogicalId: pid, question_finale, valeurs_actuelles_acceptees } = item;
      if (!pid || !question_finale) continue;
      const snap = docMap[pid];
      if (!snap || !snap.exists) { report.introuvables.push(pid); continue; }
      const current = snap.data().question || "";
      if (current === question_finale) { report.deja_conforme.push(pid); continue; }
      const accepted = Array.isArray(valeurs_actuelles_acceptees) ? valeurs_actuelles_acceptees : [];
      if (accepted.length > 0 && !accepted.includes(current)) {
        report.conflits.push({ pedagogicalId: pid, current: current.slice(0, 80) });
        continue;
      }
      report.mis_a_jour.push(pid);
      if (!dryRun) {
        const ref = db.collection(QUESTIONS_COLLECTION).doc(pid);
        writeBatch.update(ref, { question: question_finale, updatedAt: FieldValue.serverTimestamp() });
        writeCount++;
        if (writeCount >= 499) flushBatch();
      }
    }

    if (!dryRun) { flushBatch(); await Promise.all(commitQueue); }
    res.json(report);
  } catch (err) {
    console.error("[apply-question-patch-v3]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

// ===================== POST-AUDIT 05/08/2026 — 2 retraits urgents =====================
app.post("/api/admin/execute-post-audit-corrections", requireAuth, async (req, res) => {
  try {
    if (!(await isRequesterAdmin(req.user.uid))) return res.status(403).send("Accès refusé");
    const dryRun = req.body.dryRun !== false;
    const db = admin.firestore();

    const RETRAITS = [
      { qid: "PHARM-MED-002251", src: "PARC-8290ad3a", note: "Question archivée (clé erronée) — retrait du parcours Parkinson" },
      { qid: "PHARM-BAP-000092", src: "PARC-73cd2233", note: "Doublon coqueluche — retrait de Grossesse, PHARM-BAP-000065 conservée" },
    ];

    async function removeFromParcours(parcoursId, questionId) {
      const ref = db.collection("parcours").doc(parcoursId);
      const snap = await ref.get();
      if (!snap.exists) return { found: false, error: "parcours introuvable" };
      const data = snap.data();
      const updates = {};
      const locations = [];
      if ((data.directQuestionIds || []).includes(questionId)) {
        locations.push("directQuestionIds");
        updates.directQuestionIds = admin.firestore.FieldValue.arrayRemove(questionId);
      }
      const comps = data.competencies || [];
      const compNames = comps.filter(c => (c.questionIds || []).includes(questionId)).map(c => c.name || "(sans nom)");
      if (compNames.length > 0) {
        locations.push(...compNames.map(n => `competencies["${n}"]`));
        updates.competencies = comps.map(c =>
          (c.questionIds || []).includes(questionId)
            ? { ...c, questionIds: c.questionIds.filter(id => id !== questionId) }
            : c
        );
      }
      if (locations.length === 0) return { found: false, error: "question non trouvée dans ce parcours" };
      if (!dryRun) await ref.update(updates);
      return { found: true, location: locations.join(" + ") };
    }

    const report = { dryRun, retraits: [] };
    for (const r of RETRAITS) {
      const entry = { questionId: r.qid, parcours: r.src, note: r.note, status: "ok" };
      const rem = await removeFromParcours(r.src, r.qid);
      entry.removeFrom = rem;
      if (!rem.found) { entry.status = "warning"; entry.warning = rem.error; }
      report.retraits.push(entry);
    }
    res.json(report);
  } catch (err) {
    console.error("[execute-post-audit-corrections]", err && err.code, err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

exports.api = onRequest(app);

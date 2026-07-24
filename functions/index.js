const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const app = express();
app.use(cors({ origin: true }));
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

app.post("/api/images", requireAuth, upload.single("file"), async (req, res) => {
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
  const pageSize = Number(req.query.pageSize) || DEFAULT_TAGS_PAGE_SIZE;
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

// Meme verification que isRequesterAdmin() dans firestore.rules : role
// 'admin' ET statut 'active' sur le document users/{uid} du requerant.
async function isRequesterAdmin(requesterUid) {
  const snap = await admin.firestore().collection("users").doc(requesterUid).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data.role === "admin" && data.status === "active";
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

// Reprend saveProgressionDocument() de
// js/services/competency-progress-catalog-service.js. Meme regle que
// firestore.rules (create ET update, identiques ici) : uniquement en son
// propre nom, identifiant conforme a uid_competencyId. Ecriture complete
// (setDoc), jamais partielle - meme principe que le client.
app.post("/api/competency-progress", requireAuth, async (req, res) => {
  const progressDocument = req.body || {};
  const expectedId = `${req.user.uid}_${progressDocument.competencyId}`;
  if (progressDocument.userId !== req.user.uid || progressDocument.id !== expectedId) {
    return res.status(403).json({ success: false, error: true });
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
  const pageSize = Number(req.query.pageSize) || DEFAULT_EVALUATIONS_PAGE_SIZE;
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

// Reprend searchQuestionsBounded() de js/services/question-catalog-service.js
// (composition du pool "Entrainement libre", question-search-provider.js).
// Meme regle que firestore.rules (match /questions/{pedagogicalId}) : tout
// utilisateur authentifie peut lire une question publiee.
app.get("/api/questions/search-bounded", requireAuth, async (req, res) => {
  const filters = parseFiltersParam(req.query.filters);
  const scanLimit = Number(req.query.maxScan) > 0 ? Number(req.query.maxScan) : DEFAULT_SEARCH_SCAN_LIMIT;
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
  const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : DEFAULT_SOURCES_PAGE_SIZE;
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

const PARCOURS_COLLECTION_FOR_GETBYID = "parcours";

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

const AUDIT_LOGS_COLLECTION = "audit_logs";
const DEFAULT_AUDIT_READ_LIMIT = 50;

// Reprend getRecentAuditEntries() de js/services/audit-service.js (journal
// d'audit, fiche utilisateur admin + tableau de bord admin). Meme regle
// que firestore.rules (match /audit_logs/{logId}) : administrateurs
// uniquement, sans exception (peut contenir des infos sur n'importe qui).
app.get("/api/audit-logs", requireAuth, async (req, res) => {
  const max = Number(req.query.limit) > 0 ? Number(req.query.limit) : DEFAULT_AUDIT_READ_LIMIT;
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
// Chaque entree doit porter le uid du demandeur (jamais celui d'un tiers,
// meme regle que question_progress), et le resultat correspondant doit
// exister et appartenir au demandeur (meme regle que la creation du
// marqueur cote firestore.rules) - le SDK Admin contournant les regles,
// ces deux verifications sont refaites ici explicitement.
app.post("/api/question-progress/apply", requireAuth, async (req, res) => {
  const { resultId, entries } = req.body || {};
  if (!resultId || !Array.isArray(entries) || entries.some((e) => e.userId !== req.user.uid)) {
    return res.status(403).json({ success: false, applied: false, error: true });
  }

  try {
    const resultSnap = await admin.firestore().collection(EVALUATION_RESULTS_COLLECTION).doc(resultId).get();
    if (!resultSnap.exists || resultSnap.data().userId !== req.user.uid) {
      return res.status(403).json({ success: false, applied: false, error: true });
    }
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

// Reprend createResultDocument() de js/services/evaluation-result-catalog-
// service.js. Meme regle "create" que firestore.rules : uniquement en son
// propre nom, identifiant du document == sessionId, ecriture unique
// (refuse si un resultat existe deja, jamais un ecrasement), et la
// session correspondante doit exister, appartenir au demandeur et etre
// deja 'submitted' - conditions verifiees ici via un get() explicite,
// comme le fait la regle Firestore.
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
    if (
      !sessionSnap.exists ||
      sessionSnap.data().userId !== req.user.uid ||
      sessionSnap.data().status !== "submitted"
    ) {
      return res.status(403).json({ success: false, error: true });
    }
    await resultRef.set(resultDocument);
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
  const max = Number(req.query.limit) > 0 ? Number(req.query.limit) : DEFAULT_CONTENT_AUDIT_LIMIT;
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
  const max = Number(req.query.limit) > 0 ? Number(req.query.limit) : DEFAULT_IMPORT_LOGS_LIMIT;
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

exports.api = onRequest(app);

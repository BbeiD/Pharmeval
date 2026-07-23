const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

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

exports.api = onRequest(app);

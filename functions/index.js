const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

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

exports.api = onRequest(app);

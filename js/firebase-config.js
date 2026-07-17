// ===================== FIREBASE CONFIG =====================
// Configuration et initialisation Firebase uniquement.
// Ce fichier ne contient aucune logique d'authentification (voir auth.js).
//
// La configuration ci-dessous est PUBLIQUE : l'apiKey d'un projet Firebase
// client n'est pas un secret (a ne pas confondre avec une cle privee ou un
// compte de service, qui ne doivent eux jamais figurer dans le code client).
// La securite reelle du projet repose exclusivement sur les regles Firebase
// (Authentication, Firestore, Storage), pas sur la confidentialite de cette
// configuration.
//
// Compatible avec le domaine autorise dans Firebase Authentication :
//   bbeid.github.io
// et l'URL de publication :
//   https://bbeid.github.io/Pharmeval/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDNSZei3ZoflF1nrFqQkHDKcsXX-yz_p1I",
  authDomain: "pharmeval-ea3d3.firebaseapp.com",
  projectId: "pharmeval-ea3d3",
  storageBucket: "pharmeval-ea3d3.firebasestorage.app",
  messagingSenderId: "244576449787",
  appId: "1:244576449787:web:ca9c6b63fa3a6fe7bf6c5e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ===================== SERVICE TABLEAU DE BORD ORGANISATION (B2B) =====================
// Point d'entree UNIQUE pour mon-organisation.js. Aucun appel Firestore direct :
// tout passe par la Cloud Function /api/org-dashboard (SDK Admin, cote serveur),
// qui verifie le role teacher/admin ET l'appartenance a l'organisation avant de
// retourner les donnees.

import { auth } from "../firebase-config.js";
import { API_BASE_URL } from "../config.js";

/**
 * Charge le tableau de bord de l'organisation du requérant.
 * Retourne les membres (même organizationId) avec leurs stats agrégées.
 *
 * @returns {Promise<{error:boolean, noOrg?:boolean, message?:string, orgName?:string, orgId?:string, members?:Array<object>}>}
 */
export async function getOrgDashboard() {
  try {
    if (!auth.currentUser) return { error: true, message: 'Vous devez être connecté.' };
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`${API_BASE_URL}/api/org-dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: true, noOrg: !!(data && data.noOrg), message: (data && data.message) || 'Erreur serveur.' };
    }
    return data;
  } catch (err) {
    console.error('[org-dashboard-service]', err);
    return { error: true, message: 'Impossible de charger le tableau de bord pour le moment.' };
  }
}

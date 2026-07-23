// ===================== SERVICE D'IMPORT EN MASSE DES UTILISATEURS (Sprint 14) =====================
// Complete user-invite-service.js (pré-provisionnement UNITAIRE) par un
// chargement Excel repetant la meme operation ligne par ligne - AUCUNE
// nouvelle regle metier : une ligne du fichier produit exactement la meme
// pré-provision qu'un remplissage manuel du formulaire "+ Pré-
// provisionner" (admin/users.js). Purement lecture/validation cote client
// ici (aucun appel Firestore), meme separation que
// ExcelCatalogConnector.load() (voir connectors/excel-catalog-connector.js)
// - l'ecriture reelle est faite ligne par ligne par
// createPendingInvitesBulk() (user-invite-service.js), apres relecture et
// confirmation explicite de l'administrateur (admin/users.js).

export const USER_IMPORT_HEADERS = ['E-mail', 'Prénom', 'Nom', 'Organisation', 'Profil', 'Groupes'];

function normalizeLookupKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function buildNameIndex(items) {
  const map = {};
  (items || []).forEach(function(item) { map[normalizeLookupKey(item.name)] = item.id; });
  return map;
}

/**
 * Lit un classeur Excel deja selectionne par l'administrateur et retourne,
 * pour chaque ligne, les champs de pré-provisionnement resolus
 * (Organisation/Profil/Groupes convertis de leur NOM affiche vers leur
 * identifiant stable, via refOptions - memes listes que celles deja
 * chargees par admin/users.js pour les filtres/le formulaire unitaire)
 * ainsi qu'un statut de validation par ligne. N'ecrit jamais dans
 * Firestore - uniquement une lecture/validation, a l'image de
 * ExcelCatalogConnector.load().
 *
 * @param {object} xlsxLib instance globale SheetJS (window.XLSX)
 * @param {ArrayBuffer} arrayBuffer
 * @param {{organizations:Array<{id:string,name:string}>, profiles:Array<{id:string,name:string}>, groups:Array<{id:string,name:string}>}} refOptions
 * @returns {{headerError:string|null, rows:Array<object>}}
 */
export function parseUserImportWorkbook(xlsxLib, arrayBuffer, refOptions) {
  const workbook = xlsxLib.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = xlsxLib.utils.sheet_to_json(sheet, { defval: '', raw: false });

  if (raw.length === 0) return { headerError: 'Le fichier ne contient aucune ligne à importer.', rows: [] };

  const actualHeaders = Object.keys(raw[0]);
  const missingHeaders = USER_IMPORT_HEADERS.filter(function(h) { return !actualHeaders.includes(h); });
  if (missingHeaders.length > 0) {
    return { headerError: 'Colonnes manquantes dans le fichier : ' + missingHeaders.join(', ') + '.', rows: [] };
  }

  const orgIndex = buildNameIndex(refOptions.organizations);
  const profileIndex = buildNameIndex(refOptions.profiles);
  const groupIndex = buildNameIndex(refOptions.groups);

  const rows = raw.map(function(r, i) {
    const rowNumber = i + 2; // ligne Excel reelle : +1 pour l'en-tete, +1 pour l'index base 0
    const errors = [];

    const email = (r['E-mail'] || '').toString().trim();
    if (!email || email.indexOf('@') === -1) errors.push('e-mail invalide ou manquant');

    const organizationName = (r['Organisation'] || '').toString().trim();
    const organizationId = organizationName ? (orgIndex[normalizeLookupKey(organizationName)] || null) : null;
    if (organizationName && !organizationId) errors.push('organisation "' + organizationName + '" inconnue');

    const profileName = (r['Profil'] || '').toString().trim();
    const profileId = profileName ? (profileIndex[normalizeLookupKey(profileName)] || null) : null;
    if (profileName && !profileId) errors.push('profil "' + profileName + '" inconnu');

    const groupNames = (r['Groupes'] || '').toString().split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    const groupIds = [];
    groupNames.forEach(function(name) {
      const id = groupIndex[normalizeLookupKey(name)];
      if (id) groupIds.push(id); else errors.push('groupe "' + name + '" inconnu');
    });

    return {
      rowNumber: rowNumber,
      email: email,
      firstName: (r['Prénom'] || '').toString().trim(),
      lastName: (r['Nom'] || '').toString().trim(),
      organizationId: organizationId,
      profileId: profileId,
      groupIds: groupIds,
      valid: errors.length === 0,
      errors: errors,
    };
  });

  return { headerError: null, rows: rows };
}

/**
 * Construit le classeur "modele" telechargeable : une premiere feuille
 * avec les en-tetes attendus et une ligne d'exemple, une seconde feuille
 * de reference listant les organisations/profils/groupes PUBLIES existants
 * (memes noms exacts que ceux resolus par parseUserImportWorkbook) pour
 * eviter toute faute de frappe a la saisie.
 *
 * @param {object} xlsxLib
 * @param {{organizations:Array<{name:string}>, profiles:Array<{name:string}>, groups:Array<{name:string}>}} refOptions
 * @returns {object} classeur SheetJS pret pour xlsxLib.writeFile(wb, filename)
 */
export function buildUserImportTemplateWorkbook(xlsxLib, refOptions) {
  const wb = xlsxLib.utils.book_new();

  const dataSheet = xlsxLib.utils.aoa_to_sheet([
    USER_IMPORT_HEADERS,
    ['prenom.nom@exemple.be', 'Prénom', 'Nom', '', '', ''],
  ]);
  xlsxLib.utils.book_append_sheet(wb, dataSheet, 'Utilisateurs à créer');

  const orgs = refOptions.organizations || [];
  const profiles = refOptions.profiles || [];
  const groups = refOptions.groups || [];
  const maxLen = Math.max(orgs.length, profiles.length, groups.length, 1);
  const refRows = [['Organisations (noms exacts)', 'Profils (noms exacts)', 'Groupes (noms exacts)']];
  for (let i = 0; i < maxLen; i++) {
    refRows.push([
      (orgs[i] && orgs[i].name) || '',
      (profiles[i] && profiles[i].name) || '',
      (groups[i] && groups[i].name) || '',
    ]);
  }
  const refSheet = xlsxLib.utils.aoa_to_sheet(refRows);
  xlsxLib.utils.book_append_sheet(wb, refSheet, 'Listes de référence');

  return wb;
}

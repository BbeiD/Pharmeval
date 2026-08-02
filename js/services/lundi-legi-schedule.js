// ===================== PLANNING LUNDI LEGI (CONSTANTE) =====================
// Source unique de verite pour les 50 semaines Lundi Legi 2026-2027.
// Chaque entree : lundi de publication (format 'AAAA-MM-JJ') -> pedagogicalId.
// Genere depuis Pharmeval_Lundi_Legi_50_reordonne.csv (07/2026).
// Decale de 5 semaines par rapport au planning initial (03/08/2026).
// A mettre a jour manuellement si une question est remplacee en cours d'annee.

export const LUNDI_LEGI_SCHEDULE = [
  { date: '2026-08-03', id: 'PHARM-LEG-000095' },
  { date: '2026-08-10', id: 'PHARM-BPP-000060' },
  { date: '2026-08-17', id: 'PHARM-LEG-000096' },
  { date: '2026-08-24', id: 'PHARM-LEG-000097' },
  { date: '2026-08-31', id: 'PHARM-DEO-000064' },
  { date: '2026-09-07', id: 'PHARM-LEG-000098' },
  { date: '2026-09-14', id: 'PHARM-LEG-000099' },
  { date: '2026-09-21', id: 'PHARM-DEO-000065' },
  { date: '2026-09-28', id: 'PHARM-LEG-000100' },
  { date: '2026-10-05', id: 'PHARM-LEG-000101' },
  { date: '2026-10-12', id: 'PHARM-LEG-000102' },
  { date: '2026-10-19', id: 'PHARM-DEO-000066' },
  { date: '2026-10-26', id: 'PHARM-LEG-000103' },
  { date: '2026-11-02', id: 'PHARM-LEG-000104' },
  { date: '2026-11-09', id: 'PHARM-LEG-000105' },
  { date: '2026-11-16', id: 'PHARM-DEO-000067' },
  { date: '2026-11-23', id: 'PHARM-DEO-000068' },
  { date: '2026-11-30', id: 'PHARM-LEG-000106' },
  { date: '2026-12-07', id: 'PHARM-LEG-000107' },
  { date: '2026-12-14', id: 'PHARM-DEO-000069' },
  { date: '2026-12-21', id: 'PHARM-LEG-000108' },
  { date: '2026-12-28', id: 'PHARM-LEG-000109' },
  { date: '2027-01-04', id: 'PHARM-DEO-000070' },
  { date: '2027-01-11', id: 'PHARM-LEG-000110' },
  { date: '2027-01-18', id: 'PHARM-DEO-000071' },
  { date: '2027-01-25', id: 'PHARM-DEO-000072' },
  { date: '2027-02-01', id: 'PHARM-DEO-000073' },
  { date: '2027-02-08', id: 'PHARM-LEG-000111' },
  { date: '2027-02-15', id: 'PHARM-DEO-000074' },
  { date: '2027-02-22', id: 'PHARM-LEG-000112' },
  { date: '2027-03-01', id: 'PHARM-DEO-000075' },
  { date: '2027-03-08', id: 'PHARM-DEO-000076' },
  { date: '2027-03-15', id: 'PHARM-LEG-000113' },
  { date: '2027-03-22', id: 'PHARM-LEG-000114' },
  { date: '2027-03-29', id: 'PHARM-BPP-000061' },
  { date: '2027-04-05', id: 'PHARM-DEO-000077' },
  { date: '2027-04-12', id: 'PHARM-LEG-000115' },
  { date: '2027-04-19', id: 'PHARM-LEG-000116' },
  { date: '2027-04-26', id: 'PHARM-LEG-000117' },
  { date: '2027-05-03', id: 'PHARM-DEO-000078' },
  { date: '2027-05-10', id: 'PHARM-BPP-000062' },
  { date: '2027-05-17', id: 'PHARM-LEG-000118' },
  { date: '2027-05-24', id: 'PHARM-LEG-000119' },
  { date: '2027-05-31', id: 'PHARM-LEG-000120' },
  { date: '2027-06-07', id: 'PHARM-LEG-000121' },
  { date: '2027-06-14', id: 'PHARM-LEG-000122' },
  { date: '2027-06-21', id: 'PHARM-DEO-000079' },
  { date: '2027-06-28', id: 'PHARM-DEO-000080' },
  { date: '2027-07-05', id: 'PHARM-DEO-000081' },
  { date: '2027-07-12', id: 'PHARM-DEO-000082' },
];

/**
 * Lundi de la semaine en cours, format 'AAAA-MM-JJ' (fuseau local).
 * Dimanche -> lundi precedent (J-6), lundi -> lui-meme.
 * @returns {string}
 */
export function currentWeekMonday() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Entree du planning correspondant a la semaine en cours, ou null si hors
 * calendrier (avant le 2026-09-07 ou apres le 2027-08-16).
 * @returns {{ date:string, id:string, weekNumber:number }|null}
 */
export function currentWeekEntry() {
  const monday = currentWeekMonday();
  const idx = LUNDI_LEGI_SCHEDULE.findIndex(function(e) { return e.date === monday; });
  if (idx === -1) return null;
  return { date: monday, id: LUNDI_LEGI_SCHEDULE[idx].id, weekNumber: idx + 1 };
}

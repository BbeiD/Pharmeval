// ===================== PLANNING LUNDI LEGI (CONSTANTE) =====================
// Source unique de verite pour les 50 semaines Lundi Legi 2026-2027.
// Chaque entree : lundi de publication (format 'AAAA-MM-JJ') -> pedagogicalId.
// Genere depuis Pharmeval_Lundi_Legi_50_reordonne.csv (07/2026).
// A mettre a jour manuellement si une question est remplacee en cours d'annee.

export const LUNDI_LEGI_SCHEDULE = [
  { date: '2026-09-07', id: 'PHARM-LEG-000003' },
  { date: '2026-09-14', id: 'PHARM-BPP-000048' },
  { date: '2026-09-21', id: 'PHARM-LEG-000004' },
  { date: '2026-09-28', id: 'PHARM-LEG-000008' },
  { date: '2026-10-05', id: 'PHARM-DEO-000043' },
  { date: '2026-10-12', id: 'PHARM-LEG-000026' },
  { date: '2026-10-19', id: 'PHARM-LEG-000023' },
  { date: '2026-10-26', id: 'PHARM-DEO-000054' },
  { date: '2026-11-02', id: 'PHARM-LEG-000010' },
  { date: '2026-11-09', id: 'PHARM-LEG-000005' },
  { date: '2026-11-16', id: 'PHARM-LEG-000015' },
  { date: '2026-11-23', id: 'PHARM-DEO-000039' },
  { date: '2026-11-30', id: 'PHARM-LEG-000011' },
  { date: '2026-12-07', id: 'PHARM-LEG-000027' },
  { date: '2026-12-14', id: 'PHARM-LEG-000024' },
  { date: '2026-12-21', id: 'PHARM-DEO-000032' },
  { date: '2026-12-28', id: 'PHARM-DEO-000035' },
  { date: '2027-01-04', id: 'PHARM-LEG-000002' },
  { date: '2027-01-11', id: 'PHARM-LEG-000009' },
  { date: '2027-01-18', id: 'PHARM-DEO-000037' },
  { date: '2027-01-25', id: 'PHARM-LEG-000022' },
  { date: '2027-02-01', id: 'PHARM-LEG-000028' },
  { date: '2027-02-08', id: 'PHARM-DEO-000060' },
  { date: '2027-02-15', id: 'PHARM-LEG-000029' },
  { date: '2027-02-22', id: 'PHARM-DEO-000038' },
  { date: '2027-03-01', id: 'PHARM-DEO-000058' },
  { date: '2027-03-08', id: 'PHARM-DEO-000047' },
  { date: '2027-03-15', id: 'PHARM-LEG-000001' },
  { date: '2027-03-22', id: 'PHARM-DEO-000033' },
  { date: '2027-03-29', id: 'PHARM-LEG-000025' },
  { date: '2027-04-05', id: 'PHARM-DEO-000053' },
  { date: '2027-04-12', id: 'PHARM-DEO-000049' },
  { date: '2027-04-19', id: 'PHARM-LEG-000016' },
  { date: '2027-04-26', id: 'PHARM-LEG-000007' },
  { date: '2027-05-03', id: 'PHARM-BPP-000037' },
  { date: '2027-05-10', id: 'PHARM-DEO-000036' },
  { date: '2027-05-17', id: 'PHARM-LEG-000012' },
  { date: '2027-05-24', id: 'PHARM-LEG-000013' },
  { date: '2027-05-31', id: 'PHARM-LEG-000014' },
  { date: '2027-06-07', id: 'PHARM-DEO-000042' },
  { date: '2027-06-14', id: 'PHARM-BPP-000034' },
  { date: '2027-06-21', id: 'PHARM-LEG-000017' },
  { date: '2027-06-28', id: 'PHARM-LEG-000018' },
  { date: '2027-07-05', id: 'PHARM-LEG-000019' },
  { date: '2027-07-12', id: 'PHARM-LEG-000020' },
  { date: '2027-07-19', id: 'PHARM-LEG-000021' },
  { date: '2027-07-26', id: 'PHARM-DEO-000062' },
  { date: '2027-08-02', id: 'PHARM-DEO-000041' },
  { date: '2027-08-09', id: 'PHARM-DEO-000056' },
  { date: '2027-08-16', id: 'PHARM-DEO-000063' },
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

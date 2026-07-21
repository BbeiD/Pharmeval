import assert from 'assert';
import {
  findMatchingSource, findMatchingSection, findMatchingCompetency,
  sourceCacheKey, sectionCacheKey, competencyCacheKey,
  computeCounterDeltasForSuccessfulCreations, formatPedagogicalId,
} from '../js/services/catalog-sync-resolution-logic.js';

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log('  [OK] ' + label); }
  else { failed++; console.log('  [FAIL] ' + label); }
}

console.log('=== findMatchingSource / findMatchingSection / findMatchingCompetency ===');
{
  const sources = [{ id: 's1', name: 'CBIP' }, { id: 's2', name: 'Vichy Dercos' }];
  check('trouve une source par nom exact', findMatchingSource('CBIP', sources).id === 's1');
  check('trouve une source insensible a la casse/accents', findMatchingSource('cbip', sources).id === 's1');
  check('ne trouve rien pour un nom absent', findMatchingSource('Inexistant', sources) === null);
  check('ne fusionne pas deux noms simplement proches (pas de fusion semantique)', findMatchingSource('Vichy Derco', sources) === null);
}
{
  const sections = [{ id: 'sec1', name: 'Introduction' }, { id: 'sec2', name: 'Chapitre 1' }];
  check('trouve une section par nom exact', findMatchingSection('Chapitre 1', sections).id === 'sec2');
  check('ne trouve rien hors de la liste fournie (deja bornee a une source)', findMatchingSection('Chapitre 1', []) === null);
}
{
  const comps = [{ id: 'SKILL-1', name: 'Interactions médicamenteuses' }];
  check('trouve une competence par nom exact', findMatchingCompetency('interactions médicamenteuses', comps).id === 'SKILL-1');
}

console.log('=== Cles de cache stables et distinctes ===');
check('sourceCacheKey insensible a la casse', sourceCacheKey('CBIP') === sourceCacheKey('cbip'));
check('sectionCacheKey distingue deux sources differentes pour le meme nom', sectionCacheKey('src1', 'Introduction') !== sectionCacheKey('src2', 'Introduction'));
check('competencyCacheKey stable', competencyCacheKey('Goutte') === competencyCacheKey('goutte'));

console.log('=== computeCounterDeltasForSuccessfulCreations — exigence "uniquement les ecritures reussies" ===');
{
  const allSections = [
    { id: 'sec-parent', name: 'Parent' },
    { id: 'sec-child', name: 'Enfant', parentSectionId: 'sec-parent' },
  ];
  // getAncestorIdsFn INJECTEE (jamais importee depuis document-count-service.js - voir commentaire du module)
  const getAncestorIdsFn = function(section) {
    if (section.id === 'sec-child') return { ancestorIds: ['sec-parent'], anomaly: null };
    return { ancestorIds: [], anomaly: null };
  };

  const created = [
    { documentSourceId: 'src1', documentSectionId: 'sec-child' },
    { documentSourceId: 'src1', documentSectionId: 'sec-child' },
    { documentSourceId: 'src2', documentSectionId: null },
  ];
  const deltas = computeCounterDeltasForSuccessfulCreations(created, allSections, getAncestorIdsFn);

  check('delta source src1 = 2', deltas.sourceDeltas.get('src1') === 2);
  check('delta source src2 = 1', deltas.sourceDeltas.get('src2') === 1);
  check('delta direct section enfant = 2', deltas.sectionDirectDeltas.get('sec-child') === 2);
  check('delta total section enfant = 2', deltas.sectionTotalDeltas.get('sec-child') === 2);
  check('delta total propage a la section parente = 2', deltas.sectionTotalDeltas.get('sec-parent') === 2);
  check('la section parente n\'a PAS de delta DIRECT (aucune question n\'y est directement classee)', !deltas.sectionDirectDeltas.has('sec-parent'));

  // EXIGENCE EXPLICITE : un tableau VIDE (aucune ecriture reussie) ne doit produire AUCUN delta
  const emptyDeltas = computeCounterDeltasForSuccessfulCreations([], allSections, getAncestorIdsFn);
  check('aucune question reussie -> aucun delta source', emptyDeltas.sourceDeltas.size === 0);
  check('aucune question reussie -> aucun delta section', emptyDeltas.sectionDirectDeltas.size === 0 && emptyDeltas.sectionTotalDeltas.size === 0);
}

console.log('=== formatPedagogicalId ===');
check('format attendu PHARM-BAP-000042', formatPedagogicalId('bap', 42) === 'PHARM-BAP-000042');
check('sequence toujours sur 6 chiffres', formatPedagogicalId('med', 1) === 'PHARM-MED-000001');

console.log('\n=== RESULTAT : ' + passed + ' passes, ' + failed + ' echecs ===');
process.exit(failed > 0 ? 1 : 0);

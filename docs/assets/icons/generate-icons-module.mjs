// Script ponctuel (non execute en prod) : lit assets/icons/svg/*.svg et ecrit js/icons.js.
// A relancer manuellement si le pack d'icones est mis a jour - jamais depuis le navigateur.
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const svgDir = join(here, 'svg');
const files = readdirSync(svgDir).filter((f) => f.endsWith('.svg')).sort();

const outlineEntries = [];
const dotEntries = [];

for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  const raw = readFileSync(join(svgDir, file), 'utf8');
  const match = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!match) throw new Error('SVG illisible : ' + file);
  const inner = match[1].trim();
  const escaped = inner.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (name.startsWith('dot-')) {
    dotEntries.push(`  '${name}': '${escaped}',`);
  } else {
    outlineEntries.push(`  '${name}': '${escaped}',`);
  }
}

const header = `// ===================== BIBLIOTHEQUE D'ICONES (remplace les emojis) =====================
// Genere UNE FOIS par assets/icons/generate-icons-module.mjs a partir du pack livre par
// ChatGPT (assets/icons/svg/*.svg, voir assets/icons/README.md) - a relancer manuellement
// (node assets/icons/generate-icons-module.mjs) si le pack est mis a jour, jamais depuis le
// navigateur (pas de fetch() runtime). Le SVG est inline directement dans le HTML construit
// par chaque page, exactement comme le reste de l'appli (voir site-header.js) - un seul
// fichier statique, coherent avec l'absence de bundler/build step du projet.
//
// ICONS (icones "trait", ex. navigation/statuts/actions) : stroke="currentColor" - la
// couleur suit celle du texte de l'element parent, pilotable par CSS comme n'importe quel
// texte (color:). DOT_ICONS (pastilles de couleur) : couleur FIXE (fill code en dur dans le
// SVG source), jamais recolorable par CSS - usage : code couleur libre, pas un statut fixe.

export const ICONS = Object.freeze({
${outlineEntries.join('\n')}
});

export const DOT_ICONS = Object.freeze({
${dotEntries.join('\n')}
});

/**
 * Construit le SVG inline d'une icone "trait" (voir ICONS ci-dessus).
 * @param {string} name - cle de ICONS (ex. 'nav-home')
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu
 */
export function icon(name, opts) {
  const inner = ICONS[name];
  if (!inner) return '';
  const size = (opts && opts.size) || 20;
  const cls = (opts && opts.className) ? ' class="' + opts.className + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + cls + '>' +
    inner + '</svg>';
}

/**
 * Construit le SVG inline d'une pastille de couleur (voir DOT_ICONS ci-dessus).
 * @param {string} name - cle de DOT_ICONS (ex. 'dot-red')
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu
 */
export function dotIcon(name, opts) {
  const inner = DOT_ICONS[name];
  if (!inner) return '';
  const size = (opts && opts.size) || 12;
  const cls = (opts && opts.className) ? ' class="' + opts.className + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + cls + '>' + inner + '</svg>';
}

/**
 * Rend n'importe quelle cle du pack (ICONS ou DOT_ICONS) sans que l'appelant
 * ait a savoir de laquelle des deux tables elle vient - utilise partout ou
 * une valeur stockee en base (ex. document.display.icon) peut etre soit un
 * pictogramme, soit une pastille de couleur (voir admin/document-sources.js).
 * @param {string} name
 * @param {{size?: number, className?: string}} [opts]
 * @returns {string} balise <svg> inline, ou chaine vide si le nom est inconnu des deux tables
 */
export function renderAnyIcon(name, opts) {
  if (DOT_ICONS[name]) return dotIcon(name, opts);
  return icon(name, opts);
}
`;

writeFileSync(join(here, '..', '..', 'js', 'icons.js'), header, 'utf8');
console.log('js/icons.js genere :', outlineEntries.length, 'icones trait +', dotEntries.length, 'pastilles.');

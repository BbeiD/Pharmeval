# Pharmeval Icon Pack

## Style
- SVG 24×24
- Trait outline unique : 1.75
- Extrémités arrondies
- Fond transparent
- Couleur par défaut : #0F9F74
- Compatible CSS, inline SVG et export PNG

## Recoloration
Les SVG utilisent une couleur de trait fixe. Claude peut :
1. remplacer `stroke="#0F9F74"` par `stroke="currentColor"` ;
2. injecter les SVG inline ;
3. piloter la couleur via CSS.

## Usage HTML
```html
<img src="assets/icons/svg/nav-home.svg" alt="" width="24" height="24">
```

## Usage recommandé dans Pharmeval
- 20–24 px dans la navigation
- 16–18 px dans les boutons
- 14–16 px dans les badges
- 28–32 px dans les états vides
- ne pas mélanger avec des emojis

## Fichiers
- `svg/` : icônes vectorielles
- `png/` : versions PNG haute résolution si disponibles
- `preview.html` : planche de contrôle
- `manifest.json` : inventaire
- `pharmeval-icons.css` : variables de charte

# Soumen Karmakar Portfolio — Vite + React

## Requirements
- Node.js 20.19+ or 22.12+
- npm

## Run locally
```bash
npm install
npm run dev
```
Open the local URL printed by Vite.

## Production build
```bash
npm run build
npm run preview
```

## Structure
- `src/App.jsx` — React application entry and preserved portfolio markup
- `src/main.jsx` — React root
- `src/styles.css` — original portfolio styles
- `public/script.js` — original interactions (navigation, animations, project filter, form, particles)
- `public/fluid.js` — original WebGL fluid effect
- `public/robots.txt` — robots rules

The portfolio's original content and styling are preserved. The existing DOM-based scripts are loaded after React mounts the page so their selectors can find the markup.

#!/bin/bash
# Avvia Radio Interna come programma (senza crearne l'installer). Doppio clic; la prima volta prepara i componenti.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""; echo " Serve Node.js: scaricalo da https://nodejs.org (versione LTS, file .pkg), installalo e riapri questo file."
  open "https://nodejs.org"; read -n 1 -s -r -p " Premi un tasto per chiudere..."; exit 1
fi
[ -d node_modules ] || { echo " Primo avvio: preparo i componenti (qualche minuto)..."; npm install --no-audit --no-fund || { read -n 1 -s -r -p " Errore. Premi un tasto..."; exit 1; }; }
echo " Avvio Radio Interna..."
npx electron .

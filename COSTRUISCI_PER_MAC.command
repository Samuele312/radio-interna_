#!/bin/bash
# Crea il programma da installare su Mac (file .dmg in dist/): uno per Mac con chip Apple e uno per Mac Intel.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""; echo " Serve Node.js: scaricalo da https://nodejs.org (versione LTS, file .pkg), installalo e riapri questo file."
  open "https://nodejs.org"; read -n 1 -s -r -p " Premi un tasto per chiudere..."; exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund || { read -n 1 -s -r -p " Errore. Premi un tasto..."; exit 1; }
npx electron-builder --mac --publish never
echo ""; echo " Fatto! I file da dare agli altri sono nella cartella dist (file .dmg)."
open dist
read -n 1 -s -r -p " Premi un tasto per chiudere..."

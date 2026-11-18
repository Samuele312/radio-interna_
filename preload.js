'use strict';
// =====================================================================
//  Ponte sicura tra le pagine e l'app. Alla radio (il sito) arriva solo il minimo indispensabile;
//  le funzioni per ospitare la radio sono visibili soltanto alle schermate che fanno parte dell'app.
// =====================================================================
const { contextBridge, ipcRenderer } = require('electron');
const ascolta = (canale, cb) => { const f = (_e, d) => cb(d); ipcRenderer.on(canale, f); return () => ipcRenderer.removeListener(canale, f); };

contextBridge.exposeInMainWorld('appRadio', {
  app: true,
  ottieni: () => ipcRenderer.invoke('app:ottieni'),
  catturaTasto: () => ipcRenderer.invoke('app:cattura-tasto'),
  impostaTasto: (azione, valore) => ipcRenderer.invoke('app:imposta-tasto', azione, valore),
  ripristinaTasti: () => ipcRenderer.invoke('app:ripristina-tasti'),
  impostazione: (chiave, valore) => ipcRenderer.invoke('app:impostazione', chiave, valore),
  riavvia: () => ipcRenderer.invoke('app:riavvia'),
  suAzione: cb => ascolta('app:azione', cb),          // tasti globali premuti: { azione, giu }
  stato: s => ipcRenderer.send('app:stato', s),       // la radio racconta all'app cosa succede (mini-finestra, icona)
  notifica: n => ipcRenderer.send('app:notifica', n),
  cambiaServer: () => ipcRenderer.send('app:cambia-server'),
});

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('appCollegati', {
    stato: () => ipcRenderer.invoke('col:stato'),
    collega: url => ipcRenderer.invoke('col:collega', url),
    ospita: on => ipcRenderer.invoke('col:ospita', on),
    tunnel: on => ipcRenderer.invoke('col:tunnel', on),
    copia: t => ipcRenderer.invoke('col:copia', t),
    suEvento: cb => ascolta('col:evento', cb),
  });
  contextBridge.exposeInMainWorld('appOverlay', {
    pronto: () => ipcRenderer.send('overlay:pronto'),
    altezza: h => ipcRenderer.send('overlay:altezza', h),
    suStato: cb => ascolta('overlay:stato', cb),
  });
}

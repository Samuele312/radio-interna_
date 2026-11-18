'use strict';
// =====================================================================
//  RADIO INTERNA — app per computer (processo principale)
//  Un solo file con tutto il "motore": finestra, tasti globali che funzionano anche con Roblox in primo piano,
//  notifiche, icona vicino all'orologio, mini-finestra sempre visibile e possibilità di ospitare la radio su questo computer.
//  La parte che si vede (la radio vera e propria) è in server/index.html, la stessa del sito.
// =====================================================================
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, globalShortcut, shell, session,
        systemPreferences, powerSaveBlocker, nativeImage, clipboard, net, screen } = require('electron');
const path = require('path'), fs = require('fs'), https = require('https');
const { fork, spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const TEST = !!process.env.RADIO_TEST;                       // solo per le prove automatiche
if (process.env.RADIO_DATI) app.setPath('userData', process.env.RADIO_DATI);

// la voce deve continuare anche a finestra nascosta o coperta dal gioco: niente "risparmio" del browser
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!TEST && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }   // una sola copia aperta

// ---------------------------------------------------------------------
//  Impostazioni dell'app (salvate in un file accanto ai dati del programma)
// ---------------------------------------------------------------------
const TASTI_PREDEFINITI = {
  'ptt': 'F8',                       // parla (si tiene premuto)
  'muta-mic': 'Ctrl+Shift+M',        // microfono acceso/spento
  'muta-audio': 'Ctrl+Shift+A',      // audio acceso/spento
  'panico': 'Ctrl+Shift+P',          // apre il modulo panico
  'mostra': 'Ctrl+Shift+R',          // mostra/nasconde la finestra
  'overlay': 'Ctrl+Shift+O',         // mini-finestra on/off
};
const PREDEFINITI = {
  server: '', recenti: [], tasti: { ...TASTI_PREDEFINITI },
  overlay: { attivo: false, x: null, y: null, clickThrough: false, opacita: 0.92 },
  avvioAutomatico: false, inTray: true, avvisoTray: false,
};
let imp = JSON.parse(JSON.stringify(PREDEFINITI));
const fileImp = () => path.join(app.getPath('userData'), 'impostazioni-app.json');
function caricaImp() {
  try {
    const d = JSON.parse(fs.readFileSync(fileImp(), 'utf8'));
    imp = { ...imp, ...d, overlay: { ...imp.overlay, ...(d.overlay || {}) }, tasti: { ...imp.tasti, ...(d.tasti || {}) } };
  } catch {}
}
let timerSalva = null;
function salvaImp() {
  clearTimeout(timerSalva);
  timerSalva = setTimeout(() => { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(fileImp(), JSON.stringify(imp, null, 2)); } catch {} }, 200);
}

// ---------------------------------------------------------------------
//  Stato condiviso
// ---------------------------------------------------------------------
let win = null, ov = null, tray = null, inChiusura = false;
let origineServer = '';                        // indirizzo della radio a cui siamo collegati
let stato = { collegato: false };              // ultimo stato mandato dalla radio (per mini-finestra e tooltip)
let bloccoSonno = null;
const invia = (canale, dati) => { if (win && !win.isDestroyed()) win.webContents.send(canale, dati); };
const soloFile = e => !!(e.senderFrame && /^file:/.test(e.senderFrame.url));

// ---------------------------------------------------------------------
//  TASTI GLOBALI — funzionano anche quando la finestra non è in primo piano (anche con Roblox a schermo intero)
//  Si usa un "gancio" sulla tastiera e sul mouse del sistema (uiohook). Se non è disponibile si ripiega sui
//  tasti rapidi normali di Electron: in quel caso "parla" diventa un interruttore (preme = parla, preme di nuovo = smette).
// ---------------------------------------------------------------------
let uio = null, UK = {}, NOMI = {}, MOD = new Set(), gancioAttivo = false, motivoNoGancio = '';
function caricaGancio() {
  try {
    const m = require('uiohook-napi');
    uio = m.uIOhook; UK = m.UiohookKey;
    for (const [n, c] of Object.entries(UK)) NOMI[c] = n;
    MOD = new Set([UK.Ctrl, UK.CtrlRight, UK.Shift, UK.ShiftRight, UK.Alt, UK.AltRight, UK.Meta, UK.MetaRight]);
    return true;
  } catch (e) { motivoNoGancio = 'modulo'; console.warn('Gancio tastiera non disponibile:', e.message); return false; }
}
function fidatoMac() { return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false); }

// "Ctrl+Shift+M", "F8", "Mouse4" → descrizione utilizzabile
function leggiTasto(s) {
  if (!s || typeof s !== 'string') return null;
  const p = s.split('+'), nome = p.pop(), mods = new Set(p);
  const m = /^Mouse([3-9])$/.exec(nome);
  const b = { nome, codice: 0, mouse: m ? +m[1] : 0, ctrl: mods.has('Ctrl'), shift: mods.has('Shift'), alt: mods.has('Alt'), meta: mods.has('Meta') };
  if (!b.mouse) { b.codice = UK[nome] || 0; if (!b.codice && !gancioAttivo) b.codice = -1; if (!b.codice) return null; }
  b.n = b.ctrl + b.shift + b.alt + b.meta;
  return b;
}
const AZIONE_OK = /^(ptt|muta-mic|muta-audio|panico|mostra|overlay|gruppo:[a-z0-9_-]{1,24})$/;
const giu = new Map();                         // azioni tenute premute → tasto che le ha attivate
let cattura = null;                            // sta aspettando un tasto da assegnare

function suPremuto(t, e) {
  if (cattura) return gestisciCattura(t, e);
  const cand = [];
  for (const [azione, v] of Object.entries(imp.tasti)) {
    const b = leggiTasto(v); if (!b) continue;
    const stesso = b.mouse ? (t.mouse === b.mouse) : (!t.mouse && t.codice === b.codice);
    if (stesso && (!b.ctrl || e.ctrlKey) && (!b.shift || e.shiftKey) && (!b.alt || e.altKey) && (!b.meta || e.metaKey)) cand.push({ azione, n: b.n });
  }
  if (!cand.length) return;
  const max = Math.max(...cand.map(c => c.n));                   // vince la combinazione più specifica
  for (const c of cand.filter(c => c.n === max)) {
    if (giu.has(c.azione)) continue;                             // ripetizione automatica del tasto: ignorata
    giu.set(c.azione, t); esegui(c.azione, true);
  }
}
function suRilasciato(t) {
  for (const [azione, tt] of [...giu]) {
    if (tt.codice === t.codice && tt.mouse === t.mouse) { giu.delete(azione); if (azione === 'ptt') esegui('ptt', false); }
  }
}
function esegui(azione, premuto) {
  if (!stato.collegato && azione !== 'mostra') return;           // fuori dalla radio i tasti non fanno nulla
  if (azione === 'mostra') { if (premuto) alternaFinestra(); return; }
  if (azione === 'overlay') { if (premuto) impostaOverlay(!imp.overlay.attivo); return; }
  if (azione === 'panico' && premuto) mostraFinestra();
  invia('app:azione', { azione, giu: premuto });
}

function avviaGancio() {
  if (!uio || gancioAttivo) return gancioAttivo;
  if (!fidatoMac()) { motivoNoGancio = 'permesso'; return false; }
  uio.on('keydown', e => suPremuto({ codice: e.keycode, mouse: 0 }, e));
  uio.on('keyup', e => suRilasciato({ codice: e.keycode, mouse: 0 }));
  uio.on('mousedown', e => suPremuto({ codice: 0, mouse: e.button }, e));
  uio.on('mouseup', e => suRilasciato({ codice: 0, mouse: e.button }));
  try { uio.start(); gancioAttivo = true; motivoNoGancio = ''; } catch (e) { motivoNoGancio = 'avvio'; console.warn('Gancio non partito:', e.message); }
  return gancioAttivo;
}

// ripiego: tasti rapidi normali (solo lettere, cifre, F1-F24 e spazio)
let pttFallback = false;
function aAcceleratore(v) {
  if (!v) return null;
  const p = v.split('+'), k = p.pop();
  if (!/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space)$/.test(k)) return null;
  const mod = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: process.platform === 'darwin' ? 'Command' : 'Super' };
  return [...p.map(x => mod[x]).filter(Boolean), k].join('+');
}
function registraRipiego() {
  globalShortcut.unregisterAll();
  if (gancioAttivo) return;
  for (const [azione, v] of Object.entries(imp.tasti)) {
    const acc = aAcceleratore(v); if (!acc) continue;
    try {
      globalShortcut.register(acc, () => {
        if (azione === 'ptt') { pttFallback = !pttFallback; esegui('ptt', pttFallback); } else esegui(azione, true);
      });
    } catch {}
  }
}

// assegnazione di un nuovo tasto: la prossima combinazione premuta (anche a finestra non in primo piano)
function gestisciCattura(t, e) {
  let tasto = null;
  if (t.mouse) { if (t.mouse < 3) return; tasto = 'Mouse' + t.mouse; }
  else {
    if (MOD.has(t.codice)) return;
    const mods = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean);
    if (t.codice === UK.Escape && !mods.length) { const c = cattura; cattura = null; clearTimeout(c.timer); return c.risolvi({ annullato: true }); }
    const nome = NOMI[t.codice]; if (!nome) return;
    tasto = [...mods, nome].join('+');
  }
  const c = cattura; cattura = null; clearTimeout(c.timer); c.risolvi({ tasto });
}
function etichetta(v) {
  if (!v) return '';
  const sp = { Space: 'Spazio', Left: '←', Right: '→', Up: '↑', Down: '↓', Backquote: '`', Escape: 'Esc', Enter: 'Invio', Backspace: 'Backspace', CapsLock: 'Bloc Maiusc' };
  return v.split('+').map(x => x === 'Meta' ? (process.platform === 'darwin' ? 'Cmd' : 'Win') : (sp[x] || x)).join(' + ');
}
function elencoTasti() { return Object.fromEntries(Object.entries(imp.tasti).map(([a, v]) => [a, { valore: v, etichetta: etichetta(v) }])); }

// ---------------------------------------------------------------------
//  Finestra principale
// ---------------------------------------------------------------------
const icona = () => nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
const pagina = n => path.join(__dirname, 'ui', n);
function creaFinestra() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 820, minHeight: 560, show: false, title: 'Radio Interna',
    backgroundColor: '#120708', icon: icona(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.once('ready-to-show', () => { if (!process.argv.includes('--nascosta')) win.show(); });
  win.on('focus', () => win.flashFrame(false));
  win.on('close', e => {
    if (inChiusura || !imp.inTray) return;
    e.preventDefault(); win.hide();
    if (!imp.avvisoTray && Notification.isSupported()) {
      imp.avvisoTray = true; salvaImp();
      new Notification({ title: 'Radio Interna continua in sottofondo', body: 'Si riapre dall\'icona vicino all\'orologio. Per chiuderla davvero: tasto destro sull\'icona → Esci.', silent: true }).show();
    }
  });
  win.on('closed', () => { win = null; });
  // la finestra naviga solo sulla radio scelta o sulle schermate dell'app: tutto il resto si apre nel browser
  const fuori = url => { if (/^https?:/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { fuori(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    const mia = url.startsWith(pathToFileURL(path.join(__dirname, 'ui')).href) || (origineServer && url.startsWith(origineServer));
    if (!mia) { e.preventDefault(); fuori(url); }
  });
  win.webContents.on('did-fail-load', (e, codice, desc, url, principale) => {
    if (principale && origineServer && url.startsWith(origineServer) && codice !== -3) vaiAlCollegamento('Non riesco a raggiungere la radio (' + desc + ')');
  });
  win.webContents.on('did-navigate', (e, url) => { if (url.startsWith('file:')) { stato = { collegato: false }; aggiornaTutto(); } });
}
function mostraFinestra() { if (!win) creaFinestra(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function alternaFinestra() { if (win && win.isVisible() && win.isFocused()) win.hide(); else mostraFinestra(); }
function vaiAlCollegamento(errore) {
  origineServer = ''; stato = { collegato: false }; aggiornaTutto();
  if (!win) creaFinestra();
  win.loadFile(pagina('collegati.html'), { query: errore ? { errore } : {} });
  if (!win.isVisible()) win.show();
}

// ---------------------------------------------------------------------
//  Collegarsi a una radio (propria o di altri)
// ---------------------------------------------------------------------
function normalizza(u) {
  u = String(u || '').trim(); if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u) ? 'http://' : 'https://') + u;
  try {
    const x = new URL(u);
    if (x.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(x.hostname)) x.protocol = 'https:';   // il microfono funziona solo in https
    return x.origin;
  } catch { return null; }
}
async function collega(url) {
  const o = normalizza(url);
  if (!o) return { errore: 'L\'indirizzo non sembra valido. Esempio: https://nome.trycloudflare.com' };
  try {
    const r = await net.fetch(o + '/api/info', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!j || !j.versione) throw new Error('x');
  } catch { return { errore: 'A questo indirizzo non risponde nessuna Radio Interna. Controlla il link (e che la radio sia accesa).' }; }
  origineServer = o; imp.server = o;
  imp.recenti = [o, ...imp.recenti.filter(x => x !== o)].slice(0, 6); salvaImp();
  if (!win) creaFinestra();
  win.loadURL(o + '/');
  return { ok: true };
}

// ---------------------------------------------------------------------
//  Ospitare la radio su questo computer (il "server" parte dentro l'app) e link pubblico temporaneo
// ---------------------------------------------------------------------
const PORTA = 3000;
let srv = null, srvLog = '', srvErrore = '';
const cartellaDati = () => app.getPath('userData');
function passwordIniziali() {
  try {
    const t = fs.readFileSync(path.join(cartellaDati(), 'password_iniziali.txt'), 'utf8');
    return { admin: (/Amministratore.*password: (\S+)/.exec(t) || [])[1] || '', staff: (/Password staff: (\S+)/.exec(t) || [])[1] || '' };
  } catch { return { admin: '', staff: '' }; }
}
async function aspettaRadio(porta, ms) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    try { const r = await net.fetch(`http://127.0.0.1:${porta}/api/info`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}
async function avviaServer() {
  if (srv) return { ok: true };
  srvLog = ''; srvErrore = '';
  fs.mkdirSync(cartellaDati(), { recursive: true });
  srv = fork(path.join(__dirname, 'server', 'server.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORTA), DB_FILE: path.join(cartellaDati(), 'db.json') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  srv.stdout.on('data', d => { srvLog = (srvLog + d).slice(-4000); });
  srv.stderr.on('data', d => { srvLog = (srvLog + d).slice(-4000); });
  srv.on('exit', () => { srv = null; fermaTunnel(); aggiornaColl(); });
  if (!(await aspettaRadio(PORTA, 10000))) {
    const l = srvLog; fermaServer();
    srvErrore = /EADDRINUSE/.test(l) ? `La porta ${PORTA} è già usata da un altro programma (forse la radio è già aperta altrove).` : 'La radio non è partita. ' + l.slice(-300);
    return { errore: srvErrore };
  }
  return { ok: true };
}
function fermaServer() { fermaTunnel(); if (srv) { try { srv.kill(); } catch {} srv = null; } }

let tun = null, tunUrl = '', tunMsg = '';
function scarica(url, dest, redir = 6) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': 'radio-interna' } }, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redir > 0) {
        r.resume(); return scarica(new URL(r.headers.location, url).href, dest, redir - 1).then(ok, ko);
      }
      if (r.statusCode !== 200) { r.resume(); return ko(new Error('Scaricamento non riuscito (' + r.statusCode + ')')); }
      const f = fs.createWriteStream(dest); r.pipe(f); f.on('finish', () => f.close(() => ok())); f.on('error', ko);
    }).on('error', ko);
  });
}
async function preparaCloudflared() {
  const dir = path.join(cartellaDati(), 'strumenti'); fs.mkdirSync(dir, { recursive: true });
  const win32 = process.platform === 'win32', mac = process.platform === 'darwin', arm = process.arch === 'arm64';
  const bin = path.join(dir, win32 ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(bin)) return bin;
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  if (mac) {
    const tgz = path.join(dir, 'cf.tgz');
    await scarica(base + `cloudflared-darwin-${arm ? 'arm64' : 'amd64'}.tgz`, tgz);
    await new Promise((ok, ko) => execFile('tar', ['-xzf', tgz, '-C', dir], e => e ? ko(e) : ok()));
    fs.rmSync(tgz, { force: true });
  } else {
    await scarica(base + (win32 ? 'cloudflared-windows-amd64.exe' : `cloudflared-linux-${arm ? 'arm64' : 'amd64'}`), bin);
  }
  if (!win32) fs.chmodSync(bin, 0o755);
  return bin;
}
async function avviaTunnel() {
  if (tun) return { ok: true };
  if (!srv) return { errore: 'Prima avvia la radio su questo computer.' };
  tunUrl = ''; tunMsg = 'Preparo il link pubblico (la prima volta scarica un piccolo programma)…'; aggiornaColl();
  let bin;
  try { bin = await preparaCloudflared(); } catch (e) { tunMsg = ''; return { errore: 'Non riesco a scaricare il programma per il link pubblico: ' + e.message }; }
  tunMsg = 'Creo il link…'; aggiornaColl();
  tun = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${PORTA}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const leggi = d => { const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d)); if (m && !tunUrl) { tunUrl = m[0]; tunMsg = ''; aggiornaColl(); } };
  tun.stdout.on('data', leggi); tun.stderr.on('data', leggi);
  tun.on('exit', () => { tun = null; tunUrl = ''; tunMsg = ''; aggiornaColl(); });
  const fine = Date.now() + 45000;
  while (!tunUrl && tun && Date.now() < fine) await new Promise(r => setTimeout(r, 300));
  if (!tunUrl) { fermaTunnel(); return { errore: 'Il link pubblico non è partito. Controlla la connessione a internet e riprova.' }; }
  return { ok: true, url: tunUrl };
}
function fermaTunnel() { if (tun) { try { tun.kill(); } catch {} } tun = null; tunUrl = ''; tunMsg = ''; }
function statoColl() {
  return { versione: app.getVersion(), piattaforma: process.platform, recenti: imp.recenti, ultimo: imp.server,
    ospite: { attivo: !!srv, porta: PORTA, url: srv ? `http://127.0.0.1:${PORTA}` : '', password: srv ? passwordIniziali() : null, errore: srvErrore },
    tunnel: { attivo: !!tun, url: tunUrl, messaggio: tunMsg } };
}
function aggiornaColl() { if (win && !win.isDestroyed() && win.webContents.getURL().startsWith('file:')) win.webContents.send('col:evento', statoColl()); }

// ---------------------------------------------------------------------
//  Mini-finestra sempre visibile (mostra chi parla anche sopra al gioco)
// ---------------------------------------------------------------------
function impostaOverlay(on) {
  imp.overlay.attivo = !!on; salvaImp();
  if (on) creaOverlay(); else if (ov && !ov.isDestroyed()) { ov.close(); ov = null; }
  aggiornaMenu();
}
function creaOverlay() {
  if (ov && !ov.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea, o = imp.overlay;
  ov = new BrowserWindow({
    width: 300, height: 150, x: o.x ?? area.x + area.width - 320, y: o.y ?? area.y + 24,
    frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    title: 'Radio Interna — mini-finestra',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  ov.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') ov.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ov.setOpacity(o.opacita || 0.92);
  ov.setIgnoreMouseEvents(!!o.clickThrough, { forward: true });
  ov.loadFile(pagina('overlay.html'));
  ov.once('ready-to-show', () => ov && ov.showInactive());
  ov.on('moved', () => { const [x, y] = ov.getPosition(); imp.overlay.x = x; imp.overlay.y = y; salvaImp(); });
  ov.on('closed', () => { ov = null; });
}
const statoOverlay = () => ({ ...stato, tastoPtt: etichetta(imp.tasti.ptt), tastoMic: etichetta(imp.tasti['muta-mic']) });
const mandaOverlay = () => { if (ov && !ov.isDestroyed()) ov.webContents.send('overlay:stato', statoOverlay()); };

// ---------------------------------------------------------------------
//  Icona vicino all'orologio, menu, tooltip
// ---------------------------------------------------------------------
function creaTray() {
  if (tray) return;
  try {
    const i = icona().resize({ width: process.platform === 'darwin' ? 18 : 22 });
    tray = new Tray(i);
    tray.on('click', () => { if (process.platform !== 'darwin') alternaFinestra(); });
    tray.on('double-click', mostraFinestra);
  } catch (e) { tray = null; return; }
  aggiornaMenu(); aggiornaTray();
}
function aggiornaTray() {
  if (!tray) return;
  tray.setToolTip(stato.collegato ? `Radio Interna — ${stato.radio || 'collegato, nessuna radio'}${stato.trasmetto ? ' · IN TRASMISSIONE' : ''}` : 'Radio Interna');
}
function aggiornaMenu() {
  const voci = [
    { label: 'Mostra / nascondi la finestra', click: alternaFinestra },
    { label: 'Mini-finestra sempre visibile', type: 'checkbox', checked: imp.overlay.attivo, click: m => impostaOverlay(m.checked) },
    { label: 'Cambia radio / server…', click: () => { mostraFinestra(); vaiAlCollegamento(); } },
    { type: 'separator' },
    { label: 'Avvia con il computer', type: 'checkbox', checked: imp.avvioAutomatico, click: m => impostazione('avvioAutomatico', m.checked) },
    { label: 'Chiudendo la finestra resta nel tray', type: 'checkbox', checked: imp.inTray, click: m => impostazione('inTray', m.checked) },
    { type: 'separator' },
    { label: 'Esci da Radio Interna', click: () => { inChiusura = true; app.quit(); } },
  ];
  const menu = Menu.buildFromTemplate(voci);
  if (tray) tray.setContextMenu(menu);
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'Radio', submenu: [
      { label: 'Cambia radio / server…', click: () => vaiAlCollegamento() },
      { label: 'Mini-finestra sempre visibile', type: 'checkbox', checked: imp.overlay.attivo, click: m => impostaOverlay(m.checked) },
      { type: 'separator' }, mac ? { role: 'close' } : { label: 'Esci', click: () => { inChiusura = true; app.quit(); } } ] },
    { role: 'editMenu' },
    { label: 'Vista', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}
function impostazione(chiave, valore) {
  if (chiave === 'avvioAutomatico') { imp.avvioAutomatico = !!valore; try { app.setLoginItemSettings({ openAtLogin: !!valore, args: ['--nascosta'] }); } catch {} }
  else if (chiave === 'inTray') imp.inTray = !!valore;
  else if (chiave === 'overlay') return impostaOverlay(!!valore);
  else if (chiave === 'overlayClickThrough') { imp.overlay.clickThrough = !!valore; if (ov && !ov.isDestroyed()) ov.setIgnoreMouseEvents(!!valore, { forward: true }); }
  else if (chiave === 'overlayOpacita') { imp.overlay.opacita = Math.min(1, Math.max(0.3, +valore || 0.92)); if (ov && !ov.isDestroyed()) ov.setOpacity(imp.overlay.opacita); }
  else return;
  salvaImp(); aggiornaMenu();
}
function aggiornaBlocco() {
  // finché si è collegati il computer non va in stop (altrimenti la voce si interrompe)
  if (stato.collegato && bloccoSonno === null) bloccoSonno = powerSaveBlocker.start('prevent-app-suspension');
  if (!stato.collegato && bloccoSonno !== null) { powerSaveBlocker.stop(bloccoSonno); bloccoSonno = null; }
}
function aggiornaTutto() { aggiornaTray(); aggiornaBlocco(); mandaOverlay(); }

// ---------------------------------------------------------------------
//  Comunicazione con le pagine (la radio, la schermata di collegamento, la mini-finestra)
// ---------------------------------------------------------------------
const testoCorto = (x, n) => String(x == null ? '' : x).slice(0, n);
ipcMain.handle('app:ottieni', () => ({
  versione: app.getVersion(), piattaforma: process.platform,
  tastiGlobali: gancioAttivo, motivo: gancioAttivo ? '' : motivoNoGancio,
  tasti: elencoTasti(), predefiniti: TASTI_PREDEFINITI,
  avvioAutomatico: imp.avvioAutomatico, inTray: imp.inTray,
  overlay: { ...imp.overlay },
}));
ipcMain.handle('app:cattura-tasto', () => new Promise(risolvi => {
  if (!gancioAttivo) return risolvi({ errore: motivoNoGancio || 'nogancio' });
  if (cattura) { clearTimeout(cattura.timer); cattura.risolvi({ annullato: true }); }
  cattura = { risolvi, timer: setTimeout(() => { cattura = null; risolvi({ annullato: true }); }, 15000) };
}));
ipcMain.handle('app:imposta-tasto', (e, azione, valore) => {
  if (!AZIONE_OK.test(String(azione))) return { errore: 'azione' };
  valore = valore === '' ? '' : String(valore);
  if (valore && !leggiTasto(valore) && !/^[A-Z0-9]$|^F\d+$|^Space$/.test(valore.split('+').pop())) return { errore: 'tasto' };
  if (valore) for (const [a, v] of Object.entries(imp.tasti)) if (a !== azione && v === valore) imp.tasti[a] = '';    // lo stesso tasto non può fare due cose
  imp.tasti[azione] = valore; salvaImp(); registraRipiego(); mandaOverlay();
  return { tasti: elencoTasti() };
});
ipcMain.handle('app:ripristina-tasti', () => { imp.tasti = { ...TASTI_PREDEFINITI }; salvaImp(); registraRipiego(); mandaOverlay(); return { tasti: elencoTasti() }; });
ipcMain.handle('app:impostazione', (e, k, v) => { impostazione(String(k), v); return true; });
ipcMain.handle('app:riavvia', () => { app.relaunch(); inChiusura = true; app.exit(0); });
ipcMain.on('app:cambia-server', () => vaiAlCollegamento());
ipcMain.on('app:stato', (e, s) => {
  if (!s || typeof s !== 'object') return;
  stato = {
    collegato: !!s.collegato, radio: testoCorto(s.radio, 60), reparto: testoCorto(s.reparto, 60), io: testoCorto(s.io, 40),
    trasmetto: !!s.trasmetto, modo: s.modo === 'ptt' ? 'ptt' : 'voce', micMutato: !!s.micMutato, cuffieMutate: !!s.cuffieMutate,
    parlanti: (Array.isArray(s.parlanti) ? s.parlanti : []).slice(0, 6).map(p => ({ nome: testoCorto(p && p.nome, 40), io: !!(p && p.io), gruppo: testoCorto(p && p.gruppo, 30) })),
    panico: s.panico && typeof s.panico === 'object' ? { nome: testoCorto(s.panico.nome, 40), motivo: testoCorto(s.panico.motivo, 80), luogo: testoCorto(s.panico.luogo, 60) } : null,
  };
  aggiornaTutto();
});
ipcMain.on('app:notifica', (e, n) => {
  if (!n || typeof n.titolo !== 'string') return;
  const urgente = !!n.urgente;
  const inPrimoPiano = win && win.isVisible() && win.isFocused();
  if (inPrimoPiano && !urgente) return;
  if (Notification.isSupported()) {
    const no = new Notification({ title: testoCorto(n.titolo, 80), body: testoCorto(n.testo, 200), silent: true, urgency: urgente ? 'critical' : 'normal', icon: icona() });
    no.on('click', mostraFinestra); no.show();
  }
  if (urgente && win && !win.isDestroyed()) {
    if (!win.isVisible()) win.showInactive();
    win.flashFrame(true);
    if (process.platform === 'darwin' && app.dock) app.dock.bounce('critical');
  }
});
// mini-finestra
ipcMain.on('overlay:pronto', () => mandaOverlay());
ipcMain.on('overlay:altezza', (e, h) => { if (ov && !ov.isDestroyed()) { h = Math.min(420, Math.max(60, Math.round(+h || 150))); const [w] = ov.getSize(); ov.setSize(w, h); } });
// schermata di collegamento (solo pagine locali dell'app)
ipcMain.handle('col:stato', e => soloFile(e) ? statoColl() : null);
ipcMain.handle('col:collega', (e, url) => soloFile(e) ? collega(url) : { errore: 'non consentito' });
ipcMain.handle('col:ospita', async (e, on) => { if (!soloFile(e)) return null; if (on) { const r = await avviaServer(); aggiornaColl(); return r; } fermaServer(); aggiornaColl(); return { ok: true }; });
ipcMain.handle('col:tunnel', async (e, on) => { if (!soloFile(e)) return null; if (on) { const r = await avviaTunnel(); aggiornaColl(); return r; } fermaTunnel(); aggiornaColl(); return { ok: true }; });
ipcMain.handle('col:copia', (e, t) => { if (soloFile(e)) clipboard.writeText(testoCorto(t, 500)); return true; });

// ---------------------------------------------------------------------
//  Avvio e chiusura
// ---------------------------------------------------------------------
app.on('second-instance', () => mostraFinestra());
app.on('before-quit', () => { inChiusura = true; });
app.on('will-quit', () => { fermaServer(); try { globalShortcut.unregisterAll(); } catch {} try { if (uio && gancioAttivo) uio.stop(); } catch {} });
app.on('window-all-closed', () => { if (!imp.inTray || inChiusura) app.quit(); });
app.on('activate', () => mostraFinestra());

app.whenReady().then(async () => {
  caricaImp();
  // permessi: solo quelli che servono alla radio (microfono, notifiche, scelta dell'uscita audio)
  const permessi = new Set(['media', 'audioCapture', 'notifications', 'speaker-selection', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(permessi.has(p)));
  session.defaultSession.setPermissionCheckHandler((wc, p) => permessi.has(p));
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
    if (!fidatoMac() && !TEST) systemPreferences.isTrustedAccessibilityClient(true);   // chiede il permesso per i tasti globali
  }
  if (caricaGancio()) avviaGancio();
  registraRipiego();
  creaTray(); aggiornaMenu();
  creaFinestra();
  if (imp.overlay.attivo) creaOverlay();
  if (imp.server && !TEST) { const r = await collega(imp.server); if (r.errore) vaiAlCollegamento(r.errore); }
  else vaiAlCollegamento();
  if (TEST) global.__radioTest = { imp: () => imp, esegui, stato: () => stato, gancio: () => gancioAttivo, win: () => win, overlay: () => ov, impostaOverlay, collega, vaiAlCollegamento, avviaServer, fermaServer };
});

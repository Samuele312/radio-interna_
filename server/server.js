'use strict';
// =====================================================================
//  RADIO INTERNA v2 — radio vocale web per server roleplay Roblox (ER:LC)
//  Avvio:  npm install   →   npm start   →   http://localhost:3000
//  Su Windows basta il doppio clic su AVVIA_RADIO.bat
//
//  Come funziona la voce: il microfono viene compresso nel browser
//  (ADPCM 16 kHz, circa 64 kbit/s) e passa dal server, che lo inoltra
//  solo a chi deve sentirlo. Niente collegamenti diretti tra browser:
//  funziona su qualsiasi rete, anche dietro il link di Cloudflare.
// =====================================================================
const express = require('express');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------
//  IMPOSTAZIONI (si possono cambiare qui o con le variabili d'ambiente)
// ---------------------------------------------------------------------
const CONFIG = {
  porta: Number(process.env.PORT) || 3000,
  adminUtente: (process.env.ADMIN_USER || 'admin').toLowerCase(),   // amministratore fisso
  adminPassword: process.env.ADMIN_PASS || '',                     // se vuota ne viene creata una casuale (vedi password_iniziali.txt)
  passwordStaffIniziale: process.env.STAFF_PASSWORD || '',         // idem; poi si cambia dal pannello
  fileDb: process.env.DB_FILE || path.join(__dirname, 'db.json'),
};
CONFIG.filePassword = path.join(path.dirname(CONFIG.fileDb), 'password_iniziali.txt');
const casuale = () => crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, 'x').slice(0, 12);
const nuovePassword = {};            // password create in questo avvio (si mostrano una volta sola)
const VERSIONE = '3.3';

// Gruppi collegati ai bottoni "Comunica a…": ogni categoria può appartenere a un gruppo
const GRUPPI = {
  ffoo: { nome: 'FF.OO', etichetta: 'Comunica alle FF.OO' },
  vvf: { nome: 'V.V.F', etichetta: 'Comunica ai V.V.F' },
  '118': { nome: 'AREU 118', etichetta: 'Comunica al 118' },
  soccorso: { nome: 'A.C.I.', etichetta: "Comunica all'A.C.I." },
};

// Sezioni del sito e fazioni con tutte le loro radio (create al primo avvio o aggiunte ai database vecchi)
const SEZIONI_BASE = [
  { chiave: 'ffoo', nome: 'FF.OO', colore: '#2a5bd7' },
  { chiave: 'soccorso', nome: 'SOCCORSO', colore: '#e8541c' },
];
const FAZIONI = [
  { sez: 'ffoo', nome: 'Polizia di Stato', colore: '#2a5bd7', gruppo: 'ffoo', radio: [
    'Centrale Operativa PS', 'Questura', 'Volanti', 'Squadra Mobile', 'Nibbio 01', 'Nibbio 02', 'U.O.P.I.',
    'Reparto Mobile', 'N.O.C.S.', 'Polizia Stradale', 'Polizia di Frontiera', 'Polizia Scientifica'] },
  { sez: 'ffoo', nome: 'Arma dei Carabinieri', colore: '#c8102e', gruppo: 'ffoo', radio: [
    'Caserma CC', 'Centrale Operativa CC', 'Radiomobile', 'PMZ 11', 'PMZ 13', 'PMZ 15', 'Alfa Charlie', 'Fiamma 98',
    'N.O.R.M. 02', 'Beccacce 01', 'A.P.I.', 'S.O.S.', 'N.A.S.', 'R.I.S.', 'G.I.S.'] },
  { sez: 'ffoo', nome: 'Guardia di Finanza', colore: '#c9a227', gruppo: 'ffoo', radio: [
    'Caserma GDF', 'Centrale Operativa GDF', 'Artiglio 01', 'Artiglio 04', 'Artiglio 08', 'Euro 31', 'Volpe 01',
    'Grifo 88', 'Delta 01', 'G.O.A.', 'P.E.F.', 'A.T.P.I.', 'Unità Cinofila', 'S.C.I.C.O.'] },
  { sez: 'ffoo', nome: 'Polizia Locale', colore: '#17a07a', gruppo: 'ffoo', radio: [
    'Comando Polizia Locale', 'Centrale Operativa PL', 'Pattuglia 01', 'Pattuglia 02', 'Pattuglia 03',
    'Pronto Intervento PL', 'Nucleo Motociclisti', 'Infortunistica Stradale', 'Nucleo Annonaria', 'Nucleo Cinofili'] },
  { sez: 'soccorso', nome: 'A.C.I.', colore: '#1565c0', gruppo: 'soccorso', radio: [
    'Centrale A.C.I.', 'Carro Attrezzi 01', 'Carro Attrezzi 02', 'Carro Attrezzi 03', 'Soccorso Pesante',
    'Soccorso Autostradale', 'Officina'] },
  { sez: 'soccorso', nome: 'Vigili del Fuoco', colore: '#d7261e', gruppo: 'vvf', radio: [
    'Sala Operativa 115', 'Comando Provinciale', 'APS 01', 'APS 02', 'Autoscala', 'Autobotte', 'S.A.F.',
    'Sommozzatori', 'N.B.C.R.', 'Elicottero Drago'] },
  { sez: 'soccorso', nome: 'AREU', colore: '#f39c12', gruppo: '118', radio: [
    'SOREU Metropolitana', 'Centrale 118', 'MSB 01', 'MSB 02', 'MSB 03', 'MSA 01', 'Automedica', 'Elisoccorso',
    'Pronto Soccorso', 'Maxi Emergenza'] },
];
const VERSIONE_DATI = 3;
const SUONI = ['chiamata', 'roger', 'ricevuto', 'attenzione', 'allerta', 'sirena-ps', 'sirena-cc', 'sirena-vvf', 'sirena-118', 'clacson', 'fischietto', 'radar'];   // 3 = sezioni FF.OO / SOCCORSO con tutte le fazioni

const CODA_MAX = 8;          // oltre 8 messaggi in coda (circa 160 ms di voce) i pacchetti per quell'ascoltatore si saltano
const DIM_PACCHETTO = 164;   // 20 ms di voce: 4 byte di intestazione + 160 byte ADPCM
const MAX_ASCOLTO = 2;       // radio che si possono ascoltare in più oltre alla propria
const MAX_MESSAGGI = 60;     // messaggi conservati per ogni radio

const nuovoId = () => crypto.randomBytes(6).toString('hex');
const testo = (v, max) => String(v ?? '').trim().slice(0, max);
const ora = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
let io = null;   // server Socket.IO (creato più sotto)

// ---------------------------------------------------------------------
//  DATABASE (file JSON, nessuna installazione aggiuntiva)
// ---------------------------------------------------------------------
let db;
function caricaDb() {
  if (fs.existsSync(CONFIG.fileDb)) {
    try {
      db = JSON.parse(fs.readFileSync(CONFIG.fileDb, 'utf8'));
    } catch (e) {
      // file rovinato (es. PC spento a metà salvataggio): si mette da parte e si riparte
      const copia = CONFIG.fileDb + '.rovinato-' + Date.now();
      fs.renameSync(CONFIG.fileDb, copia);
      console.warn(`⚠️  db.json era illeggibile: spostato in ${path.basename(copia)}, creo un database nuovo.`);
      db = null;
    }
  }
  if (!db) db = { utenti: [], categorie: [], radio: [], sessioni: {}, sezioni: [] };
  // aggiornamento dalla versione 1: aggiunge i campi nuovi senza perdere nulla
  db.utenti ||= [];
  db.categorie ||= [];
  db.radio ||= [];
  db.sessioni ||= {};
  db.registro ||= [];
  db.impostazioni ||= {};
  // password staff: se manca, o è ancora la vecchia "123" che tutti conoscono, se ne crea una casuale
  const staffNota = db.impostazioni.passwordStaff && !CONFIG.passwordStaffIniziale && pwOk('123', db.impostazioni.passwordStaff);
  if (!db.impostazioni.passwordStaff || staffNota || CONFIG.passwordStaffIniziale) {
    nuovePassword.staff = CONFIG.passwordStaffIniziale || casuale();
    db.impostazioni.passwordStaff = hashPw(nuovePassword.staff);
  }
  delete db.impostazioni.chiaveFivem;
  db.sezioni ||= [];
  if ((db.impostazioni.versioneDati || 0) < VERSIONE_DATI) {
    applicaFazioni();
    db.impostazioni.versioneDati = VERSIONE_DATI;
  }
  for (const c of db.categorie) if (c.sezioneId === undefined || (c.sezioneId && !db.sezioni.some(x => x.id === c.sezioneId))) c.sezioneId = null;
  for (const u of db.utenti) {
    delete u.fivem; delete u.fivemNome;
    u.roblox ||= '';
    u.matricola ||= '';
    u.grado ||= '';
  }
  // amministratore fisso: creato se manca. La password è quella della configurazione (ADMIN_PASS);
  // se non c'è, ne viene creata una casuale solo la prima volta (o se era ancora quella di fabbrica)
  let a = db.utenti.find(u => u.username === CONFIG.adminUtente);
  if (!a) {
    a = { id: nuovoId(), username: CONFIG.adminUtente, nome: 'Amministrazione', matricola: '', categoriaId: null,
          grado: 'Amministratore', categoriaRichiesta: null, motivazione: '', creato: Date.now() , roblox: '' };
    db.utenti.push(a);
  }
  const adminNota = a.hash && !CONFIG.adminPassword && pwOk('Radio2026', a);
  if (CONFIG.adminPassword || !a.hash || adminNota) {
    nuovePassword.admin = CONFIG.adminPassword || casuale();
    Object.assign(a, hashPw(nuovePassword.admin));
  }
  Object.assign(a, { ruolo: 'admin', stato: 'approvato' });
  salvaOra();
  if (!CONFIG.adminPassword || !CONFIG.passwordStaffIniziale) {
    // le password create a caso si salvano in un file di testo accanto al database, così non si perdono
    if (nuovePassword.admin || nuovePassword.staff) {
      let testo = '';
      try { testo = fs.readFileSync(CONFIG.filePassword, 'utf8'); } catch {}
      if (nuovePassword.admin) testo = testo.replace(/^Amministratore.*\n?/m, '') + `Amministratore  utente: ${CONFIG.adminUtente}  password: ${nuovePassword.admin}\n`;
      if (nuovePassword.staff) testo = testo.replace(/^Password staff.*\n?/m, '') + `Password staff: ${nuovePassword.staff}\n`;
      try { fs.writeFileSync(CONFIG.filePassword, testo, { mode: 0o600 }); } catch {}
    }
  }
}
// crea le sezioni e le fazioni mancanti senza toccare quello che lo staff ha già creato
function applicaFazioni() {
  const idSez = {};
  for (const b of SEZIONI_BASE) {
    let x = db.sezioni.find(e => e.nome.toLowerCase() === b.nome.toLowerCase());
    if (!x) { x = { id: nuovoId(), nome: b.nome, colore: b.colore }; db.sezioni.push(x); }
    idSez[b.chiave] = x.id;
  }
  // la "Croce Rossa" di prova della prima versione diventa AREU (stessa categoria, gli utenti restano dentro)
  const cr = db.categorie.find(c => c.nome === 'Croce Rossa');
  if (cr && !db.categorie.some(c => c.nome.toLowerCase() === 'areu') &&
      db.radio.filter(r => r.categoriaId === cr.id).every(r => r.nome === 'Centrale 118')) {
    Object.assign(cr, { nome: 'AREU', colore: '#f39c12', gruppo: '118' });
  }
  const ordineCat = [], ordineRadio = new Map();
  for (const f of FAZIONI) {
    let c = db.categorie.find(x => x.nome.toLowerCase() === f.nome.toLowerCase());
    if (!c) { c = { id: nuovoId(), nome: f.nome, colore: f.colore, gruppo: f.gruppo, aperta: false }; db.categorie.push(c); }
    c.sezioneId = idSez[f.sez];
    c.gruppo ||= f.gruppo;
    ordineCat.push(c);
    f.radio.forEach((nome, i) => {
      let r = db.radio.find(x => x.categoriaId === c.id && x.nome.toLowerCase() === nome.toLowerCase());
      if (!r) { r = { id: nuovoId(), categoriaId: c.id, nome }; db.radio.push(r); }
      ordineRadio.set(r.id, i);
    });
  }
  // le altre categorie create dallo staff finiscono nella sezione del loro gruppo
  for (const c of db.categorie) {
    if (c.sezioneId === undefined || c.sezioneId === null) c.sezioneId = c.gruppo === 'ffoo' ? idSez.ffoo : c.gruppo ? idSez.soccorso : null;
  }
  // ordine: prima le fazioni nell'ordine previsto, poi le altre; le radio nuove seguono l'ordine della lista
  db.categorie = [...ordineCat, ...db.categorie.filter(c => !ordineCat.includes(c))];
  const posCat = new Map(db.categorie.map((c, i) => [c.id, i]));
  db.radio = db.radio.map((r, i) => ({ r, i })).sort((a, b) =>
    (posCat.get(a.r.categoriaId) ?? 1e9) - (posCat.get(b.r.categoriaId) ?? 1e9) ||
    (ordineRadio.get(a.r.id) ?? 1e6 + a.i) - (ordineRadio.get(b.r.id) ?? 1e6 + b.i)).map(x => x.r);
}
function salvaOra() {
  const tmp = CONFIG.fileDb + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, CONFIG.fileDb);   // scrittura "atomica": il file non resta mai a metà
}
let timerSalva = null;
function salva() { clearTimeout(timerSalva); timerSalva = setTimeout(salvaOra, 300); }

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function pwOk(pw, u) {
  try { return crypto.timingSafeEqual(crypto.scryptSync(String(pw), u.salt, 64), Buffer.from(u.hash, 'hex')); }
  catch { return false; }
}

const utente = id => db.utenti.find(u => u.id === id);
const categoria = id => db.categorie.find(c => c.id === id);
const canale = id => db.radio.find(r => r.id === id);
const eStaff = u => !!u && (u.ruolo === 'admin' || u.ruolo === 'staff');
const gruppoDi = u => { const c = u && categoria(u.categoriaId); return c ? c.gruppo : null; };

function puoEntrare(u, r) {
  if (eStaff(u)) return true;
  const c = categoria(r.categoriaId);
  return !!c && (c.aperta || u.categoriaId === c.id);
}

// registro delle attività (visibile allo staff)
function registra(tipo, msg) {
  db.registro.unshift({ t: Date.now(), tipo, msg });
  if (db.registro.length > 400) db.registro.length = 400;
  salva();
  if (io) io.to('staff').emit('registro', db.registro[0]);
}

const profilo = u => ({
  id: u.id, username: u.username, nome: u.nome, matricola: u.matricola, grado: u.grado,
  categoriaId: u.categoriaId, ruolo: u.ruolo, stato: u.stato, categoriaRichiesta: u.categoriaRichiesta,
  motivazione: u.motivazione, roblox: u.roblox || '',
});
const profiloAdmin = u => ({ ...profilo(u), creato: u.creato, online: online.has(u.id) });

function nuovaSessione(u) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessioni[token] = u.id;
  return token;
}

// ---------------------------------------------------------------------
//  HTTP: pagina, accesso e registrazione
// ---------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/info', (req, res) => res.json({ versione: VERSIONE }));
app.get('/api/categorie', (req, res) => res.json(db.categorie.map(c => ({ id: c.id, nome: c.nome,
  sezione: (db.sezioni.find(x => x.id === c.sezioneId) || {}).nome || 'ALTRE' }))));

// limite contro i tentativi a raffica (per IP)
const tentativi = new Map();
function limita(max) {
  return (req, res, next) => {
    const adesso = Date.now();
    const chiave = req.ip + req.path;
    const t = tentativi.get(chiave) || { n: 0, da: adesso };
    if (adesso - t.da > 60000) { t.n = 0; t.da = adesso; }
    t.n++;
    tentativi.set(chiave, t);
    if (t.n > max) return res.status(429).json({ errore: 'Troppi tentativi, riprova tra un minuto' });
    next();
  };
}
setInterval(() => { const lim = Date.now() - 120000; for (const [k, t] of tentativi) if (t.da < lim) tentativi.delete(k); }, 60000);

app.post('/api/registrati', limita(20), (req, res) => {
  const b = req.body || {};
  const username = testo(b.username, 24).toLowerCase();
  const nome = testo(b.nome, 40);
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) return res.status(400).json({ errore: 'Nome utente: 3-24 caratteri (lettere, numeri, _ o .)' });
  if (String(b.password || '').length < 6) return res.status(400).json({ errore: 'La password deve avere almeno 6 caratteri' });
  if (nome.length < 2) return res.status(400).json({ errore: 'Inserisci il nome del personaggio' });
  if (username.startsWith('staff.') || username === CONFIG.adminUtente) return res.status(400).json({ errore: 'Questo nome utente è riservato' });
  if (db.utenti.some(u => u.username === username)) return res.status(409).json({ errore: 'Nome utente già in uso' });
  const u = {
    id: nuovoId(), username, nome, matricola: testo(b.matricola, 12), ...hashPw(b.password),
    ruolo: 'utente', stato: 'attesa', categoriaId: null, grado: '',
    categoriaRichiesta: categoria(b.categoriaRichiesta) ? b.categoriaRichiesta : null,
    motivazione: testo(b.motivazione, 300), creato: Date.now(), roblox: testo(b.roblox, 40),
  };
  db.utenti.push(u);
  registra('richiesta', `${u.nome} ha chiesto l'accesso`);
  const token = nuovaSessione(u);
  salva(); aggiorna();
  res.json({ token });
});

app.post('/api/accedi', limita(20), (req, res) => {
  const b = req.body || {};
  const password = String(b.password || '');
  const u = db.utenti.find(x => x.username === testo(b.username, 24).toLowerCase());
  if (u && pwOk(password, u)) {
    const token = nuovaSessione(u);
    salva();
    return res.json({ token });
  }
  // "nome del personaggio + password staff" funziona anche da qui
  if (pwOk(password, db.impostazioni.passwordStaff)) return rispostaStaff(res, b.username);
  res.status(401).json({ errore: 'Nome utente o password errati' });
});

app.post('/api/accesso-staff', limita(20), (req, res) => {
  const b = req.body || {};
  if (!pwOk(String(b.password || ''), db.impostazioni.passwordStaff)) return res.status(401).json({ errore: 'Password staff errata' });
  rispostaStaff(res, b.nome);
});

function rispostaStaff(res, nomeGrezzo) {
  const nome = testo(nomeGrezzo, 40);
  if (nome.length < 2) return res.status(400).json({ errore: 'Inserisci il nome del personaggio' });
  const slug = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 18);
  if (!slug) return res.status(400).json({ errore: 'Nome non valido' });
  const username = 'staff.' + slug;
  let u = db.utenti.find(x => x.username === username);
  if (u) {
    if (!u.accessoStaff || u.ruolo !== 'staff' || u.stato !== 'approvato') {
      return res.status(403).json({ errore: 'Questo account staff è stato disattivato dall’amministrazione' });
    }
  } else {
    u = { id: nuovoId(), username, nome, matricola: '', ...hashPw(crypto.randomBytes(16).toString('hex')),
          ruolo: 'staff', stato: 'approvato', accessoStaff: true, categoriaId: null, grado: 'Staff',
          categoriaRichiesta: null, motivazione: '', creato: Date.now() , roblox: '' };
    db.utenti.push(u);
    registra('staff', `Nuovo account staff: ${nome}`);
  }
  const token = nuovaSessione(u);
  salva(); aggiorna();
  res.json({ token });
}

app.post('/api/esci', (req, res) => {
  const t = req.body && req.body.token;
  if (t && db.sessioni[t]) { delete db.sessioni[t]; salva(); }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
//  TEMPO REALE: presenze, voce, messaggi, amministrazione
// ---------------------------------------------------------------------
const server = http.createServer(app);
// websocket subito (senza passare dal polling), niente compressione (aggiunge ritardo), controlli di vita più tolleranti per i cellulari
io = new Server(server, {
  maxHttpBufferSize: 1e5, pingInterval: 10000, pingTimeout: 25000,
  transports: ['websocket', 'polling'], perMessageDeflate: false, httpCompression: false,
});

// utenti connessi: id → { sock, n, radioId, ascolto[], stato, mic, cuffie, trasmette, silenziato, parla, ultimaVoce }
const online = new Map();
let prossimoNumero = 1;              // numero breve che accompagna ogni pacchetto di voce
const messaggi = new Map();          // radioId → ultimi messaggi
const ultimoPanico = new Map();      // uid → ora dell'ultimo panico (anti spam)

io.use((socket, next) => {
  const t = socket.handshake.auth && socket.handshake.auth.token;
  const uid = t && db.sessioni[t];
  if (!uid || !utente(uid)) return next(new Error('non_autorizzato'));
  socket.data.uid = uid;
  next();
});

function registraPresenza(sock) {
  const u = utente(sock.data.uid);
  if (!u || u.stato !== 'approvato') return;
  const prec = online.get(u.id);
  if (prec && prec.sock.id === sock.id) return;
  if (prec) {
    prec.sock.emit('avviso', 'Accesso effettuato da un’altra finestra: questa è stata scollegata');
    prec.sock.emit('sostituito');
    prec.sock.disconnect(true);
  }
  online.set(u.id, {
    sock, n: (prossimoNumero = (prossimoNumero % 60000) + 1),
    radioId: prec ? prec.radioId : null, ascolto: prec ? prec.ascolto : [], stato: prec ? prec.stato : 'online',
    mic: false, cuffie: false, trasmette: null, silenziato: prec ? prec.silenziato : false,
    parla: false, ultimaVoce: 0, gettoni: 100, ultimoGettone: Date.now(), ultimoMsg: 0, radioForzata: null,
  });
}

// Destinatari della voce di ogni utente (ricalcolati a ogni cambio di stato)
//  · normale: chi è nella stessa radio o la sta ascoltando
//  · "Comunica a…": i membri connessi del gruppo e chi comunica allo stesso gruppo
let destinatari = new Map();
function calcolaDestinatari() {
  const conn = [...online.entries()];
  const mappa = new Map();
  for (const [uid, s] of conn) {
    if (s.silenziato || s.mic || s.cuffie) { mappa.set(uid, []); continue; }
    let lista;
    if (s.trasmette) {
      lista = conn.filter(([u2, s2]) => u2 !== uid && (s2.trasmette === s.trasmette || gruppoDi(utente(u2)) === s.trasmette));
    } else if (s.radioId) {
      lista = conn.filter(([u2, s2]) => u2 !== uid && (s2.radioId === s.radioId || s2.ascolto.includes(s.radioId)));
    } else {
      lista = [];
    }
    mappa.set(uid, lista.filter(([, s2]) => !s2.cuffie).map(([, s2]) => s2.sock));
  }
  destinatari = mappa;
}

let invioInSospeso = false;
function aggiorna() {
  if (invioInSospeso) return;
  invioInSospeso = true;
  setImmediate(() => { invioInSospeso = false; inviaStato(); });
}

function inviaStato() {
  for (const sock of io.sockets.sockets.values()) {
    const u = utente(sock.data.uid);
    if (!u) { sock.emit('esci'); sock.disconnect(true); continue; }
    if (u.stato === 'approvato' && !online.has(u.id)) registraPresenza(sock);
  }
  for (const [uid, s] of online) {
    const u = utente(uid);
    if (!u || u.stato !== 'approvato' || !s.sock.connected) { online.delete(uid); continue; }
    if (s.radioId) {
      const r = canale(s.radioId);
      if (!r || (!puoEntrare(u, r) && s.radioForzata !== r.id)) s.radioId = null;
    }
    s.ascolto = s.ascolto.filter(id => { const r = canale(id); return r && puoEntrare(u, r) && id !== s.radioId; });
  }
  calcolaDestinatari();
  const listaOnline = [...online].map(([uid, s]) => {
    const u = utente(uid);
    return {
      id: uid, n: s.n, nome: u.nome, matricola: u.matricola, grado: u.grado, categoriaId: u.categoriaId,
      ruolo: u.ruolo, radioId: s.radioId, ascolto: s.ascolto, stato: s.stato, mic: s.mic, cuffie: s.cuffie,
      trasmette: s.trasmette, silenziato: s.silenziato, parla: s.parla, roblox: u.roblox || '',
    };
  });
  const base = { sezioni: db.sezioni, categorie: db.categorie, radio: db.radio, online: listaOnline, gruppi: GRUPPI };
  let perStaff = null;
  for (const sock of io.sockets.sockets.values()) {
    const u = utente(sock.data.uid);
    if (!u) continue;
    sock.emit('io', profilo(u));
    if (u.stato !== 'approvato') continue;
    let dati = base;
    if (eStaff(u)) {
      perStaff ||= { ...base, utenti: db.utenti.map(profiloAdmin) };
      dati = perStaff;
      sock.join('staff');
    } else {
      sock.leave('staff');
    }
    sock.emit('stato', dati);
  }
}

// voce: quando un utente smette di mandare pacchetti, smette di "parlare"
function impostaParla(uid, s, valore) {
  if (s.parla === valore) return;
  s.parla = valore;
  io.emit('parla', { id: uid, on: valore });
}
setInterval(() => {
  const adesso = Date.now();
  for (const [uid, s] of online) if (s.parla && adesso - s.ultimaVoce > 700) impostaParla(uid, s, false);
}, 100);

function inviaPanico(u, luogo, motivo) {
  const adesso = Date.now();
  if (adesso - (ultimoPanico.get(u.id) || 0) < 20000) return { errore: 'Panico già inviato da poco' };
  ultimoPanico.set(u.id, adesso);
  const g = gruppoDi(u);
  const c = categoria(u.categoriaId);
  const avviso = { id: u.id, nome: u.nome, grado: u.grado, matricola: u.matricola, reparto: c ? c.nome : '',
                   gruppo: g ? GRUPPI[g].nome : '', luogo: luogo || '', motivo: motivo || '', ora: ora() };
  // l'allarme arriva a TUTTI gli utenti connessi
  let n = 0;
  for (const [, s] of online) { s.sock.emit('panico', avviso); n++; }
  registra('panico', `🚨 PANICO di ${u.nome}: ${motivo || '—'}${luogo ? ' — ' + luogo : ''}`);
  return { n };
}

const rispondi = (ack, dati) => { if (typeof ack === 'function') ack(dati); };

io.on('connection', socket => {
  const uid = socket.data.uid;
  registraPresenza(socket);
  socket.emit('config', { gruppi: GRUPPI, maxAscolto: MAX_ASCOLTO, versione: VERSIONE });
  aggiorna();

  const sess = () => { const s = online.get(uid); return s && s.sock === socket ? s : null; };

  // ---- voce: pacchetti di 20 ms già compressi dal browser ----
  // il browser numera i pacchetti: chi ascolta così capisce se ne manca uno e può coprire il buco senza scatti
  socket.on('v', (seq, pacchetto) => {
    const s = sess();
    if (!s || !Number.isInteger(seq) || !Buffer.isBuffer(pacchetto) || pacchetto.length !== DIM_PACCHETTO) return;
    // limite di pacchetti al secondo (anti abuso): 50 al secondo sono normali, dopo un blocco di rete ne arrivano a raffica
    const adesso = Date.now();
    s.gettoni = Math.min(200, s.gettoni + (adesso - s.ultimoGettone) * 0.08);
    s.ultimoGettone = adesso;
    if (s.gettoni < 1) return;
    s.gettoni -= 1;
    if (s.silenziato || s.mic || s.cuffie || (!s.radioId && !s.trasmette)) return;
    const lista = destinatari.get(uid) || [];
    s.ultimaVoce = adesso;
    impostaParla(uid, s, true);
    for (const dest of lista) {
      // niente "volatile": un semplice messaggio di stato spedito nello stesso istante faceva sparire il pacchetto di voce.
      // Invece si manda normalmente, ma se la connessione di chi ascolta è già in coda (rete lenta) il pacchetto si salta,
      // così il ritardo non cresce all'infinito.
      const coda = dest.conn && dest.conn.writeBuffer ? dest.conn.writeBuffer.length : 0;
      if (coda > CODA_MAX) continue;
      dest.emit('v', s.n, seq & 0xffff, pacchetto);
    }
  });

  // ---- azioni dell'utente ----
  socket.on('entra', (d, ack) => {
    const s = sess();
    const u = utente(uid);
    if (!s) return rispondi(ack, { errore: 'Account non abilitato alla radio' });
    const id = d && d.radioId;
    const r = id ? canale(id) : null;
    if (id && !r) return rispondi(ack, { errore: 'Radio inesistente' });
    if (r && !puoEntrare(u, r)) return rispondi(ack, { errore: 'Non hai accesso a questa radio: chiedi all’amministrazione' });
    s.radioId = r ? r.id : null;
    s.radioForzata = null;
    s.ascolto = s.ascolto.filter(x => x !== s.radioId);
    aggiorna();
    rispondi(ack, { ok: true, messaggi: r ? (messaggi.get(r.id) || []) : [] });
  });

  socket.on('ascolta', (d, ack) => {
    const s = sess();
    const u = utente(uid);
    const r = d && canale(d.radioId);
    if (!s || !r) return rispondi(ack, { errore: 'Radio inesistente' });
    if (!puoEntrare(u, r)) return rispondi(ack, { errore: 'Non hai accesso a questa radio' });
    if (s.ascolto.includes(r.id)) s.ascolto = s.ascolto.filter(x => x !== r.id);
    else {
      if (r.id === s.radioId) return rispondi(ack, { errore: 'Sei già in questa radio' });
      if (s.ascolto.length >= MAX_ASCOLTO) return rispondi(ack, { errore: `Puoi ascoltare al massimo ${MAX_ASCOLTO} radio in più` });
      s.ascolto.push(r.id);
    }
    aggiorna();
    rispondi(ack, { ok: true });
  });

  socket.on('stato-utente', d => {
    const s = sess();
    if (s && d && ['online', 'inattivo', 'offline'].includes(d.stato)) { s.stato = d.stato; aggiorna(); }
  });

  socket.on('audio', d => {
    const s = sess();
    if (!s || !d) return;
    s.mic = !!d.micMutato;
    s.cuffie = !!d.cuffieMutate;
    aggiorna();
  });

  socket.on('trasmetti', (d, ack) => {
    const s = sess();
    if (!s) return rispondi(ack, { errore: 'Account non abilitato' });
    const g = d && d.gruppo;
    if (g && !GRUPPI[g]) return rispondi(ack, { errore: 'Gruppo inesistente' });
    if (g && g !== s.trasmette) registra('chiamata', `📢 ${utente(uid).nome} → ${GRUPPI[g].nome}`);
    s.trasmette = g || null;
    aggiorna();
    rispondi(ack, { ok: true });
  });

  // soundboard: un suono che sentono tutti quelli nella stessa radio (e chi la ascolta)
  socket.on('soundboard', (d, ack) => {
    const s = sess(), u = utente(uid), id = String(d && d.id || '');
    if (!s || !s.radioId) return rispondi(ack, { errore: 'Entra in una radio per usare la soundboard' });
    if (!SUONI.includes(id)) return rispondi(ack, { errore: 'Suono inesistente' });
    if (s.silenziato) return rispondi(ack, { errore: 'Sei stato silenziato dallo staff' });
    if (Date.now() - (s.ultimoSuono || 0) < 2500) return rispondi(ack, { errore: 'Aspetta un attimo prima di un altro suono' });
    s.ultimoSuono = Date.now();
    for (const [, s2] of online) if (s2.radioId === s.radioId || s2.ascolto.includes(s.radioId)) s2.sock.emit('soundboard', { id, nome: u.nome, radioId: s.radioId });
    rispondi(ack, { ok: true });
  });

  socket.on('messaggio', (d, ack) => {
    const s = sess();
    const u = utente(uid);
    const t = testo(d && d.testo, 200);
    if (!s || !s.radioId) return rispondi(ack, { errore: 'Entra in una radio per scrivere' });
    if (!t) return rispondi(ack, { errore: 'Messaggio vuoto' });
    if (s.silenziato) return rispondi(ack, { errore: 'Sei stato silenziato dallo staff' });
    if (Date.now() - s.ultimoMsg < 400) return rispondi(ack, { errore: 'Aspetta un attimo prima di scrivere ancora' });
    s.ultimoMsg = Date.now();
    const m = { id: nuovoId(), da: uid, nome: u.nome, grado: u.grado, testo: t, ora: ora(), radioId: s.radioId };
    const lista = messaggi.get(s.radioId) || [];
    lista.push(m);
    if (lista.length > MAX_MESSAGGI) lista.shift();
    messaggi.set(s.radioId, lista);
    for (const [, s2] of online) if (s2.radioId === s.radioId || s2.ascolto.includes(s.radioId)) s2.sock.emit('messaggio', m);
    rispondi(ack, { ok: true });
  });

  socket.on('panico', (d, ack) => {
    const u = utente(uid);
    if (!sess()) return rispondi(ack, { errore: 'Account non abilitato' });
    const motivo = testo(d && d.motivo, 120), luogo = testo(d && d.luogo, 80);
    if (!motivo || !luogo) return rispondi(ack, { errore: 'Scrivi il motivo del panico e la posizione' });
    rispondi(ack, inviaPanico(u, luogo, motivo));
  });

  socket.on('cambia-password', (d, ack) => {
    const u = utente(uid);
    if (!u || !d) return rispondi(ack, { errore: 'Richiesta non valida' });
    if (u.username === CONFIG.adminUtente) return rispondi(ack, { errore: 'La password dell’amministratore fisso si cambia nel file server.js (CONFIG)' });
    if (u.accessoStaff) return rispondi(ack, { errore: 'Gli account staff entrano con la password staff' });
    if (!pwOk(d.vecchia, u)) return rispondi(ack, { errore: 'La password attuale non è corretta' });
    if (String(d.nuova || '').length < 6) return rispondi(ack, { errore: 'La nuova password deve avere almeno 6 caratteri' });
    Object.assign(u, hashPw(d.nuova));
    salva();
    rispondi(ack, { ok: true });
  });

  socket.on('nuova-richiesta', (d, ack) => {
    const u = utente(uid);
    if (!u || u.stato !== 'rifiutato') return rispondi(ack, { errore: 'Non serve una nuova richiesta' });
    u.stato = 'attesa';
    u.categoriaRichiesta = d && categoria(d.categoriaRichiesta) ? d.categoriaRichiesta : u.categoriaRichiesta;
    u.motivazione = testo(d && d.motivazione, 300);
    registra('richiesta', `${u.nome} ha inviato una nuova richiesta`);
    salva(); aggiorna();
    rispondi(ack, { ok: true });
  });

  socket.on('disconnect', () => {
    const s = online.get(uid);
    if (s && s.sock === socket) {
      online.delete(uid);
      io.emit('parla', { id: uid, on: false });
    }
    aggiorna();
  });

  // ---- amministrazione (admin e staff hanno gli stessi permessi) ----
  const admin = (evento, fn) => socket.on(evento, (d, ack) => {
    const io_ = utente(uid);
    if (!eStaff(io_)) return rispondi(ack, { errore: 'Permessi insufficienti' });
    try {
      const r = fn(d || {}, io_);
      salva();
      inviaStato();
      rispondi(ack, r || { ok: true });
    } catch (e) { rispondi(ack, { errore: e.message }); }
  });
  const errore = m => { throw new Error(m); };
  const trovaUtente = id => utente(id) || errore('Utente inesistente');
  const trovaCategoria = id => categoria(id) || errore('Categoria inesistente');
  const trovaRadio = id => canale(id) || errore('Radio inesistente');
  const categoriaOpzionale = id => (id ? trovaCategoria(id).id : null);
  const connesso = id => online.get(id) || errore('L’utente non è connesso');

  admin('admin:approva', (d, io_) => {
    const u = trovaUtente(d.userId);
    u.stato = 'approvato';
    u.categoriaId = categoriaOpzionale(d.categoriaId);
    u.grado = testo(d.grado, 30);
    if (d.matricola !== undefined) u.matricola = testo(d.matricola, 12);
    registra('admin', `${io_.nome} ha accettato ${u.nome}`);
  });
  admin('admin:rifiuta', (d, io_) => {
    const u = trovaUtente(d.userId);
    if (u.ruolo === 'admin') errore('Non puoi rifiutare il proprietario');
    u.stato = 'rifiutato';
    registra('admin', `${io_.nome} ha rifiutato ${u.nome}`);
  });
  admin('admin:modifica-utente', (d, io_) => {
    const u = trovaUtente(d.userId);
    if (d.nome !== undefined) { const n = testo(d.nome, 40); if (n.length < 2) errore('Nome troppo corto'); u.nome = n; }
    if (d.matricola !== undefined) u.matricola = testo(d.matricola, 12);
    if (d.grado !== undefined) u.grado = testo(d.grado, 30);
    if (d.categoriaId !== undefined) u.categoriaId = categoriaOpzionale(d.categoriaId);
    if (d.ruolo !== undefined) {
      if (u.ruolo === 'admin') errore('Il ruolo del proprietario non si può cambiare');
      if (u.id === io_.id) errore('Non puoi cambiare il tuo stesso ruolo');
      if (!['utente', 'staff'].includes(d.ruolo)) errore('Ruolo non valido');
      u.ruolo = d.ruolo;
      registra('admin', `${io_.nome} ha reso ${u.nome} ${d.ruolo === 'staff' ? 'staff' : 'utente'}`);
    }
    if (d.stato !== undefined) {
      if (u.ruolo === 'admin' || u.id === io_.id) errore('Non puoi sospendere questo account');
      if (!['approvato', 'attesa', 'rifiutato'].includes(d.stato)) errore('Stato non valido');
      u.stato = d.stato;
    }
    if (d.password) {
      if (String(d.password).length < 6) errore('La password deve avere almeno 6 caratteri');
      Object.assign(u, hashPw(d.password));
      for (const [t, id] of Object.entries(db.sessioni)) if (id === u.id && u.id !== io_.id) delete db.sessioni[t];
    }
    if (d.roblox !== undefined) u.roblox = testo(d.roblox, 40);
  });
  admin('admin:elimina-utente', (d, io_) => {
    const u = trovaUtente(d.userId);
    if (u.ruolo === 'admin') errore('Il proprietario non si può eliminare');
    if (u.id === io_.id) errore('Non puoi eliminare te stesso');
    db.utenti = db.utenti.filter(x => x.id !== u.id);
    for (const [t, id] of Object.entries(db.sessioni)) if (id === u.id) delete db.sessioni[t];
    registra('admin', `${io_.nome} ha eliminato ${u.nome}`);
  });

  // sezioni (FF.OO, SOCCORSO…)
  const trovaSezione = id => db.sezioni.find(x => x.id === id) || errore('Sezione inesistente');
  const datiSezione = (x, d) => {
    if (d.nome !== undefined) { const n = testo(d.nome, 30); if (!n) errore('Il nome è obbligatorio'); x.nome = n; }
    if (d.colore !== undefined) x.colore = /^#[0-9a-f]{6}$/i.test(d.colore) ? d.colore : '#2a5bd7';
  };
  admin('admin:sezione-crea', (d, io_) => {
    const x = { id: nuovoId(), nome: '', colore: '#2a5bd7' };
    datiSezione(x, { nome: d.nome, colore: d.colore || '#2a5bd7' });
    db.sezioni.push(x);
    registra('admin', `${io_.nome} ha creato la sezione ${x.nome}`);
  });
  admin('admin:sezione-modifica', d => datiSezione(trovaSezione(d.id), d));
  admin('admin:sezione-elimina', (d, io_) => {
    const x = trovaSezione(d.id);
    db.sezioni = db.sezioni.filter(e => e.id !== x.id);
    for (const c of db.categorie) if (c.sezioneId === x.id) c.sezioneId = null;   // le categorie restano, in "Altre"
    registra('admin', `${io_.nome} ha eliminato la sezione ${x.nome}`);
  });
  admin('admin:sezione-sposta', d => sposta(db.sezioni, trovaSezione(d.id), d.dir));

  // categorie e radio
  const datiCategoria = (c, d) => {
    if (d.nome !== undefined) { const n = testo(d.nome, 40); if (!n) errore('Il nome è obbligatorio'); c.nome = n; }
    if (d.colore !== undefined) c.colore = /^#[0-9a-f]{6}$/i.test(d.colore) ? d.colore : '#c8102e';
    if (d.gruppo !== undefined) c.gruppo = GRUPPI[d.gruppo] ? d.gruppo : null;
    if (d.aperta !== undefined) c.aperta = !!d.aperta;
    if (d.sezioneId !== undefined) c.sezioneId = d.sezioneId ? trovaSezione(d.sezioneId).id : null;
  };
  admin('admin:categoria-crea', (d, io_) => {
    const c = { id: nuovoId(), nome: '', colore: '#c8102e', gruppo: null, aperta: false, sezioneId: null };
    datiCategoria(c, { nome: d.nome, colore: d.colore || '#c8102e', gruppo: d.gruppo || null, aperta: !!d.aperta, sezioneId: d.sezioneId || null });
    db.categorie.push(c);
    registra('admin', `${io_.nome} ha creato la categoria ${c.nome}`);
  });
  admin('admin:categoria-modifica', d => datiCategoria(trovaCategoria(d.id), d));
  admin('admin:categoria-elimina', (d, io_) => {
    const c = trovaCategoria(d.id);
    db.categorie = db.categorie.filter(x => x.id !== c.id);
    db.radio = db.radio.filter(r => r.categoriaId !== c.id);
    for (const u of db.utenti) {
      if (u.categoriaId === c.id) u.categoriaId = null;
      if (u.categoriaRichiesta === c.id) u.categoriaRichiesta = null;
    }
    registra('admin', `${io_.nome} ha eliminato la categoria ${c.nome}`);
  });
  admin('admin:categoria-sposta', d => {
    // si sposta solo tra le categorie della stessa sezione
    const c = trovaCategoria(d.id);
    const stesse = db.categorie.filter(x => x.sezioneId === c.sezioneId);
    const altra = stesse[stesse.indexOf(c) + (d.dir === 'su' ? -1 : 1)];
    if (!altra) return;
    const i = db.categorie.indexOf(c), j = db.categorie.indexOf(altra);
    [db.categorie[i], db.categorie[j]] = [db.categorie[j], db.categorie[i]];
  });
  admin('admin:radio-crea', (d, io_) => {
    const c = trovaCategoria(d.categoriaId);
    const n = testo(d.nome, 40);
    if (!n) errore('Il nome della radio è obbligatorio');
    db.radio.push({ id: nuovoId(), categoriaId: c.id, nome: n });
    registra('admin', `${io_.nome} ha creato la radio ${n}`);
  });
  admin('admin:radio-modifica', d => {
    const r = trovaRadio(d.id);
    if (d.nome !== undefined) { const n = testo(d.nome, 40); if (!n) errore('Il nome è obbligatorio'); r.nome = n; }
    if (d.categoriaId !== undefined) r.categoriaId = trovaCategoria(d.categoriaId).id;
  });
  admin('admin:radio-elimina', (d, io_) => {
    const r = trovaRadio(d.id);
    db.radio = db.radio.filter(x => x.id !== r.id);
    messaggi.delete(r.id);
    registra('admin', `${io_.nome} ha eliminato la radio ${r.nome}`);
  });
  admin('admin:radio-sposta', d => {
    const r = trovaRadio(d.id);
    const stesse = db.radio.filter(x => x.categoriaId === r.categoriaId);
    const altra = stesse[stesse.indexOf(r) + (d.dir === 'su' ? -1 : 1)];
    if (!altra) return;
    const a = db.radio.indexOf(r), b = db.radio.indexOf(altra);
    [db.radio[a], db.radio[b]] = [db.radio[b], db.radio[a]];
  });

  // controllo degli utenti connessi
  admin('admin:sposta-utente', (d, io_) => {
    const s = connesso(d.userId);
    const r = d.radioId ? trovaRadio(d.radioId) : null;
    s.radioId = r ? r.id : null;
    s.radioForzata = s.radioId;
    s.ascolto = s.ascolto.filter(x => x !== s.radioId);
    s.sock.emit('avviso', r ? `${io_.nome} ti ha spostato in ${r.nome}` : `${io_.nome} ti ha tolto dalla radio`);
    s.sock.emit('spostato', { radioId: s.radioId, messaggi: r ? (messaggi.get(r.id) || []) : [] });
    registra('admin', `${io_.nome} ha spostato ${utente(d.userId).nome} ${r ? 'in ' + r.nome : 'fuori dalla radio'}`);
  });
  admin('admin:silenzia', (d, io_) => {
    const s = connesso(d.userId);
    s.silenziato = !!d.on;
    if (s.silenziato) s.trasmette = null;
    s.sock.emit('avviso', s.silenziato ? `${io_.nome} ti ha silenziato` : `${io_.nome} ti ha ridato la parola`);
    registra('admin', `${io_.nome} ha ${s.silenziato ? 'silenziato' : 'riattivato'} ${utente(d.userId).nome}`);
  });
  admin('admin:espelli', (d, io_) => {
    const s = connesso(d.userId);
    if (d.userId === io_.id) errore('Non puoi espellere te stesso');
    s.sock.emit('avviso', `${io_.nome} ti ha disconnesso dal sito`);
    s.sock.emit('espulso');
    setTimeout(() => s.sock.disconnect(true), 200);
    registra('admin', `${io_.nome} ha disconnesso ${utente(d.userId).nome} dal sito`);
  });
  admin('admin:termina-chiamata', (d, io_) => {
    const s = connesso(d.userId);
    s.trasmette = null;
    s.sock.emit('avviso', `${io_.nome} ha chiuso la tua comunicazione di gruppo`);
  });

  // impostazioni e registro
  admin('admin:password-staff', (d, io_) => {
    const pw = String(d.password || '');
    if (pw.length < 3) errore('La password staff deve avere almeno 3 caratteri');
    db.impostazioni.passwordStaff = hashPw(pw);
    registra('admin', `${io_.nome} ha cambiato la password staff`);
  });
  admin('admin:registro', () => ({ registro: db.registro.slice(0, 200) }));
  admin('admin:svuota-registro', (d, io_) => { db.registro = []; registra('admin', `${io_.nome} ha svuotato il registro`); });
});

function sposta(lista, el, dir) {
  const i = lista.indexOf(el);
  const j = i + (dir === 'su' ? -1 : 1);
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
}

// salvataggio sicuro alla chiusura (Ctrl+C)
for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.on(segnale, () => {
    try { clearTimeout(timerSalva); salvaOra(); } catch {}
    console.log('\n📻 Radio Interna chiusa, dati salvati.');
    process.exit(0);
  });
}

caricaDb();
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ La porta ${CONFIG.porta} è già occupata: probabilmente la radio è già aperta in un'altra finestra.`);
    console.error('   Chiudi l’altra finestra (Ctrl+C) oppure cambia porta in server.js (CONFIG.porta).\n');
  } else {
    console.error(e);
  }
  process.exit(1);
});
server.listen(CONFIG.porta, () => {
  const reti = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n📻 Radio Interna v${VERSIONE} attiva`);
  console.log(`   Su questo PC:     http://localhost:${CONFIG.porta}`);
  for (const ip of reti) console.log(`   Nella rete di casa: http://${ip}:${CONFIG.porta}  (il microfono funziona solo con il link https)`);
  if (nuovePassword.admin || nuovePassword.staff) {
    console.log('   ┌─ PASSWORD CREATE ORA (conservale: non verranno più mostrate) ──────────');
    if (nuovePassword.admin) console.log(`   │ Amministratore → utente: ${CONFIG.adminUtente}   password: ${nuovePassword.admin}`);
    if (nuovePassword.staff) console.log(`   │ Staff → nome del personaggio + password: ${nuovePassword.staff}`);
    console.log(`   └─ sono salvate anche nel file: ${CONFIG.filePassword}`);
  } else {
    console.log(`   Amministratore → utente: ${CONFIG.adminUtente}   (password: vedi password_iniziali.txt o la variabile ADMIN_PASS)`);
    console.log('   Accesso staff  → nome del personaggio + password staff');
  }
  console.log('');
});

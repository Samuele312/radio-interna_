# 📻 Radio Interna — app per computer (v3.3)

Programma per Windows, Mac e Linux che contiene la radio e in più: **tasti personalizzati che funzionano anche con Roblox
a schermo intero**, notifiche del computer, **mini-finestra sempre visibile** che mostra chi parla, icona vicino all'orologio
e la possibilità di **ospitare la radio dal proprio computer** con un link pubblico per gli altri.

## Provarla subito sul Mac
1. Si installa **Node.js** (versione LTS, file .pkg) da nodejs.org, se non c'è già.
2. Clic destro su **AVVIA_APP.command** → *Apri* → *Apri* (solo la prima volta). Il primo avvio prepara i componenti e ci mette qualche minuto.
3. Si apre l'app. Su Mac compaiono due richieste del sistema: **microfono** e **Accessibilità** (serve per i tasti che funzionano
   fuori dalla finestra). Dopo aver concesso Accessibilità in *Impostazioni di Sistema → Privacy e sicurezza → Accessibilità*,
   l'app va chiusa e riaperta (o si preme «Riavvia l'app» in ⚙ Audio → Tasti e app).

## Creare il programma da dare a tutti
1. **Mac**: doppio clic su **COSTRUISCI_PER_MAC.command**. In `dist` compaiono due file `.dmg`: uno per i Mac con chip Apple e uno per i Mac Intel.
2. **Windows**: su un computer Windows, doppio clic su **COSTRUISCI_PER_WINDOWS.bat**. In `dist` compaiono l'installer e una versione portatile (`.exe`, senza installazione).
3. **Tutti insieme, senza computer diversi (consigliato)**: si carica la cartella su GitHub (anche privata), poi *Actions → Crea i programmi → Run workflow*.
   GitHub costruisce da solo le versioni per Windows, Mac e Linux; si scaricano dalla stessa pagina. Con un tag tipo `v3.3.0` vengono pubblicate in *Releases*, con un link da dare a chiunque.
4. Il programma **non è firmato** (la firma costa: Apple circa 99 $ l'anno, Windows qualche centinaio di euro). Per questo alla prima apertura: su Mac clic destro → *Apri* → *Apri*; su Windows «Maggiori informazioni» → «Esegui comunque».
   Alcuni antivirus possono segnalare l'app perché ascolta i tasti: è il comportamento necessario ai tasti globali (vedi «Privacy»).

## Ospitare la radio dal proprio computer
1. Aprendo l'app compare la schermata di collegamento. In «Ospita la radio su questo computer» si preme **Avvia**: la radio parte dentro l'app, senza installare altro.
2. Compaiono le password create a caso per l'amministratore (utente `admin`) e per lo staff: vanno copiate e conservate.
3. **Crea il link pubblico** genera un indirizzo `https://….trycloudflare.com` (la prima volta scarica un piccolo programma di Cloudflare). Quel link si manda a tutti.
4. Chi ha l'app lo incolla in «Collegati a una radio»; chi non ce l'ha lo apre dal browser. Il link cambia a ogni creazione e funziona finché l'app e il computer restano accesi.
5. Per una radio sempre accesa con link fisso resta valida la guida del sito (server a pagamento o tunnel con nome): gli utenti incollano nell'app quell'indirizzo.

## Tasti personalizzati
1. Dentro la radio: **⚙ Audio → Tasti e app**. Si preme il pulsante accanto a un'azione, poi la combinazione voluta (anche un tasto laterale del mouse). **Esc** annulla.
2. Azioni disponibili: parlare (da tenere premuto), microfono on/off, audio on/off, modulo panico, mostra/nascondi la finestra, mini-finestra on/off e una chiamata per ogni gruppo («Comunica a…»).
3. Tasti di base: parla `F8`, microfono `Ctrl+Maiusc+M`, audio `Ctrl+Maiusc+A`, panico `Ctrl+Maiusc+P`, finestra `Ctrl+Maiusc+R`, mini-finestra `Ctrl+Maiusc+O`. Si ripristinano con un pulsante.
4. Il gioco riceve comunque il tasto premuto: conviene sceglierne uno che il gioco non usa.
5. Se i tasti globali non sono disponibili (permesso mancante o sistema particolare) l'app lo scrive nelle impostazioni e usa tasti normali: solo lettere, cifre, tasti F e Spazio, e «parla» diventa un interruttore.

## Notifiche, mini-finestra, icona
1. **Notifiche del computer** per messaggi radio, chiamate al proprio gruppo e **panico** (questo con lampeggio in barra delle applicazioni o salto nel Dock). Compaiono solo se la finestra non è in primo piano.
2. **Mini-finestra** (`Ctrl+Maiusc+O`): piccola, trasparente, sempre sopra le altre finestre; mostra radio, chi parla, microfono spento e panico. Si sposta trascinando l'intestazione; a richiesta lascia passare i clic. Funziona con Roblox a schermo intero in modalità finestra o senza bordi; con lo schermo intero esclusivo i sistemi operativi non la mostrano.
3. **Icona vicino all'orologio**: chiudendo la finestra la radio resta attiva (si può disattivare); tasto destro per aprire, cambiare radio o uscire. Il computer non va in stop finché si è collegati.
4. **Avvia con il computer** si attiva in ⚙ Audio → Tasti e app.

## Accessibilità
1. Tutto si usa con la tastiera (Tab, Invio, Spazio, Esc); le radio e i pulsanti hanno nomi leggibili dai lettori di schermo, e panico, errori e cambi di stato vengono annunciati. In ⚙ Audio si può attivare l'annuncio di chi sta parlando.
2. **Alto contrasto** e testi e pulsanti **grandi / molto grandi** (⚙ Audio → Accessibilità); lo zoom del programma si regola anche dal menu *Vista*.
3. I movimenti vengono ridotti se il sistema ha «riduci animazioni». I tasti si possono scegliere a piacere, anche per chi non può usare certe combinazioni.
4. L'app è in italiano e gratuita; si dà agli altri con un semplice link (vedi «Creare il programma»).

## Privacy dei tasti
L'app ascolta la tastiera e il mouse del sistema solo per riconoscere i tasti che hai scelto: gli altri tasti vengono ignorati subito, non vengono salvati né inviati da nessuna parte. Le impostazioni dell'app (tasti, ultimo server) stanno in un file sul tuo computer. Il codice è tutto in `main.js` (circa 400 righe, commentate in italiano).

## Cosa è stato provato
Provato in Linux (schermo virtuale): avvio, radio ospitata dentro l'app, tasti premuti davvero a livello di sistema (parla, microfono, gruppi, assegnazione di nuovi tasti), mini-finestra, panico, accessibilità. Non provato su Mac e Windows veri: tasti globali, permessi, firma, notifiche e link pubblico vanno verificati al primo uso.

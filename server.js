const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

// --- CARICAMENTO DATABASE ---
let dbClassico = [];
let dbClash = [];

try {
    const dataClassico = fs.readFileSync('words.json');
    dbClassico = JSON.parse(dataClassico);
    const dataClash = fs.readFileSync('words_clash.json');
    dbClash = JSON.parse(dataClash);
    console.log(`[SERVER] Caricate ${dbClassico.length} parole Classiche e ${dbClash.length} Clash.`);
} catch (e) {
    console.error("[ERRORE DB] Uso fallback.");
    dbClassico = [{ parola: "Pizza", infiltrato: ["Pasta"] }];
    dbClash = [{ parola: "Gigante", infiltrato: ["Golem"] }];
}

let stanze = {}; 
let giocatoriConnessi = {}; 

function generaNomeCasuale() {
    const nomi = ["Squalo", "Tigre", "Drago", "Ninja", "Fantasma", "Alieno", "Pirata", "Orso", "Falco"];
    const aggettivi = ["Rosso", "Blu", "Verde", "Veloce", "Magico", "Freddo", "Grande", "Piccolo"];
    return `${aggettivi[Math.floor(Math.random() * aggettivi.length)]} ${nomi[Math.floor(Math.random() * nomi.length)]}`;
}

function generaCodice() {
    const caratteri = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let codice = '';
    do {
        codice = '';
        for (let i = 0; i < 4; i++) {
            codice += caratteri.charAt(Math.floor(Math.random() * caratteri.length));
        }
    } while (stanze[codice]); 
    return codice;
}

function gestisciUscitaGiocatore(socketId) {
    const codiceLobby = giocatoriConnessi[socketId];
    if (!codiceLobby) return;

    let stanza = stanze[codiceLobby];
    if (stanza) {
        const playerIndex = stanza.giocatori.findIndex(p => p.id === socketId);
        const isHostLeaving = (stanza.hostId === socketId);

        if (playerIndex !== -1) {
            stanza.giocatori.splice(playerIndex, 1);
            delete giocatoriConnessi[socketId];

            if (stanza.giocatori.length === 0) {
                delete stanze[codiceLobby];
            } else {
                if (isHostLeaving) {
                    stanza.hostId = stanza.giocatori[0].id; 
                    io.to(stanza.hostId).emit('promozione_host', { isHost: true });
                }
                io.to(codiceLobby).emit('giocatore_entrato', { 
                    listaNomi: stanza.giocatori.map(p => p.nome),
                    hostId: stanza.hostId 
                });
            }
        }
    }
}

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
    socket.data.nome = generaNomeCasuale();
    
    socket.on('imposta_nome', (nuovoNome) => {
        if(nuovoNome && typeof nuovoNome === 'string' && nuovoNome.trim().length > 0) { 
            socket.data.nome = nuovoNome.trim().substring(0, 12); 
        }
    });

    socket.on('create_lobby', (tipoPartita) => {
        // Se il giocatore è già in una stanza, lo rimuoviamo prima
        if(giocatoriConnessi[socket.id]) gestisciUscitaGiocatore(socket.id);

        const nuovoCodice = generaCodice();
        const nomeHost = socket.data.nome;
        const modalita = tipoPartita || 'classica';
        
        stanze[nuovoCodice] = {
            hostId: socket.id,
            codice: nuovoCodice,
            giocatori: [{ id: socket.id, nome: nomeHost }],
            status: 'waiting',
            infiltratoAbilitato: false,
            modalita: modalita
        };
        
        socket.join(nuovoCodice);
        giocatoriConnessi[socket.id] = nuovoCodice;

        socket.emit('lobby_creata', {
            success: true,
            codice: nuovoCodice,
            listaNomi: [nomeHost],
            isHost: true,
            infiltratoAbilitato: false,
            modalita: modalita
        });
    });
    
    socket.on('toggle_infiltrato', (codiceLobby) => {
        const stanza = stanze[codiceLobby];
        if(stanza && stanza.hostId === socket.id) {
            stanza.infiltratoAbilitato = !stanza.infiltratoAbilitato;
            io.to(codiceLobby).emit('aggiorna_impostazioni', { infiltratoAbilitato: stanza.infiltratoAbilitato });
        }
    });

    socket.on('join_lobby', (dati) => {
        const codice = dati.codice;
        const modalitaUtente = dati.modalitaRichiesta; 
        const nomeOspite = socket.data.nome; 
        
        if (!stanze[codice]) {
            socket.emit('lobby_unita', { success: false, messaggio: 'Codice non trovato!' });
            return;
        }

        // --- FIX DUPLICATI ---
        // Controlliamo se questo socket ID è già nella lista dei giocatori
        const giocatoreGiaPresente = stanze[codice].giocatori.find(p => p.id === socket.id);
        if (giocatoreGiaPresente) {
            // Se è già dentro, rimandiamo solo l'evento di successo senza aggiungerlo di nuovo
            socket.emit('lobby_unita', { 
                success: true, 
                codice: codice, 
                listaNomi: stanze[codice].giocatori.map(p => p.nome),
                isHost: false,
                infiltratoAbilitato: stanze[codice].infiltratoAbilitato,
                modalita: stanze[codice].modalita
            });
            return;
        }
        
        if (stanze[codice].modalita !== modalitaUtente) {
            socket.emit('lobby_unita', { success: false, messaggio: `Errore modalità.` });
            return;
        }

        if (stanze[codice].status === 'playing') {
            socket.emit('lobby_unita', { success: false, messaggio: 'Partita già in corso!' });
            return;
        }

        // Se era in un'altra lobby, toglilo da lì
        if(giocatoriConnessi[socket.id]) gestisciUscitaGiocatore(socket.id);

        const nuovoGiocatore = { id: socket.id, nome: nomeOspite };
        stanze[codice].giocatori.push(nuovoGiocatore);
        
        socket.join(codice);
        giocatoriConnessi[socket.id] = codice;

        const listaGiocatori = stanze[codice].giocatori.map(p => p.nome);
        
        socket.emit('lobby_unita', { 
            success: true, 
            codice: codice, 
            listaNomi: listaGiocatori,
            isHost: false,
            infiltratoAbilitato: stanze[codice].infiltratoAbilitato,
            modalita: stanze[codice].modalita
        });

        socket.to(codice).emit('giocatore_entrato', { listaNomi: listaGiocatori });
    });

    socket.on('start_game', (codiceLobby) => {
        const stanza = stanze[codiceLobby];
        if (!stanza || stanza.hostId !== socket.id) return;

        const minGiocatori = stanza.infiltratoAbilitato ? 3 : 2; 
        if (stanza.giocatori.length < minGiocatori) return;
        
        stanza.status = 'playing';

        // --- FASE 1: AVVIA IL COUNTDOWN ---
        io.to(codiceLobby).emit('avvia_countdown');

        // --- FASE 2: CALCOLA E INVIA RUOLI DOPO 3.5 SECONDI ---
        setTimeout(() => {
            let databaseScelto = dbClassico;
            if (stanza.modalita === 'clash') databaseScelto = dbClash;
            if(databaseScelto.length === 0) databaseScelto = [{parola: "ERRORE", infiltrato: ["VUOTO"]}];

            const carta = databaseScelto[Math.floor(Math.random() * databaseScelto.length)];
            const parolaCivile = carta.parola;
            const parolaInfiltrato = carta.infiltrato[Math.floor(Math.random() * carta.infiltrato.length)];

            let indici = [...Array(stanza.giocatori.length).keys()]; 
            const randImp = Math.floor(Math.random() * indici.length);
            const indiceImpostore = indici.splice(randImp, 1)[0];
            
            let indiceInfiltrato = -1;
            if (stanza.infiltratoAbilitato && indici.length > 0) {
                const randInf = Math.floor(Math.random() * indici.length);
                indiceInfiltrato = indici.splice(randInf, 1)[0];
            }

            let biglietti = [];
            stanza.giocatori.forEach((g, i) => {
                if (i === indiceImpostore) biglietti.push(i);
                else if (i === indiceInfiltrato) for(let k=0; k<3; k++) biglietti.push(i);
                else for(let k=0; k<5; k++) biglietti.push(i);
            });
            const indiceChiInizia = biglietti[Math.floor(Math.random() * biglietti.length)];

            stanza.giocatori.forEach((giocatore, index) => {
                const toccaATe = (index === indiceChiInizia);
                let datiPartita = { iniziaTu: toccaATe };

                if (index === indiceImpostore) {
                    datiPartita.ruolo = "IMPOSTORE";
                    datiPartita.testoPrincipale = "SEI L'IMPOSTORE";
                    datiPartita.testoSecondario = "Non farti scoprire!";
                    datiPartita.colore = "#d32f2f"; 
                    datiPartita.tipoLogo = "impostore"; 
                } else if (index === indiceInfiltrato) {
                    datiPartita.ruolo = "INFILTRATO";
                    datiPartita.testoPrincipale = parolaInfiltrato;
                    datiPartita.testoSecondario = "Parola dell'Infiltrato";
                    datiPartita.colore = "#fbc02d"; 
                    datiPartita.tipoLogo = "infiltrato"; 
                } else {
                    datiPartita.ruolo = "CIVILE";
                    datiPartita.testoPrincipale = parolaCivile;
                    datiPartita.testoSecondario = "Parola Segreta";
                    datiPartita.colore = "#2e7d32"; 
                    datiPartita.tipoLogo = "detective"; 
                }
                io.to(giocatore.id).emit('partita_iniziata', datiPartita);
            });
        }, 3500); // 3500ms = 3.5 secondi di attesa prima di mostrare i ruoli
    });

    socket.on('reset_lobby', (codiceLobby) => {
        const stanza = stanze[codiceLobby];
        if (stanza && stanza.hostId === socket.id) {
            stanza.status = 'waiting';
            io.to(codiceLobby).emit('torna_alla_lobby', {
                codice: codiceLobby,
                listaNomi: stanza.giocatori.map(p => p.nome),
                infiltratoAbilitato: stanza.infiltratoAbilitato,
                modalita: stanza.modalita
            });
        }
    });

    socket.on('leave_lobby', () => {
        if(giocatoriConnessi[socket.id]) gestisciUscitaGiocatore(socket.id);
    });

    socket.on('disconnect', () => {
        gestisciUscitaGiocatore(socket.id);
    });
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
    console.log(`SERVER ATTIVO! Porta ${PORT}`);
});
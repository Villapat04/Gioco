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

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
  socket.data.nome = generaNomeCasuale();
  
  socket.on('imposta_nome', (nuovoNome) => {
      if(nuovoNome && nuovoNome.trim().length > 0) { socket.data.nome = nuovoNome.trim(); }
  });

  socket.on('create_lobby', (tipoPartita) => {
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

  // --- LOGICA UNIONE AGGIORNATA (CONTROLLO MODALITÀ) ---
  socket.on('join_lobby', (dati) => {
      const codice = dati.codice;
      const modalitaUtente = dati.modalitaRichiesta; // La modalità scelta dall'utente (classica/clash)
      const nomeOspite = socket.data.nome; 
      
      // 1. Esiste la stanza?
      if (!stanze[codice]) {
          socket.emit('lobby_unita', { success: false, messaggio: 'Codice non trovato!' });
          return;
      }
      
      // 2. La modalità corrisponde? (NUOVO CONTROLLO)
      if (stanze[codice].modalita !== modalitaUtente) {
          const tipoCorretto = stanze[codice].modalita.toUpperCase();
          socket.emit('lobby_unita', { 
              success: false, 
              messaggio: `Errore! Questa è una lobby ${tipoCorretto}. Torna indietro e scegli la modalità giusta.` 
          });
          return;
      }

      // 3. La partita è già iniziata?
      if (stanze[codice].status === 'playing') {
          socket.emit('lobby_unita', { success: false, messaggio: 'Partita già in corso!' });
          return;
      }

      const nuovoGiocatore = { id: socket.id, nome: nomeOspite };
      stanze[codice].giocatori.push(nuovoGiocatore);
      
      socket.join(codice);

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

      let databaseScelto = dbClassico;
      if (stanza.modalita === 'clash') databaseScelto = dbClash;

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

  socket.on('disconnect', () => {
      for (const codice in stanze) {
          let stanza = stanze[codice];
          const playerIndex = stanza.giocatori.findIndex(p => p.id === socket.id);
          if (playerIndex !== -1) {
              stanza.giocatori.splice(playerIndex, 1);
              if (stanza.giocatori.length === 0) delete stanze[codice];
              else io.to(codice).emit('giocatore_entrato', { listaNomi: stanza.giocatori.map(p => p.nome) });
              break;
          }
      }
  });
});

// Usa la porta che ci dà il server online, oppure la 3000 se siamo sul pc
const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
  console.log(`SERVER ATTIVO! Porta ${PORT}`);
});
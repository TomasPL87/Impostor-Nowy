// server.js
// Wersja: prosty i odporny serwer dla gry z pokojami i logiką "tylko host może startować"

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// Konfiguracja
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // w produkcji ustaw domainę frontendu
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serwowanie frontendu
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Struktura pokoju:
// rooms[code] = {
//   code: "ABCD",
//   hostId: "socketId",
//   players: [{id, name, ready, isHost}], 
//   state: "waiting" | "playing",
//   round: number,
//   meta: {} // dowolne dodatkowe informacje
// }
const rooms = Object.create(null);

// Pomocnicze funkcje
function generateRoomCode(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bez podobnych znaków
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createUniqueCode() {
  let tries = 0;
  while (tries < 1000) {
    const code = generateRoomCode();
    if (!rooms[code]) return code;
    tries++;
  }
  throw new Error("Nie udało się wygenerować unikalnego kodu pokoju");
}

function getRoomForSocket(socketId) {
  for (const code in rooms) {
    const r = rooms[code];
    if (r.players.find(p => p.id === socketId)) return r;
  }
  return null;
}

function emitRoomUpdate(room) {
  io.to(room.code).emit("roomUpdate", {
    code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })),
    hostId: room.hostId,
    state: room.state,
    round: room.round,
    meta: room.meta || {}
  });
}

// Socket.IO
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Utwórz pokój (host)
  socket.on("createRoom", (payload = {}, ack) => {
    try {
      const name = (payload.name || "Gosc").toString().slice(0, 30);
      const code = createUniqueCode();
      const room = {
        code,
        hostId: socket.id,
        players: [{ id: socket.id, name, ready: false }],
        state: "waiting",
        round: 0,
        meta: {}
      };
      rooms[code] = room;

      socket.join(code);
      emitRoomUpdate(room);

      if (typeof ack === "function") ack({ ok: true, code, room: { code: room.code } });
      socket.emit("roomCreated", { code });
      console.log(`Room created: ${code} by ${socket.id}`);
    } catch (err) {
      console.error("createRoom error:", err);
      if (typeof ack === "function") ack({ ok: false, error: err.message });
      socket.emit("error", { message: "Nie można utworzyć pokoju" });
    }
  });

  // Dołącz do pokoju
  socket.on("joinRoom", (data = {}, ack) => {
    const code = (data.code || "").toString().trim().toUpperCase();
    const name = (data.name || "Gosc").toString().slice(0, 30);

    if (!code || !rooms[code]) {
      if (typeof ack === "function") ack({ ok: false, error: "Pokój nie istnieje" });
      return socket.emit("joinFailed", { message: "Pokój nie istnieje" });
    }

    const room = rooms[code];

    // nie pozwalaj dołączać jeśli gra już w toku — opcjonalne, ale typowe
    // można zakomentować kolejną linię, jeśli chcesz dołączać w trakcie gry
    // if (room.state === "playing") { ... }

    // sprawdź, czy użytkownik jest już w pokoju
    if (room.players.find(p => p.id === socket.id)) {
      if (typeof ack === "function") ack({ ok: true, room: { code } });
      return socket.join(code);
    }

    const player = { id: socket.id, name, ready: false };
    room.players.push(player);
    socket.join(code);

    emitRoomUpdate(room);
    socket.emit("roomJoined", { code });
    io.to(code).emit("chat", { system: true, message: `${name} dołączył do pokoju.` });

    if (typeof ack === "function") ack({ ok: true, room: { code } });
    console.log(`Socket ${socket.id} joined room ${code} as "${name}"`);
  });

  // Opuść pokój ręcznie
  socket.on("leaveRoom", (data = {}, ack) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Nie jesteś w żadnym pokoju" });
      return;
    }
    socket.leave(room.code);
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(room.code).emit("chat", { system: true, message: `Ktoś opuścił pokój.` });

    // jeśli opuścił host -> przekaż hosta
    if (room.hostId === socket.id) {
      if (room.players.length > 0) {
        room.hostId = room.players[0].id;
        io.to(room.code).emit("chat", { system: true, message: `Nowy host: ${room.players[0].name}` });
      } else {
        // brak graczy -> usuń pokój
        delete rooms[room.code];
        if (typeof ack === "function") ack({ ok: true });
        return;
      }
    }

    emitRoomUpdate(room);
    if (typeof ack === "function") ack({ ok: true });
  });

  // START GAME - tylko host może
  socket.on("startGame", (data = {}, ack) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Nie jesteś w pokoju" });
      return socket.emit("startFailed", { message: "Nie jesteś w pokoju" });
    }

    if (socket.id !== room.hostId) {
      if (typeof ack === "function") ack({ ok: false, error: "Tylko host może uruchomić grę" });
      return socket.emit("startFailed", { message: "Tylko host może uruchomić grę" });
    }

    if (room.state === "playing") {
      if (typeof ack === "function") ack({ ok: false, error: "Gra już trwa" });
      return;
    }

    // Przygotuj logikę startu gry tutaj (losowanie ról, rozdanie danych itp.)
    room.state = "playing";
    room.round = 1;
    room.meta = room.meta || {};
    room.meta.startedAt = Date.now();

    io.to(room.code).emit("gameStarted", { round: room.round, meta: room.meta });
    emitRoomUpdate(room);

    if (typeof ack === "function") ack({ ok: true });
    console.log(`Game started in room ${room.code} by host ${socket.id}`);
  });

  // NEXT ROUND - tylko host może
  socket.on("nextRound", (data = {}, ack) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Nie jesteś w pokoju" });
      return;
    }
    if (socket.id !== room.hostId) {
      if (typeof ack === "function") ack({ ok: false, error: "Tylko host może rozpocząć następną rundę" });
      return socket.emit("nextRoundFailed", { message: "Tylko host może rozpocząć następną rundę" });
    }
    if (room.state !== "playing") {
      if (typeof ack === "function") ack({ ok: false, error: "Gra nie jest w toku" });
      return;
    }

    room.round = (room.round || 0) + 1;
    room.meta = room.meta || {};
    room.meta.lastRoundAt = Date.now();

    io.to(room.code).emit("roundStarted", { round: room.round, meta: room.meta });
    emitRoomUpdate(room);
    if (typeof ack === "function") ack({ ok: true });
    console.log(`Room ${room.code} next round ${room.round} by host ${socket.id}`);
  });

  // Przykład: toggle ready
  socket.on("setReady", (ready = true, ack) => {
    const room = getRoomForSocket(socket.id);
    if (!room) {
      if (typeof ack === "function") ack({ ok: false, error: "Nie w pokoju" });
      return;
    }
    const p = room.players.find(x => x.id === socket.id);
    if (p) {
      p.ready = !!ready;
      emitRoomUpdate(room);
      if (typeof ack === "function") ack({ ok: true });
    } else {
      if (typeof ack === "function") ack({ ok: false, error: "Gracz nie znaleziony" });
    }
  });

  // Dowolny chat / wiadomość
  socket.on("chat", (data = {}) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    io.to(room.code).emit("chat", { id: socket.id, name: data.name || "Anon", message: data.message || "" });
  });

  // Rozłączenie
  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    const playerName = player ? player.name : "Gracz";

    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(room.code).emit("chat", { system: true, message: `${playerName} rozłączył się.` });

    // Jeśli host odszedł - przekaż hosta
    if (room.hostId === socket.id) {
      if (room.players.length > 0) {
        room.hostId = room.players[0].id;
        io.to(room.code).emit("chat", { system: true, message: `Nowy host: ${room.players[0].name}` });
      } else {
        // brak graczy -> usuń pokój
        delete rooms[room.code];
        console.log(`Room ${room.code} usunięty (brak graczy)`);
        return;
      }
    }

    // Jeśli została gra w toku i host odszedł, możesz chcieć zatrzymać grę:
    // room.state = "waiting"; // (odkomentuj, jeśli chcesz)
    emitRoomUpdate(room);
  });

  // Opcjonalnie: zapytanie o listę pokoi (bez szczegółów prywatnych)
  socket.on("listRooms", (ack) => {
    const brief = Object.values(rooms).map(r => ({
      code: r.code,
      playersCount: r.players.length,
      state: r.state
    }));
    if (typeof ack === "function") ack({ ok: true, rooms: brief });
  });
});

// Start serwera
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

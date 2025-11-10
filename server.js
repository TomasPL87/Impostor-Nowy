// server.js
const express = require("express");
const http = require("http").createServer();
const { Server } = require("socket.io");
const io = new Server(http);
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let words = JSON.parse(fs.readFileSync("words.json", "utf-8"));
let rooms = {};

io.on("connection", (socket) => {
  console.log("Nowe połączenie:", socket.id);

  socket.on("createRoom", ({ name, category }) => {
    const code = Math.random().toString(36).substr(2, 5).toUpperCase();
    rooms[code] = {
      hostId: socket.id,
      players: [],
      category,
      usedWords: [],
    };
    joinRoom(socket, name, code, true);
  });

  socket.on("joinRoom", ({ name, code }) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit("errorMsg", "Nie znaleziono pokoju.");
    joinRoom(socket, name, code, false);
  });

  function joinRoom(socket, name, code, isHost) {
    const player = { id: socket.id, name, isHost };
    socket.join(code);
    socket.roomCode = code;
    rooms[code].players.push(player);
    updateRoom(code);
  }

  socket.on("disconnect", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
    if (rooms[code].players.length === 0) delete rooms[code];
    else updateRoom(code);
  });

  socket.on("startRound", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // ✅ tylko host może rozpocząć grę
    if (socket.id !== room.hostId) return;

    const category = room.category || "Ogólna";
    const availableWords = words[category];
    if (!availableWords) return;

    let word;
    const unused = availableWords.filter(w => !room.usedWords.includes(w));
    if (unused.length === 0) room.usedWords = [];
    word = unused[Math.floor(Math.random() * unused.length)];
    room.usedWords.push(word);
    if (room.usedWords.length > 100) room.usedWords.shift();

    const impostorIndex = Math.floor(Math.random() * room.players.length);
    room.players.forEach((p, i) => {
      io.to(p.id).emit("roundData", {
        role: i === impostorIndex ? "impostor" : "player",
        word: i === impostorIndex ? null : word,
      });
    });
  });
});

function updateRoom(code) {
  const room = rooms[code];
  io.to(code).emit("roomData", {
    code,
    players: room.players,
    category: room.category,
    isHost: (id) => room.hostId === id,
  });
}

http.listen(PORT, () => console.log("Serwer działa na porcie " + PORT));

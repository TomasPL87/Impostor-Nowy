
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
app.use(express.static("public"));

const words = JSON.parse(fs.readFileSync("words.json", "utf8")); // object with categories
const rooms = {}; // { code: { players: [{id,socketId,name,sessionId}], host: sessionId, usedWords: {category: [recent indices]}, category: "Ogólna" } }

function makeRoomCode() {
  return Math.random().toString(36).substring(2,6).toUpperCase();
}

// helper: pick a word index from category avoiding recently used (minHistory)
function pickWordIndex(category, room) {
  const arr = words[category];
  if (!arr || arr.length === 0) return -1;
  const minHistory = Math.min(100, Math.floor(arr.length/2)); // ensure at least 100 or half size
  room.usedWords = room.usedWords || {};
  room.usedWords[category] = room.usedWords[category] || [];
  const used = room.usedWords[category];
  // build set for quick lookup
  const usedSet = new Set(used);
  // collect candidate indices
  const candidates = [];
  for (let i=0;i<arr.length;i++) if (!usedSet.has(i)) candidates.push(i);
  if (candidates.length === 0) {
    // reset history but keep last minHistory entries
    room.usedWords[category] = used.slice(-minHistory);
    return pickWordIndex(category, room);
  }
  const idx = candidates[Math.floor(Math.random()*candidates.length)];
  // push to used
  used.push(idx);
  // keep history length bounded
  if (used.length > Math.max(minHistory, 200)) used.splice(0, used.length - Math.max(minHistory,200));
  return idx;
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on("createRoom", ({name, category}, cb) => {
    const code = makeRoomCode();
    const sessionId = uuidv4();
    rooms[code] = { players: [], host: sessionId, category: category || "Ogólna", usedWords: {} };
    const player = { id: sessionId, socketId: socket.id, name: name || "Anon", sessionId };
    rooms[code].players.push(player);
    socket.join(code);
    socket.emit("roomCreated", { code, sessionId });
    io.to(code).emit("updatePlayers", rooms[code].players.map(p=>p.name));
    cb && cb({ok:true, code, sessionId});
  });

  socket.on("joinRoom", ({name, code, sessionId}, cb) => {
    if (!rooms[code]) return cb && cb({ok:false, error:"Room not found"});
    // if sessionId provided and matches existing player, just reconnect
    const existing = rooms[code].players.find(p=>p.sessionId === sessionId);
    if (existing) {
      existing.socketId = socket.id;
      existing.name = name || existing.name;
      socket.join(code);
      socket.emit("reconnected", { code, sessionId });
      io.to(code).emit("updatePlayers", rooms[code].players.map(p=>p.name));
      return cb && cb({ok:true, reconnected:true, code, sessionId});
    }
    // otherwise create new player with sessionId
    const sid = sessionId || uuidv4();
    const player = { id: sid, socketId: socket.id, name: name || "Anon", sessionId: sid };
    rooms[code].players.push(player);
    socket.join(code);
    io.to(code).emit("updatePlayers", rooms[code].players.map(p=>p.name));
    cb && cb({ok:true, code, sessionId: sid});
  });

  socket.on("startRound", ({code}, cb) => {
    const room = rooms[code];
    if (!room) return cb && cb({ok:false, error:"room not found"});
    // pick word index from current category
    const idx = pickWordIndex(room.category, room);
    const word = words[room.category][idx];
    // pick impostor by random index
    const players = room.players;
    if (!players || players.length === 0) return cb && cb({ok:false, error:"no players"});
    const impIdx = Math.floor(Math.random()*players.length);
    const impostor = players[impIdx];
    // send to each player their role and for non-impostors the word; impostor gets role 'impostor' and word null
    players.forEach(p=>{
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        if (p.sessionId === impostor.sessionId) {
          sock.emit("roundData", { role: "impostor", word: null });
        } else {
          sock.emit("roundData", { role: "player", word });
        }
      }
    });
    cb && cb({ok:true});
  });

  socket.on("setCategory", ({code, category}, cb) => {
    const room = rooms[code];
    if (!room) return cb && cb({ok:false, error:"room not found"});
    if (!words[category]) return cb && cb({ok:false, error:"category not found"});
    room.category = category;
    // reset usedWords for category to allow fresh start
    room.usedWords[category] = room.usedWords[category] || [];
    io.to(code).emit("categoryChanged", category);
    cb && cb({ok:true});
  });

  socket.on("disconnect", () => {
    // try to find player and mark as disconnected (do not remove immediately so reconnection possible)
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex(p=>p.socketId === socket.id);
      if (idx>=0) {
        // keep player but clear socketId to allow reconnection
        room.players[idx].socketId = null;
        // notify others
        io.to(code).emit("updatePlayers", room.players.map(p=>p.name + (p.socketId ? "" : " (offline)")));
        // cleanup empty rooms after short delay
        setTimeout(()=>{
          const r = rooms[code];
          if (r && r.players.every(p=>!p.socketId)) {
            delete rooms[code];
            console.log("deleted empty room", code);
          }
        }, 5*60*1000); // 5 minutes
        break;
      }
    }
  });

  socket.on("leaveRoom", ({code, sessionId}, cb) => {
    const room = rooms[code];
    if (!room) return cb && cb({ok:false});
    const idx = room.players.findIndex(p=>p.sessionId === sessionId);
    if (idx>=0) {
      room.players.splice(idx,1);
      io.to(code).emit("updatePlayers", room.players.map(p=>p.name));
    }
    cb && cb({ok:true});
  });

  socket.on("listCategories", (cb) => {
    cb && cb(Object.keys(words));
  });

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server listening on port " + PORT));

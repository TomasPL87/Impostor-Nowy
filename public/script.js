const socket = io();
let isHost = false;

const nameInput = document.getElementById("nameInput");
const joinCode = document.getElementById("joinCode");
const categorySelect = document.getElementById("categorySelect");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const playersList = document.getElementById("players");
const roomCodeDisplay = document.getElementById("roomCode");
const roleTitle = document.getElementById("roleTitle");
const wordArea = document.getElementById("wordArea");

createBtn.onclick = () => {
  socket.emit("createRoom", {
    name: nameInput.value,
    category: categorySelect.value
  });
};

joinBtn.onclick = () => {
  socket.emit("joinRoom", {
    name: nameInput.value,
    code: joinCode.value
  });
};

startBtn.onclick = () => {
  if (isHost) socket.emit("startRound");
};

socket.on("roomData", (data) => {
  playersList.innerHTML = "";
  data.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.isHost ? " 👑" : "");
    playersList.appendChild(li);
    if (p.id === socket.id) isHost = p.isHost;
  });

  roomCodeDisplay.textContent = data.code;
  startBtn.style.display = isHost ? "inline-block" : "none";
});

socket.on("roundData", (data) => {
  if (data.role === "impostor") {
    roleTitle.textContent = "Jesteś IMPOSTOREM";
    wordArea.textContent = "(nie widzisz hasła)";
  } else {
    roleTitle.textContent = "Jesteś GRACZEM";
    wordArea.textContent = data.word;
  }
});

socket.on("errorMsg", msg => alert(msg));

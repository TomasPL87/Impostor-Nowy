
const socket = io();
let currentRoom = null;
let sessionId = localStorage.getItem("im_sessionId") || null;
let myName = localStorage.getItem("im_name") || "";
const nameInput = document.getElementById("nameInput");
nameInput.value = myName;

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const leaveBtn = document.getElementById("leaveBtn");
const readyBtn = document.getElementById("readyBtn");
const joinCode = document.getElementById("joinCode");
const roomCodeSpan = document.getElementById("roomCode");
const playersUl = document.getElementById("players");
const menuDiv = document.getElementById("menu");
const lobbyDiv = document.getElementById("lobby");
const gameDiv = document.getElementById("game");
const roleTitle = document.getElementById("roleTitle");
const wordArea = document.getElementById("wordArea");
const categoriesDiv = document.getElementById("categoriesDiv");
const currentCategorySpan = document.getElementById("currentCategory");
const errorDiv = document.getElementById("error");

function setError(msg){ errorDiv.textContent = msg || ""; }

socket.emit("listCategories", (cats) => {
  categoriesDiv.innerHTML = "<label>Category: <select id='categorySelect'></select></label>";
  const sel = document.getElementById("categorySelect");
  cats.forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
});

createBtn.onclick = () => {
  const name = nameInput.value || "Anon";
  const sel = document.getElementById("categorySelect");
  const category = sel ? sel.value : "Ogólna";
  socket.emit("createRoom", {name, category}, (res)=>{
    if (res && res.ok) {
      currentRoom = res.code;
      sessionId = res.sessionId;
      localStorage.setItem("im_sessionId", sessionId);
      localStorage.setItem("im_name", name);
      roomCodeSpan.textContent = currentRoom;
      menuDiv.style.display = "none";
      lobbyDiv.style.display = "block";
      currentCategorySpan.textContent = category;
    } else setError(res && res.error);
  });
};

joinBtn.onclick = () => {
  const name = nameInput.value || "Anon";
  const code = joinCode.value.trim().toUpperCase();
  if (!code) return setError("Enter room code");
  socket.emit("joinRoom", {name, code, sessionId}, (res)=>{
    if (res && res.ok) {
      currentRoom = res.code;
      sessionId = res.sessionId;
      localStorage.setItem("im_sessionId", sessionId);
      localStorage.setItem("im_name", name);
      roomCodeSpan.textContent = currentRoom;
      menuDiv.style.display = "none";
      lobbyDiv.style.display = "block";
    } else setError(res && res.error);
  });
};

leaveBtn.onclick = () => {
  socket.emit("leaveRoom", {code: currentRoom, sessionId}, ()=>{
    currentRoom = null;
    roomCodeSpan.textContent = "";
    lobbyDiv.style.display = "none";
    menuDiv.style.display = "block";
  });
};

startBtn.onclick = () => {
  if (!currentRoom) return;
  socket.emit("startRound", {code: currentRoom}, (res)=>{
    if (!res || !res.ok) setError(res && res.error);
  });
};

readyBtn.onclick = () => {
  // reveal ready state -> allow host to start next round
  // For simplicity, show menu
  gameDiv.style.display = "none";
  lobbyDiv.style.display = "block";
};

socket.on("roomCreated", ({code, sessionId: sid})=>{
  currentRoom = code;
  sessionId = sid;
  localStorage.setItem("im_sessionId", sid);
  roomCodeSpan.textContent = code;
});

socket.on("updatePlayers", (players)=>{
  playersUl.innerHTML = "";
  players.forEach(p=>{
    const li = document.createElement("li"); li.textContent = p; playersUl.appendChild(li);
  });
});

socket.on("reconnected", ({code, sessionId: sid})=>{
  currentRoom = code; sessionId = sid; localStorage.setItem("im_sessionId", sid);
  roomCodeSpan.textContent = code;
  menuDiv.style.display = "none"; lobbyDiv.style.display = "block";
});

socket.on("roundData", ({role, word})=>{
  lobbyDiv.style.display = "none";
  gameDiv.style.display = "block";
  if (role === "impostor") {
    roleTitle.textContent = "You are the IMPOSTOR";
    wordArea.textContent = "(you are impostor — you don't see the word)";
  } else {
    roleTitle.textContent = "You are a PLAYER";
    wordArea.textContent = word;
  }
});

socket.on("categoryChanged", (cat)=>{
  currentCategorySpan.textContent = cat;
});

window.addEventListener("beforeunload", ()=>{
  // attempt graceful leave? keep session in localStorage for reconnect
});

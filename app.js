(() => {
  const AGENT_URL = "ws://127.0.0.1:8765";
  const PEER_PREFIX = "twinview-";

  const el = {
    landing: document.getElementById("landing"),
    hostSetup: document.getElementById("host-setup"),
    joinSetup: document.getElementById("join-setup"),
    session: document.getElementById("session"),
    hostName: document.getElementById("host-name"),
    joinName: document.getElementById("join-name"),
    roomCode: document.getElementById("room-code"),
    rolePill: document.getElementById("role-pill"),
    roomDisplay: document.getElementById("room-display"),
    connStatus: document.getElementById("conn-status"),
    agentStatus: document.getElementById("agent-status"),
    remoteVideo: document.getElementById("remote-video"),
    localVideo: document.getElementById("local-video"),
    hostPreview: document.getElementById("host-preview-wrap"),
    waiting: document.getElementById("waiting"),
    waitingText: document.getElementById("waiting-text"),
    sessionHint: document.getElementById("session-hint"),
    btnToggleControl: document.getElementById("btn-toggle-control"),
    btnCopy: document.getElementById("btn-copy-code"),
    toast: document.getElementById("toast"),
  };

  const state = {
    role: null,
    room: null,
    name: "",
    peer: null,
    call: null,
    dataConn: null,
    localStream: null,
    agentSocket: null,
    agentReady: false,
    controlGranted: false,
    controlling: false,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };

  let toastTimer = null;

  function show(view) {
    el.landing.classList.toggle("hidden", view !== "landing");
    el.hostSetup.classList.toggle("hidden", view !== "host-setup");
    el.joinSetup.classList.toggle("hidden", view !== "join-setup");
    el.session.classList.toggle("hidden", view !== "session");
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2800);
  }

  function setStatus(text, kind = "") {
    el.connStatus.textContent = text;
    el.connStatus.className = "status" + (kind ? ` ${kind}` : "");
  }

  function setAgentStatus(text, kind = "") {
    el.agentStatus.textContent = text;
    el.agentStatus.className = "status subtle" + (kind ? ` ${kind}` : "");
  }

  function randomRoom() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function peerIdForRoom(room) {
    return PEER_PREFIX + room.toLowerCase();
  }

  function cleanupMedia() {
    if (state.localStream) {
      state.localStream.getTracks().forEach((t) => t.stop());
      state.localStream = null;
    }
    el.localVideo.srcObject = null;
    el.remoteVideo.srcObject = null;
  }

  function disconnectAgent() {
    if (state.agentSocket) {
      try {
        state.agentSocket.close();
      } catch (_) {}
      state.agentSocket = null;
    }
    state.agentReady = false;
  }

  function leaveSession() {
    try {
      if (state.call) state.call.close();
    } catch (_) {}
    try {
      if (state.dataConn) state.dataConn.close();
    } catch (_) {}
    try {
      if (state.peer) state.peer.destroy();
    } catch (_) {}

    disconnectAgent();
    cleanupMedia();
    stopControlCapture();

    state.role = null;
    state.room = null;
    state.peer = null;
    state.call = null;
    state.dataConn = null;
    state.controlGranted = false;
    state.controlling = false;

    el.btnToggleControl.classList.add("hidden");
    el.btnToggleControl.textContent = "Request control";
    el.remoteVideo.classList.remove("controlling");
    el.hostPreview.classList.add("hidden");
    el.waiting.classList.remove("hidden");
    show("landing");
  }

  function connectAgent() {
    disconnectAgent();
    setAgentStatus("Looking for control agent…", "warn");

    let socket;
    try {
      socket = new WebSocket(AGENT_URL);
    } catch (_) {
      setAgentStatus("Agent offline — view-only", "warn");
      return;
    }

    state.agentSocket = socket;

    socket.addEventListener("open", () => {
      state.agentReady = true;
      setAgentStatus("Control agent connected", "");
      socket.send(JSON.stringify({ type: "hello", screenWidth: state.screenWidth, screenHeight: state.screenHeight }));
    });

    socket.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "ready") {
          state.agentReady = true;
          if (msg.screenWidth) state.screenWidth = msg.screenWidth;
          if (msg.screenHeight) state.screenHeight = msg.screenHeight;
          setAgentStatus("Control agent ready", "");
        }
      } catch (_) {}
    });

    socket.addEventListener("close", () => {
      state.agentReady = false;
      if (state.role === "host") setAgentStatus("Agent offline — view-only", "warn");
    });

    socket.addEventListener("error", () => {
      state.agentReady = false;
      if (state.role === "host") setAgentStatus("Agent offline — view-only", "warn");
    });
  }

  function forwardToAgent(payload) {
    if (!state.agentReady || !state.agentSocket || state.agentSocket.readyState !== WebSocket.OPEN) {
      return false;
    }
    state.agentSocket.send(JSON.stringify(payload));
    return true;
  }

  function handleHostControlData(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "control-request") {
      const ok = window.confirm(
        `${data.name || "Guest"} wants mouse & keyboard control of this PC. Allow?`
      );
      state.controlGranted = ok;
      if (state.dataConn && state.dataConn.open) {
        state.dataConn.send({ type: "control-response", granted: ok });
      }
      if (ok) {
        toast("Control granted");
        if (!state.agentReady) {
          toast("Start the Windows control agent for real mouse/keyboard");
          connectAgent();
        }
      }
      return;
    }

    if (data.type === "control-end") {
      state.controlGranted = false;
      toast("Guest released control");
      return;
    }

    if (!state.controlGranted) return;

    if (data.type === "mouse" || data.type === "key" || data.type === "wheel") {
      const sent = forwardToAgent(data);
      if (!sent && data.type === "mouse" && data.action === "down") {
        toast("Run the control agent to inject mouse/keyboard");
      }
    }
  }

  function bindHostData(conn) {
    state.dataConn = conn;
    conn.on("open", () => {
      setStatus("Guest connected", "");
      el.waiting.classList.add("hidden");
      el.sessionHint.textContent =
        "Guest can request control. Approve the prompt, and keep the control agent running for full desktop input.";
      conn.send({
        type: "host-info",
        name: state.name,
        screenWidth: state.screenWidth,
        screenHeight: state.screenHeight,
      });
    });
    conn.on("data", handleHostControlData);
    conn.on("close", () => {
      setStatus("Guest disconnected", "warn");
      el.waiting.classList.remove("hidden");
      el.waitingText.textContent = "Waiting for someone to join with your room code…";
      state.controlGranted = false;
    });
  }

  async function startHost() {
    if (typeof Peer === "undefined") {
      toast("PeerJS failed to load — check your network");
      return;
    }

    const name = (el.hostName.value || "Host").trim().slice(0, 24);
    const room = randomRoom();
    state.role = "host";
    state.room = room;
    state.name = name;

    show("session");
    el.rolePill.textContent = "Host";
    el.roomDisplay.textContent = room;
    el.hostPreview.classList.remove("hidden");
    el.waiting.classList.remove("hidden");
    el.waitingText.textContent = "Allow screen share, then share this room code…";
    el.sessionHint.textContent = "Share the room code with the other person.";
    el.btnToggleControl.classList.add("hidden");
    setStatus("Requesting screen…", "warn");
    setAgentStatus("");
    connectAgent();

    try {
      state.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
    } catch (err) {
      toast("Screen share cancelled or blocked");
      leaveSession();
      return;
    }

    el.localVideo.srcObject = state.localStream;
    state.localStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      toast("Screen share stopped");
      leaveSession();
    });

    setStatus("Creating room…", "warn");
    const peer = new Peer(peerIdForRoom(room), {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });
    state.peer = peer;

    peer.on("open", () => {
      setStatus("Room ready — waiting for guest", "");
      el.waitingText.textContent = `Share code ${room} · waiting for guest…`;
      toast(`Room ${room} ready`);
    });

    peer.on("connection", (conn) => {
      bindHostData(conn);
    });

    peer.on("call", (call) => {
      state.call = call;
      call.answer(state.localStream);
      setStatus("Live with guest", "");
      el.waiting.classList.add("hidden");
    });

    peer.on("error", (err) => {
      console.error(err);
      if (String(err?.type) === "unavailable-id") {
        toast("Room code collision — try again");
        leaveSession();
        return;
      }
      setStatus("Connection error", "err");
      toast(err?.message || "Peer error");
    });

    peer.on("disconnected", () => {
      setStatus("Reconnecting…", "warn");
      peer.reconnect();
    });
  }

  function normPoint(video, clientX, clientY) {
    const rect = video.getBoundingClientRect();
    const rw = rect.width;
    const rh = rect.height;
    if (!rw || !rh) return null;

    const videoW = video.videoWidth || rw;
    const videoH = video.videoHeight || rh;
    const scale = Math.min(rw / videoW, rh / videoH);
    const dispW = videoW * scale;
    const dispH = videoH * scale;
    const offX = (rw - dispW) / 2;
    const offY = (rh - dispH) / 2;

    const x = (clientX - rect.left - offX) / dispW;
    const y = (clientY - rect.top - offY) / dispH;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  }

  function sendControl(payload) {
    if (!state.dataConn || !state.dataConn.open || !state.controlling) return;
    state.dataConn.send(payload);
  }

  function onPointer(e, action) {
    if (!state.controlling) return;
    const pt = normPoint(el.remoteVideo, e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    sendControl({
      type: "mouse",
      action,
      x: pt.x,
      y: pt.y,
      button: e.button,
    });
  }

  function onWheel(e) {
    if (!state.controlling) return;
    const pt = normPoint(el.remoteVideo, e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    sendControl({
      type: "wheel",
      x: pt.x,
      y: pt.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    });
  }

  function onKey(e, action) {
    if (!state.controlling) return;
    if (e.target.matches("input, textarea")) return;
    e.preventDefault();
    sendControl({
      type: "key",
      action,
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });
  }

  const keyDown = (e) => onKey(e, "down");
  const keyUp = (e) => onKey(e, "up");

  function startControlCapture() {
    const v = el.remoteVideo;
    v.classList.add("controlling");
    v.addEventListener("pointermove", pointerMove);
    v.addEventListener("pointerdown", pointerDown);
    v.addEventListener("pointerup", pointerUp);
    v.addEventListener("contextmenu", prevent);
    v.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
  }

  function stopControlCapture() {
    const v = el.remoteVideo;
    v.classList.remove("controlling");
    v.removeEventListener("pointermove", pointerMove);
    v.removeEventListener("pointerdown", pointerDown);
    v.removeEventListener("pointerup", pointerUp);
    v.removeEventListener("contextmenu", prevent);
    v.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
  }

  function pointerMove(e) {
    onPointer(e, "move");
  }
  function pointerDown(e) {
    onPointer(e, "down");
  }
  function pointerUp(e) {
    onPointer(e, "up");
  }
  function prevent(e) {
    e.preventDefault();
  }

  function setControlling(on) {
    state.controlling = on;
    el.btnToggleControl.textContent = on ? "Release control" : "Request control";
    if (on) startControlCapture();
    else {
      stopControlCapture();
      if (state.dataConn?.open) state.dataConn.send({ type: "control-end" });
    }
  }

  function requestOrReleaseControl() {
    if (state.controlling) {
      setControlling(false);
      toast("Control released");
      return;
    }
    if (!state.dataConn?.open) {
      toast("Not connected yet");
      return;
    }
    state.dataConn.send({ type: "control-request", name: state.name });
    setStatus("Waiting for host to allow control…", "warn");
  }

  async function startJoin() {
    if (typeof Peer === "undefined") {
      toast("PeerJS failed to load — check your network");
      return;
    }

    const name = (el.joinName.value || "Guest").trim().slice(0, 24);
    const room = (el.roomCode.value || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(room)) {
      toast("Enter the 6-character room code");
      return;
    }

    state.role = "guest";
    state.room = room;
    state.name = name;

    show("session");
    el.rolePill.textContent = "Guest";
    el.roomDisplay.textContent = room;
    el.hostPreview.classList.add("hidden");
    el.waiting.classList.remove("hidden");
    el.waitingText.textContent = "Connecting to host…";
    el.sessionHint.textContent = "When connected, click Request control to use their mouse & keyboard.";
    el.btnToggleControl.classList.remove("hidden");
    el.btnToggleControl.textContent = "Request control";
    setStatus("Connecting…", "warn");
    setAgentStatus("");

    const peer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });
    state.peer = peer;

    peer.on("open", () => {
      const hostId = peerIdForRoom(room);
      const conn = peer.connect(hostId, { reliable: true });
      state.dataConn = conn;

      conn.on("open", () => {
        setStatus("Linked — opening screen…", "warn");
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const dummy = canvas.captureStream();
        const call = peer.call(hostId, dummy);
        state.call = call;

        call.on("stream", (stream) => {
          el.remoteVideo.srcObject = stream;
          el.waiting.classList.add("hidden");
          setStatus("Watching screen", "");
          toast("Connected");
        });

        call.on("close", () => {
          setStatus("Host ended the share", "warn");
          el.waiting.classList.remove("hidden");
          el.waitingText.textContent = "Host disconnected.";
          setControlling(false);
        });

        call.on("error", (err) => {
          console.error(err);
          setStatus("Call failed", "err");
        });
      });

      conn.on("data", (data) => {
        if (!data || typeof data !== "object") return;
        if (data.type === "host-info") {
          if (data.screenWidth) state.screenWidth = data.screenWidth;
          if (data.screenHeight) state.screenHeight = data.screenHeight;
        }
        if (data.type === "control-response") {
          if (data.granted) {
            setControlling(true);
            setStatus("You have control", "");
            toast("Control granted — move mouse over the video");
          } else {
            setStatus("Control denied", "warn");
            toast("Host denied control");
          }
        }
      });

      conn.on("close", () => {
        setStatus("Disconnected", "warn");
        setControlling(false);
      });

      conn.on("error", (err) => {
        console.error(err);
        setStatus("Could not reach host", "err");
        toast("Check the room code — host must be sharing");
      });
    });

    peer.on("error", (err) => {
      console.error(err);
      setStatus("Connection error", "err");
      toast(err?.message || "Could not connect");
    });
  }

  // UI wiring
  document.getElementById("btn-host").addEventListener("click", () => show("host-setup"));
  document.getElementById("btn-join").addEventListener("click", () => show("join-setup"));
  document.getElementById("btn-back-host").addEventListener("click", () => show("landing"));
  document.getElementById("btn-back-join").addEventListener("click", () => show("landing"));
  document.getElementById("btn-start-host").addEventListener("click", startHost);
  document.getElementById("btn-start-join").addEventListener("click", startJoin);
  document.getElementById("btn-leave").addEventListener("click", leaveSession);
  el.btnToggleControl.addEventListener("click", requestOrReleaseControl);

  el.btnCopy.addEventListener("click", async () => {
    if (!state.room) return;
    try {
      await navigator.clipboard.writeText(state.room);
      toast("Room code copied");
    } catch (_) {
      toast(state.room);
    }
  });

  el.roomCode.addEventListener("input", () => {
    el.roomCode.value = el.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  window.addEventListener("beforeunload", () => {
    if (state.peer) leaveSession();
  });
})();

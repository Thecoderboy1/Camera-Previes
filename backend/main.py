import os
import secrets
import json
import asyncio
import time
from typing import Dict, Optional, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Configurable environment variables
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")
ALLOWED_ORIGINS_STR = os.getenv("ALLOWED_ORIGINS", "*")
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", 3600))  # 1 hour
INACTIVITY_TTL_SECONDS = int(os.getenv("INACTIVITY_TTL_SECONDS", 900))  # 15 minutes

app = FastAPI(
    title="Luma Monitor Signaling Server",
    description="WebSocket & HTTP WebRTC Signaling Backend for Luma Monitor",
    version="1.1.0"
)

# Parse CORS origins
if ALLOWED_ORIGINS_STR == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_origin_regex=r"https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    allowed_list = [origin.strip() for origin in ALLOWED_ORIGINS_STR.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

class Session:
    def __init__(self, session_id: str, token: str):
        self.id = session_id
        self.token = token
        self.viewer_ws: Optional[WebSocket] = None
        self.camera_ws: Optional[WebSocket] = None
        self.sse_queues: List[asyncio.Queue] = []
        self.viewer_messages: List[dict] = []
        self.camera_messages: List[dict] = []
        self.created_at = time.time()
        self.last_activity = time.time()
        self.expires_at = self.created_at + SESSION_TTL_SECONDS

    def touch(self):
        self.last_activity = time.time()

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def is_inactive(self) -> bool:
        has_connections = (self.viewer_ws is not None) or (self.camera_ws is not None) or bool(self.sse_queues)
        return (not has_connections) and ((time.time() - self.last_activity) > INACTIVITY_TTL_SECONDS)

class ConnectionManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}

    def create_session(self) -> Session:
        session_id = secrets.token_hex(3).upper()  # 6-character random hex
        token = secrets.token_hex(16)
        session = Session(session_id, token)
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        session = self.sessions.get(session_id.upper())
        if session and session.is_expired():
            self.delete_session(session_id)
            return None
        return session

    def delete_session(self, session_id: str):
        session_id = session_id.upper()
        if session_id in self.sessions:
            del self.sessions[session_id]

    async def broadcast(self, session: Session, target_role: str, message: dict):
        session.touch()
        json_str = json.dumps(message)

        # WebSockets
        if target_role in ("viewer", "all") and session.viewer_ws:
            try:
                await session.viewer_ws.send_text(json_str)
            except Exception:
                session.viewer_ws = None

        if target_role in ("camera", "all") and session.camera_ws:
            try:
                await session.camera_ws.send_text(json_str)
            except Exception:
                session.camera_ws = None

        # SSE Queues
        for queue in list(session.sse_queues):
            try:
                await queue.put(message)
            except Exception:
                pass

        # Message buffer for HTTP polling
        if target_role in ("viewer", "all"):
            session.viewer_messages.append(message)
            if len(session.viewer_messages) > 50:
                session.viewer_messages.pop(0)

        if target_role in ("camera", "all"):
            session.camera_messages.append(message)
            if len(session.camera_messages) > 50:
                session.camera_messages.pop(0)

    def cleanup_old_sessions(self):
        expired_ids = [
            sid for sid, s in self.sessions.items()
            if s.is_expired() or s.is_inactive()
        ]
        for sid in expired_ids:
            del self.sessions[sid]

manager = ConnectionManager()

@app.on_event("startup")
async def schedule_periodic_cleanup():
    async def cleanup_loop():
        while True:
            await asyncio.sleep(60)
            manager.cleanup_old_sessions()
    asyncio.create_task(cleanup_loop())

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "luma-monitor-backend",
        "active_sessions": len(manager.sessions),
        "timestamp": int(time.time() * 1000)
    }

@app.post("/api/sessions", status_code=status.HTTP_201_CREATED)
def create_session_endpoint():
    session = manager.create_session()
    return {
        "sessionId": session.id,
        "token": session.token,
        "createdAt": int(session.created_at * 1000),
        "expiresAt": int(session.expires_at * 1000)
    }

@app.get("/api/sessions/{session_id}")
def get_session_info(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    session.touch()
    return {
        "sessionId": session.id,
        "hasViewer": session.viewer_ws is not None,
        "hasCamera": session.camera_ws is not None,
        "createdAt": int(session.created_at * 1000),
        "expiresAt": int(session.expires_at * 1000)
    }

@app.post("/api/sessions/{session_id}/signal")
async def post_signal(session_id: str, body: dict):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.touch()
    role = body.get("role", "viewer")
    msg_type = body.get("type")
    payload = body.get("payload")

    if msg_type == "camera_joined":
        await manager.broadcast(session, "viewer", {"type": "camera_joined"})
        return {"success": True}

    if msg_type == "end_session":
        await manager.broadcast(session, "camera", {"type": "session_ended"})
        manager.delete_session(session.id)
        return {"success": True}

    target = "camera" if role == "viewer" else "viewer"
    await manager.broadcast(session, target, {"type": "signal", "payload": payload})
    return {"success": True}

@app.get("/api/sessions/{session_id}/events")
async def sse_events(session_id: str, role: str = Query("viewer")):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    queue = asyncio.Queue()
    session.sse_queues.append(queue)
    session.touch()

    if role == "camera":
        await manager.broadcast(session, "viewer", {"type": "camera_joined"})

    async def event_generator():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'role': role})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in session.sse_queues:
                session.sse_queues.remove(queue)
            if role == "camera":
                await manager.broadcast(session, "viewer", {"type": "camera_left"})
            elif role == "viewer":
                await manager.broadcast(session, "camera", {"type": "viewer_left"})

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/sessions/{session_id}/messages")
def poll_messages(session_id: str, role: str = Query(...)):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.touch()
    queue = session.viewer_messages if role == "viewer" else session.camera_messages
    messages = list(queue)
    queue.clear()
    return {"messages": messages}

@app.post("/api/sessions/{session_id}/end")
async def end_session(session_id: str):
    session = manager.get_session(session_id)
    if session:
        await manager.broadcast(session, "camera", {"type": "session_ended"})
        manager.delete_session(session.id)
    return {"success": True}

@app.websocket("/ws")
@app.websocket("/ws/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_session_id = None
    current_role = None

    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            # Keepalive ping/pong
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": int(time.time() * 1000)})
                continue

            if msg_type == "create_session":
                session = manager.create_session()
                current_session_id = session.id
                current_role = "viewer"
                session.viewer_ws = websocket
                await websocket.send_json({
                    "type": "session_created",
                    "sessionId": session.id,
                    "token": session.token
                })

            elif msg_type == "join_session":
                session_id = data.get("sessionId", "").upper()
                role = data.get("role")
                session = manager.get_session(session_id)

                if not session:
                    await websocket.send_json({"type": "error", "message": "Session not found or expired"})
                    continue

                current_session_id = session_id
                current_role = role

                if role == "camera":
                    session.camera_ws = websocket
                    await websocket.send_json({"type": "joined", "sessionId": session_id})
                    await manager.broadcast(session, "viewer", {"type": "camera_joined"})
                elif role == "viewer":
                    session.viewer_ws = websocket
                    await websocket.send_json({"type": "joined", "sessionId": session_id})

            elif msg_type == "signal":
                if not current_session_id:
                    continue
                session = manager.get_session(current_session_id)
                if not session:
                    continue

                payload = data.get("payload")
                target = "camera" if current_role == "viewer" else "viewer"
                await manager.broadcast(session, target, {"type": "signal", "payload": payload})

            elif msg_type == "end_session":
                if current_session_id:
                    session = manager.get_session(current_session_id)
                    if session:
                        await manager.broadcast(session, "camera", {"type": "session_ended"})
                        manager.delete_session(current_session_id)

    except WebSocketDisconnect:
        if current_session_id:
            session = manager.get_session(current_session_id)
            if session:
                if current_role == "camera":
                    session.camera_ws = None
                    await manager.broadcast(session, "viewer", {"type": "camera_left"})
                elif current_role == "viewer":
                    session.viewer_ws = None
                    await manager.broadcast(session, "camera", {"type": "viewer_left"})

if __name__ == "__main__":
    import uvicorn
    print(f"Starting Luma Monitor Backend on {HOST}:{PORT}")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)

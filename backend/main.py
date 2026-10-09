from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import secrets
import json
import asyncio
from typing import Dict, Optional

app = FastAPI(title="Luma Monitor Signaling Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Session:
    def __init__(self, session_id: str):
        self.id = session_id
        self.viewer: Optional[WebSocket] = None
        self.camera: Optional[WebSocket] = None

class ConnectionManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}

    def create_session(self) -> str:
        # Generate a 6-character random hex string
        session_id = secrets.token_hex(3).upper()
        self.sessions[session_id] = Session(session_id)
        return session_id

    def get_session(self, session_id: str) -> Optional[Session]:
        return self.sessions.get(session_id)

    def delete_session(self, session_id: str):
        if session_id in self.sessions:
            del self.sessions[session_id]

manager = ConnectionManager()

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.websocket("/ws")
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

            if msg_type == "create_session":
                current_session_id = manager.create_session()
                current_role = "viewer"
                session = manager.get_session(current_session_id)
                session.viewer = websocket
                await websocket.send_json({"type": "session_created", "sessionId": current_session_id})
                print(f"Session {current_session_id} created by viewer.")

            elif msg_type == "join_session":
                session_id = data.get("sessionId")
                role = data.get("role")
                session = manager.get_session(session_id)

                if not session:
                    await websocket.send_json({"type": "error", "message": "Session not found"})
                    continue

                if role == "camera":
                    if session.camera:
                        await websocket.send_json({"type": "error", "message": "Camera already connected"})
                        continue
                    
                    session.camera = websocket
                    current_session_id = session_id
                    current_role = "camera"
                    await websocket.send_json({"type": "joined", "sessionId": session_id})
                    
                    if session.viewer:
                        await session.viewer.send_json({"type": "camera_joined"})
                    print(f"Camera joined session {session_id}.")

            elif msg_type == "signal":
                if not current_session_id:
                    continue
                session = manager.get_session(current_session_id)
                if not session:
                    continue

                payload = data.get("payload")
                
                if current_role == "viewer" and session.camera:
                    await session.camera.send_json({"type": "signal", "payload": payload})
                elif current_role == "camera" and session.viewer:
                    await session.viewer.send_json({"type": "signal", "payload": payload})

            elif msg_type == "end_session":
                if current_session_id and current_role == "viewer":
                    session = manager.get_session(current_session_id)
                    if session and session.camera:
                        try:
                            await session.camera.send_json({"type": "session_ended"})
                        except Exception:
                            pass
                    manager.delete_session(current_session_id)
                    print(f"Session {current_session_id} ended by viewer.")
                    
    except WebSocketDisconnect:
        if current_session_id:
            session = manager.get_session(current_session_id)
            if session:
                if current_role == "camera":
                    session.camera = None
                    if session.viewer:
                        try:
                            await session.viewer.send_json({"type": "camera_left"})
                        except Exception:
                            pass
                    print(f"Camera left session {current_session_id}.")
                elif current_role == "viewer":
                    if session.camera:
                        try:
                            await session.camera.send_json({"type": "viewer_left"})
                        except Exception:
                            pass
                    manager.delete_session(current_session_id)
                    print(f"Viewer left session {current_session_id}, session deleted.")

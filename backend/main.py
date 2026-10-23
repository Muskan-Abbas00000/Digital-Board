import json, asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from orchestrator import Session, make_plan, make_scene

app = FastAPI()
logger = logging.getLogger(__name__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/test")
async def test(topic: str = "How does a TCP handshake work?"):
    """Quick browser test: returns the plan and the first scene."""
    plan = await make_plan(topic, "beginner")
    scene = await make_scene(topic, plan.scenes[0], "beginner", [])
    return {"plan": plan.model_dump(), "first_scene": scene.model_dump()}


@app.websocket("/ws")
async def ws_endpoint(sock: WebSocket):
    await sock.accept()
    s = Session(sock)
    background: set[asyncio.Task] = set()
    try:
        while True:
            try:
                m = json.loads(await sock.receive_text())
            except json.JSONDecodeError:
                await sock.send_json({"type": "error", "message": "Invalid message from the browser."})
                continue
            t = m.get("type")
            if t == "start":
                topic = str(m.get("topic", "")).strip()
                if not topic:
                    await sock.send_json({"type": "error", "message": "Enter a topic to start a lesson."})
                    continue
                s.level = m.get("level", "beginner")
                if s.task:
                    s.task.cancel()
                s.task = asyncio.create_task(s.teach(topic))
            elif t == "interrupt":
                text = str(m.get("text", "")).strip()
                if text:
                    task = asyncio.create_task(s.interrupt(text))
                    background.add(task)
                    task.add_done_callback(background.discard)
            elif t == "scene_done":
                if s._done and not s._done.done():
                    s._done.set_result(True)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket session failed")
    finally:
        if s.task:
            s.task.cancel()
        for task in background:
            task.cancel()
        if background:
            await asyncio.gather(*background, return_exceptions=True)

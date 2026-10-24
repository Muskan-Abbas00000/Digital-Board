# Project Skill: Digital Board

Use this guide when changing or operating this repository.

## Product context

Digital Board is an online, browser based teaching board backed by the Gemini API. It is not an offline model runner. Keep the Gemini API key on the backend as `GEMINI_API_KEY` (or `Gemini` for an existing deployment); never put it in a `VITE_*` variable, frontend source, logs, documentation, or committed files. The committed `.env.example` files must contain placeholders only.

## Architecture

- `frontend/` is a React + TypeScript + Vite single page app.
- `backend/main.py` exposes the health check, a sample generation route, and the `/ws` lesson WebSocket.
- `backend/orchestrator.py` plans lessons, generates scenes, and handles learner interruptions.
- `backend/llm.py` calls Gemini and validates the JSON response through the Pydantic models in `backend/schemas.py`.
- `backend/prompts.py` contains prompts for lesson planning, scene writing, and interruption routing.

The browser sends WebSocket messages with `type` values such as `start`, `interrupt`, and `scene_done`. The backend returns `status`, `scene`, `pause`, `resume`, `done`, and `error` messages. Keep these event names and payloads coordinated between the frontend and backend when changing the protocol.

## Development

- Install Python dependencies with `python -m pip install -r backend/requirements.txt`.
- Install frontend dependencies from `frontend/` with `npm install`.
- Copy `backend/.env.example` to `backend/.env` and add a valid `GEMINI_API_KEY` locally.
- Run the backend from the repository root with `python -m uvicorn main:app --app-dir backend --reload --port 8000`.
- Run the frontend from `frontend/` with `npm run dev`. `VITE_BACKEND_URL` defaults to `http://localhost:8000`.
- Create a production frontend bundle with `npm run build` from `frontend/`.

## Change guidelines

- Keep provider credentials exclusively in backend environment configuration.
- Preserve schema shaped JSON output expected by `Plan`, `Scene`, `Action`, and `Intent`.
- Handle WebSocket disconnects, cancelled lesson tasks, and model/provider errors without leaking credentials.
- Keep `.env`, virtual environments, dependency folders, and build output out of Git.
- Update `README.md` when setup, runtime requirements, endpoints, or deployment steps change.

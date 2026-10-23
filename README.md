# Digital Board

Digital Board is an AI guided teaching board. Enter a topic and learning level, and the app builds a lesson as a sequence of narrated scenes with diagrams, formulas, and text. You can interrupt a lesson to ask a question, repeat a scene, simplify it, or switch topics.

The application runs as a web frontend with a Python backend. The backend calls the Gemini API, so an API key is required and must remain on the server. It does not run a model locally.

## Requirements

- Python 3.10 or newer
- Node.js 20.19+ or 22.12+ (required by Vite 8)
- A Gemini API key with access to at least one configured model

## Setup

### 1. Configure the backend

In PowerShell from the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env` and set `GEMINI_API_KEY` to your key. The example file also lets you configure `GEMINI_MODEL` and `GEMMA_MODEL`; these are tried in that order. Keep `backend/.env` private and never commit it.

### 2. Install and configure the frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

For local development, the example `VITE_BACKEND_URL` points to `http://localhost:8000`. Change it to the deployed backend origin when hosting the frontend elsewhere. The backend must allow browser requests from the frontend origin in production.

### 3. Start both services

In one terminal, from the repository root:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd frontend
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`). The backend health endpoint is `http://localhost:8000/health`. The optional `/test` endpoint makes a sample lesson generation request and therefore uses the configured API key.

## How it works

- React and TypeScript render the interactive board. Mermaid draws diagrams, KaTeX renders formulas, and browser speech APIs provide narration and voice input where supported.
- The frontend connects to the backend WebSocket at `/ws` (using `VITE_BACKEND_URL` as its base URL).
- FastAPI plans lesson scenes and asks the Gemini API to produce structured scene content. The API key is read only by the backend from `GEMINI_API_KEY`.

## Production notes

Deploy the backend and frontend as separate services or behind a reverse proxy that supports WebSockets. Set `GEMINI_API_KEY` in the backend host's secret/environment settings and `VITE_BACKEND_URL` to the public backend origin at frontend build time. Configure CORS in `backend/main.py` for the actual frontend origin before exposing the backend publicly; its current development setting permits all origins. Use HTTPS/WSS in production. Browser speech recognition availability depends on the browser and operating system.

## Troubleshooting

- **Backend exits at startup:** check that `backend/.env` exists and contains a valid `GEMINI_API_KEY`.
- **Frontend cannot connect:** confirm the backend is running, check `VITE_BACKEND_URL`, and verify the host/proxy supports WebSockets.
- **Model or API error:** check API key validity, billing/quota, model availability, and the model names configured in `backend/.env`; inspect the backend terminal for provider errors.
- **Voice input is unavailable:** use a supported browser or type the question into the lesson controls.

## Repository layout

```text
backend/       FastAPI WebSocket server and Gemini lesson generation
frontend/      React, TypeScript, and Vite application
SKILL.md       Project guidance for coding agents
```


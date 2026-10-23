import os, json, asyncio
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai import errors
import httpx

# Keep credentials on the backend. A local backend/.env is ignored by Git;
# process environment variables still take precedence over values in the file.
load_dotenv(Path(__file__).with_name(".env"), override=False)
_api_key = os.getenv("GEMINI_API_KEY")
if not _api_key:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. Add it to backend/.env or the backend process environment."
    )
_client = genai.Client(
    api_key=_api_key,
    http_options=types.HttpOptions(
        timeout=30_000,
        retry_options=types.HttpRetryOptions(attempts=1),
    ),
)
MODELS = list(dict.fromkeys([
    os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
    os.getenv("GEMMA_MODEL", "gemma-4-26b-a4b-it"),
    "gemma-4-31b-it",
]))


def _extract_json(text: str):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON found in model reply: " + text[:200])
    return json.loads(text[start:end + 1])


async def ask(system: str, user: str, schema: dict, temp: float = 0.3):
    prompt = (
        f"{system}\n\n"
        "Reply with ONLY one valid JSON object that matches this schema. "
        "No code fences, no explanation.\n"
        f"Schema: {json.dumps(schema)}\n\n"
        f"Task: {user}"
    )
    last_err = None
    for model in MODELS:
        for attempt in range(2):
            try:
                r = await _client.aio.models.generate_content(
                    model=model, contents=prompt,
                    config={"temperature": temp, "max_output_tokens": 1200},
                )
                if not r.text:
                    raise ValueError("Gemini returned an empty response")
                return _extract_json(r.text)
            except httpx.TransportError as e:
                raise RuntimeError(
                    "Cannot reach the Gemini API. Check that this computer has internet access and that a firewall or proxy allows generativelanguage.googleapis.com."
                ) from e
            except (errors.ServerError, errors.APIError) as e:
                if getattr(e, "code", None) in (400, 401, 403, 404):
                    raise RuntimeError(
                        "Gemini rejected the request. Check the API key, model access, and selected GEMMA_MODEL."
                    ) from e
                last_err = e
                print(f"[llm] {model} attempt {attempt + 1} failed ({type(e).__name__}, status={getattr(e, 'code', 'unknown')})")
                await asyncio.sleep(1 * (attempt + 1))
            except ValueError as e:  # bad JSON, just try again
                last_err = e
    if last_err is None:
        raise RuntimeError("Gemini did not return a usable response")
    raise RuntimeError("Gemini could not complete the request. Check the backend log for details.") from last_err

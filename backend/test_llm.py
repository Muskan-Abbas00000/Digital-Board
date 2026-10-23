import asyncio
from llm import ask

schema = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "narration": {"type": "string"},
    },
    "required": ["title", "narration"],
}

async def main():
    out = await ask(
        "You are a friendly teacher.",
        "Explain in 2 short sentences what a TCP handshake is.",
        schema,
    )
    print(out)

asyncio.run(main())
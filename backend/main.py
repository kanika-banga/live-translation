import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from deep_translator import GoogleTranslator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Real-Time Translation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All languages supported by this app
SUPPORTED_LANGS = {"en", "de", "fr", "hi", "es", "pa"}


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "de"


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/translate")
async def translate(req: TranslateRequest):
    text = req.text.strip()
    if not text:
        return {"status": "error", "error": "Empty text"}

    source_lang = req.source_lang.lower()
    target_lang = req.target_lang.lower()

    if source_lang not in SUPPORTED_LANGS:
        return {"status": "error", "error": f"Unsupported source language: {source_lang}"}
    if target_lang not in SUPPORTED_LANGS:
        return {"status": "error", "error": f"Unsupported target language: {target_lang}"}
    if source_lang == target_lang:
        return {"status": "error", "error": "Source and target languages must differ"}

    logger.info("[%s→%s] %s", source_lang, target_lang, text)
    try:
        translated = GoogleTranslator(source=source_lang, target=target_lang).translate(text)
        logger.info("[%s] %s", target_lang, translated)
        return {
            "status": "success",
            "original": text,
            "translated": translated,
            "source_lang": source_lang,
            "target_lang": target_lang,
        }
    except Exception as exc:
        logger.error("Translation failed: %s", exc)
        return {"status": "error", "error": str(exc)}


@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket):
    """Kept for connection-status monitoring by the frontend."""
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()   # keep-alive; actual translation uses REST
    except WebSocketDisconnect:
        pass

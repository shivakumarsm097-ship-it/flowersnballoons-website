"""FastAPI entrypoint — hosted on Railway.

Run: uvicorn backend.server:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.webhooks.instagram import router as instagram_router
from backend.webhooks.razorpay import router as razorpay_router
from backend.webhooks.web_form import router as web_form_router
from backend.webhooks.whatsapp import router as whatsapp_router

app = FastAPI(title="Flowers 'N' Balloons — agent backend")

# the static site posts the contact form cross-origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://shivakumarsm097-ship-it.github.io",
        "https://www.flowersnballoons.com",
        "https://flowersnballoons.com",
    ],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

app.include_router(web_form_router)
app.include_router(whatsapp_router)
app.include_router(instagram_router)
app.include_router(razorpay_router)


@app.get("/")
async def health():
    return {"ok": True, "service": "flowersnballoons-agents"}

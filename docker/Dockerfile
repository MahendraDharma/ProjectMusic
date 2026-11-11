# Server pribadi ProjectMusic dalam container.
# Build dari folder repo:  docker compose -f docker/compose.yaml up -d --build
FROM python:3.12-slim

# yt-dlp butuh JS runtime untuk YouTube (lihat /api/health -> "jsRuntime")
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN python -m venv /venv \
 && /venv/bin/pip install -q --upgrade pip \
 && /venv/bin/pip install -q -r server/requirements.txt
COPY public public
COPY server server

WORKDIR /app/server
ENV PATH=/venv/bin:$PATH \
    PM_HOST=0.0.0.0 \
    PM_PORT=8080 \
    PM_COUNTRY=ID \
    PM_AUTO_UPDATE=0
EXPOSE 8080

# Seperti start.sh: perbarui yt-dlp setiap start, karena YouTube sering berubah.
CMD ["sh", "-c", "pip install -q --upgrade 'yt-dlp[default]' >/dev/null 2>&1 || true; exec python projectmusic_server.py --no-update"]

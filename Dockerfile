FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    PATH=/farmguard/Iazinha/.venv/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv libgl1 libglib2.0-0 rclone \
    && rm -rf /var/lib/apt/lists/*

COPY docker/requirements-python.txt /tmp/requirements-python.txt
RUN python3 -m venv /farmguard/Iazinha/.venv \
    && /farmguard/Iazinha/.venv/bin/python -m pip install --upgrade pip \
    && /farmguard/Iazinha/.venv/bin/python -m pip install 'torch==2.14.0+cu130' \
      --index-url https://download.pytorch.org/whl/cu130 \
      --extra-index-url https://pypi.org/simple \
    && /farmguard/Iazinha/.venv/bin/python -m pip install -r /tmp/requirements-python.txt \
    && rm /tmp/requirements-python.txt

RUN /farmguard/Iazinha/.venv/bin/python -m pip install pi-heif==1.4.0
ENV YOLO_AUTOINSTALL=false

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist /app/dist
COPY --from=build /app/dist-server /app/dist-server
COPY --from=build /app/server/python /app/server/python

EXPOSE 4310
CMD ["node", "dist-server/server/index.js"]

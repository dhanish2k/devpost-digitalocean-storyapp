FROM python:3.11-slim

# Copy uv binary from the official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy workspace config and lockfile first (layer caching)
COPY pyproject.toml uv.lock ./

# Copy local packages and backend source
COPY packages/ packages/
COPY apps/backend/ apps/backend/

# Install only the backend package and its deps (no dev deps)
RUN uv sync --package storyapp-backend --no-dev

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--app-dir", "apps/backend"]

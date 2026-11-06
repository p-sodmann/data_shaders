# Demo station image. Build from the repo root, because the probe is a path dependency:
#   docker build -f examples/demo/Dockerfile -t mars-demo .
# Default command: one station on :8000 (set MARS_STATION). Same image for the loadgen:
#   docker run -e LOADGEN_TARGETS=http://demo-api:8000 mars-demo python -m demo.loadgen
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

# Bytecode compiled at build time (faster start), copied rather than hard-linked out of uv's
# cache, and only the image's own Python.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /src/examples/demo

# Dependencies first, so editing the demo code doesn't reinstall them. The probe is installed as
# a regular (non-editable) wheel, so the venv doesn't depend on the source tree at runtime.
COPY probe /src/probe
COPY examples/demo/pyproject.toml examples/demo/uv.lock ./
RUN uv sync --frozen --no-dev --no-editable --no-install-project

COPY examples/demo/demo ./demo
RUN uv sync --frozen --no-dev --no-editable

ENV PATH=/src/examples/demo/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    MARS_STATION=api
USER nobody
EXPOSE 8000
CMD ["uvicorn", "demo.app:app", "--host", "0.0.0.0", "--port", "8000"]

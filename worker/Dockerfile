# Stage 1: Build virtual environment and install dependencies
FROM python:3.12-slim AS builder

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Production runtime
FROM python:3.12-slim AS runner

WORKDIR /app

# Create unprivileged application user
RUN groupadd -g 10001 workeruser && \
    useradd -u 10001 -g workeruser -s /bin/sh -m workeruser

# Copy virtualenv from builder stage
COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy worker application source files
COPY --chown=workeruser:workeruser config.py db.py engine.py main.py redis_client.py ./

# Switch to non-root user
USER workeruser

CMD ["python", "-u", "main.py"]

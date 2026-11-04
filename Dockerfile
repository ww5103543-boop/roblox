FROM python:3.11-slim

WORKDIR /app

# Python environment settings
ENV PYTHONUNBUFFERED=1 \
    PORT=8770

# Copy application files
COPY server.py ./
COPY public ./public

# Expose default port
EXPOSE 8770

# Run the Insomniac cloud server
CMD ["python", "server.py"]


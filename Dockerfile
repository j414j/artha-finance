# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY frontend/ .
RUN npm run build

# Stage 2: Build backend
FROM rust:1-slim AS backend-builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y pkg-config libssl-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ .
RUN cargo build --release

# Stage 3: Final image
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y ca-certificates libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=backend-builder /app/target/release/artha ./artha
COPY --from=backend-builder /app/target/release/create_user ./create_user
COPY --from=backend-builder /app/migrations ./migrations
COPY --from=frontend-builder /app/frontend/dist ./static

RUN mkdir -p /app/data

ENV DATABASE_URL=sqlite:/app/data/artha.db
ENV HOST=0.0.0.0
ENV PORT=8080
ENV STATIC_DIR=/app/static
ENV RUST_LOG=artha_backend=info,tower_http=info

EXPOSE 8080

VOLUME ["/app/data"]

CMD ["./artha"]

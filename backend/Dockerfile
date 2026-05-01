FROM rust:1-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y pkg-config libssl-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y ca-certificates curl libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/artha .
COPY --from=builder /app/migrations ./migrations

EXPOSE 8080
CMD ["./artha"]

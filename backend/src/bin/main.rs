use artha_backend::{db, routes, state::AppState};
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "artha_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:../data/artha.db".into());
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a valid number");

    let pool = db::create_pool(&database_url)
        .await
        .expect("Failed to connect to database");
    db::run_migrations(&pool)
        .await
        .expect("Failed to run database migrations");

    let state = AppState { db: pool };

    let app = Router::new()
        .route("/api/v1/health", get(health_check))
        .nest("/api/v1/auth", routes::auth::router())
        .nest("/api/v1/accounts", routes::accounts::router())
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let addr: SocketAddr = format!("{host}:{port}").parse().expect("Invalid HOST:PORT");
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

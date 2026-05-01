use artha_backend::{db, models::user::generate_initials};
use std::io::{self, Write};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let args: Vec<String> = std::env::args().collect();

    let (email, display_name) = match args.as_slice() {
        [_, email, display_name, ..] => (email.clone(), display_name.clone()),
        _ => {
            let email = prompt("Email: ")?;
            let display_name = prompt("Display name: ")?;
            (email, display_name)
        }
    };

    let password = prompt("Password (min 8 chars): ")?;
    if password.len() < 8 {
        eprintln!("Error: password must be at least 8 characters");
        std::process::exit(1);
    }

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:../data/artha.db".into());

    let pool = db::create_pool(&database_url).await?;
    db::run_migrations(&pool).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)
        .map_err(|e| anyhow::anyhow!("bcrypt: {}", e))?;
    let avatar_initials = generate_initials(&display_name);
    let email = email.to_lowercase();
    let email = email.trim();

    let result = sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash, avatar_initials) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(email)
    .bind(&display_name)
    .bind(&password_hash)
    .bind(&avatar_initials)
    .execute(&pool)
    .await;

    match result {
        Ok(_) => {
            println!(
                "✓ Created user: {} <{}>  [{}]",
                display_name, email, avatar_initials
            );
        }
        Err(e) if e.to_string().contains("UNIQUE") => {
            eprintln!("Error: {} is already registered", email);
            std::process::exit(1);
        }
        Err(e) => return Err(e.into()),
    }

    Ok(())
}

fn prompt(msg: &str) -> io::Result<String> {
    print!("{msg}");
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    Ok(buf.trim().to_string())
}

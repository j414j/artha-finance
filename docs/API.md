# Artha API Reference

Base path: `/api/v1/`  
Error format: `{ "error": { "code": "SCREAMING_SNAKE", "message": "human readable" } }`  
Dates: ISO 8601 / DD/MM/YYYY in display  
Money: all amounts in **paise** (i64), never floats  
Auth: session cookie `session_id` (HttpOnly, SameSite=Lax)

---

## Auth

### POST /api/v1/auth/register
Create a new user account.

**Body**
```json
{ "email": "user@example.com", "display_name": "Rahul Sharma", "password": "min8chars" }
```

**Response 201**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `BAD_REQUEST` (email taken, password too short)

---

### POST /api/v1/auth/login
Authenticate and start a session. Sets `session_id` HttpOnly cookie (30-day expiry).

**Body**
```json
{ "email": "user@example.com", "password": "..." }
```

**Response 200**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `BAD_REQUEST` (invalid credentials)

---

### POST /api/v1/auth/logout
Clear the session. Always succeeds (idempotent). No auth required.

**Response 204** (no body)

---

### GET /api/v1/auth/me
Return the currently authenticated user. Requires valid session cookie.

**Response 200**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `UNAUTHORIZED`

---

## Health

### GET /api/v1/health

**Response 200**
```json
{ "status": "ok" }
```

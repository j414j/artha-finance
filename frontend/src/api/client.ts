const BASE = '/api/v1'

interface ApiErrorBody {
  error: { code: string; message: string }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  })

  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const err = body as ApiErrorBody | null
    throw new ApiError(
      res.status,
      err?.error?.code ?? 'UNKNOWN',
      err?.error?.message ?? 'An unexpected error occurred',
    )
  }

  return body as T
}

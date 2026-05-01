import { request } from './client'
import type { User } from '../types/user'

interface AuthResponse {
  user: User
}

export const getMe = () => request<AuthResponse>('/auth/me')

export const loginUser = (email: string, password: string) =>
  request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

export const registerUser = (email: string, display_name: string, password: string) =>
  request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, display_name, password }),
  })

export const logoutUser = () => request<void>('/auth/logout', { method: 'POST' })

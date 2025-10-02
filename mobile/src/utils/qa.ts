import { environment } from '../config/environment';

export function isQaBuild(): boolean {
  return __DEV__ || environment.name !== 'production';
}

export function getQaSummary(): string {
  return `${environment.name} • ${environment.apiBaseUrl}`;
}

import type { AuthTokens } from '../types';

const CLIENT_ID = 'acp-browser-extension';
const REALM = 'ambient';

function getKeycloakBaseUrl(acpServerUrl: string): string {
  try {
    const url = new URL(acpServerUrl);
    url.hostname = url.hostname.replace(/^ambient-api-server-/, 'keycloak-');
    return url.toString().replace(/\/$/, '');
  } catch {
    return acpServerUrl;
  }
}

function getTokenEndpoint(acpServerUrl: string): string {
  const base = getKeycloakBaseUrl(acpServerUrl);
  return `${base}/realms/${REALM}/protocol/openid-connect/token`;
}

export class KeycloakAuth {
  private tokenEndpoint: string;

  constructor(acpServerUrl: string) {
    this.tokenEndpoint = getTokenEndpoint(acpServerUrl);
  }

  async login(username: string, password: string): Promise<AuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username,
      password,
      scope: 'openid',
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Login failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  isExpired(tokens: AuthTokens): boolean {
    return Date.now() >= tokens.expiresAt - 60_000;
  }
}

export { getKeycloakBaseUrl };

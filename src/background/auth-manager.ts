import type { AuthState, UserProfile, ExtensionSettings } from '../types';
import type { StorageManager } from './storage-manager';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
/** Errors that indicate the refresh token is permanently invalid (not transient). */
const PERMANENT_REFRESH_ERRORS = ['invalid_grant', 'invalid_token', 'token_expired'];

export class AuthManager {
  constructor(private readonly storage: StorageManager) {}

  async getState(): Promise<AuthState> {
    const data = await this.storage.getAuthData();
    const expiresAt = data.expiresAt as number | undefined;

    if (!data.accessToken || !expiresAt) {
      return { isAuthenticated: false };
    }
    if (Date.now() >= expiresAt) {
      await this.storage.clearAuthData();
      return { isAuthenticated: false };
    }
    return {
      isAuthenticated: true,
      accessToken: data.accessToken as string,
      expiresAt,
      user: data.user as UserProfile | undefined,
    };
  }

  async login(credentials?: { username: string; password: string }): Promise<AuthState> {
    if (!credentials) throw new Error('Credentials required');

    const settings = await this.storage.getSettings();
    const tokenUrl = settings.ssoTokenUrl ?? this.getDefaultTokenUrl(settings);

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: settings.ssoClientId,
      username: credentials.username,
      password: credentials.password,
      scope: 'openid profile email',
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error_description ?? err.error ?? `Authentication failed (${resp.status})`);
    }

    const tokenData = await resp.json() as OAuthTokenResponse;
    const user = await this.fetchUserProfile(tokenData.access_token, settings);
    const expiresAt = Date.now() + tokenData.expires_in * 1000;

    await this.storage.setAuthData({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      user,
    });

    return { isAuthenticated: true, accessToken: tokenData.access_token, expiresAt, user };
  }

  async logout(): Promise<void> {
    await this.storage.clearAuthData();
  }

  async refreshIfNeeded(): Promise<void> {
    const data = await this.storage.getAuthData();
    const expiresAt = data.expiresAt as number | undefined;

    if (!expiresAt || !data.refreshToken) return;
    if (Date.now() < expiresAt - TOKEN_REFRESH_BUFFER_MS) return;

    try {
      const settings = await this.storage.getSettings();
      const tokenData = await this.refreshToken(data.refreshToken as string, settings);
      const newExpiresAt = Date.now() + tokenData.expires_in * 1000;
      await this.storage.setAuthData({
        ...data,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? data.refreshToken,
        expiresAt: newExpiresAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isPermanent = PERMANENT_REFRESH_ERRORS.some((code) => message.includes(code));
      // Only clear credentials on permanent errors; let transient network failures retry next alarm
      if (isPermanent) {
        await this.storage.clearAuthData();
      }
    }
  }


  private getDefaultTokenUrl(settings: ExtensionSettings): string {
    const issuer = this.resolveKeycloakIssuer(settings);
    return `${issuer}/protocol/openid-connect/token`;
  }

  private resolveKeycloakIssuer(settings: ExtensionSettings): string {
    const explicit = settings.ssoKeycloakIssuer?.trim();
    if (explicit) return explicit.replace(/\/$/, '');

    const apiUrl = settings.apiEndpoint?.trim();
    if (!apiUrl) throw new Error('ACP Server URL must be configured in Settings');

    try {
      const url = new URL(apiUrl);
      const host = url.hostname;
      const base = host.replace(/^ambient-api-server-/, 'keycloak-');
      return `${url.protocol}//${base}/realms/ambient-code`;
    } catch {
      throw new Error('Invalid ACP Server URL — cannot derive Keycloak issuer');
    }
  }

  private async refreshToken(
    refreshToken: string,
    settings: ExtensionSettings,
  ): Promise<OAuthTokenResponse> {
    const tokenUrl = settings.ssoTokenUrl ?? this.getDefaultTokenUrl(settings);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: settings.ssoClientId,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      // Parse error code for permanent-vs-transient detection
      let errorCode = '';
      try {
        errorCode = (JSON.parse(bodyText) as { error?: string }).error ?? '';
      } catch {
        // non-JSON response
      }
      throw new Error(`Token refresh failed (${response.status}): ${errorCode || bodyText}`);
    }

    return response.json() as Promise<OAuthTokenResponse>;
  }

  private async fetchUserProfile(
    accessToken: string,
    settings: ExtensionSettings,
  ): Promise<UserProfile> {
    const issuer = this.resolveKeycloakIssuer(settings);
    const userInfoUrl = `${issuer}/protocol/openid-connect/userinfo`;

    const response = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) throw new Error(`Failed to fetch user profile (${response.status})`);
    const data = (await response.json()) as Record<string, unknown>;

    return {
      id: (data.id ?? data.sub ?? '') as string,
      email: (data.mail ?? data.email ?? data.userPrincipalName ?? '') as string,
      displayName: (data.displayName ?? data.name ?? '') as string,
      // Azure photo requires a separate call; omit for now rather than returning a broken URL
      avatarUrl: settings.ssoProvider !== 'azure'
        ? ((data.picture ?? undefined) as string | undefined)
        : undefined,
      groups: (data.groups ?? []) as string[],
    };
  }

}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

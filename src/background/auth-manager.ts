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

  async login(): Promise<AuthState> {
    const settings = await this.storage.getSettings();
    const authUrl = await this.buildAuthUrl(settings);
    const redirectUrl = chrome.identity.getRedirectURL('oauth2');

    console.log('[AUTH] Auth URL:', authUrl);
    console.log('[AUTH] Redirect URL:', redirectUrl);
    console.log('[AUTH] Settings:', JSON.stringify({ ssoProvider: settings.ssoProvider, ssoClientId: settings.ssoClientId, apiEndpoint: settings.apiEndpoint, ssoKeycloakIssuer: settings.ssoKeycloakIssuer }));

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    if (!responseUrl) throw new Error('Authentication cancelled');

    const tokenData = await this.exchangeCodeForToken(responseUrl, redirectUrl, settings);
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

  private async buildAuthUrl(settings: ExtensionSettings): Promise<string> {
    const redirectUrl = chrome.identity.getRedirectURL('oauth2');
    const state = crypto.randomUUID();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    // Store PKCE values in session — cleared after exchange
    await chrome.storage.session.set({ oauth_state: state, code_verifier: codeVerifier });

    const params = new URLSearchParams({
      client_id: settings.ssoClientId,
      response_type: 'code',
      redirect_uri: redirectUrl,
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = settings.ssoAuthUrl ?? this.getDefaultAuthUrl(settings);
    return `${authUrl}?${params.toString()}`;
  }

  private getDefaultAuthUrl(settings: ExtensionSettings): string {
    switch (settings.ssoProvider) {
      case 'keycloak': {
        const issuer = this.resolveKeycloakIssuer(settings);
        return `${issuer}/protocol/openid-connect/auth`;
      }
      case 'azure':
        return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
      case 'okta': {
        const domain = this.resolveOktaDomain(settings);
        return `https://${domain}/oauth2/v1/authorize`;
      }
      case 'google':
        return 'https://accounts.google.com/o/oauth2/v2/auth';
      default:
        throw new Error('ssoAuthUrl must be configured for custom provider');
    }
  }

  private getDefaultTokenUrl(settings: ExtensionSettings): string {
    switch (settings.ssoProvider) {
      case 'keycloak': {
        const issuer = this.resolveKeycloakIssuer(settings);
        return `${issuer}/protocol/openid-connect/token`;
      }
      case 'azure':
        return 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      case 'okta': {
        const domain = this.resolveOktaDomain(settings);
        return `https://${domain}/oauth2/v1/token`;
      }
      case 'google':
        return 'https://oauth2.googleapis.com/token';
      default:
        throw new Error('ssoTokenUrl must be configured for custom provider');
    }
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

  /** Okta uses a subdomain (e.g. "mycompany") separate from the OAuth client_id. */
  private resolveOktaDomain(settings: ExtensionSettings): string {
    const domain = settings.ssoOktaDomain.trim();
    if (!domain) throw new Error('Okta organisation domain must be configured (ssoOktaDomain)');
    // Accept either "mycompany" or "mycompany.okta.com"
    return domain.includes('.') ? domain : `${domain}.okta.com`;
  }

  private async exchangeCodeForToken(
    responseUrl: string,
    redirectUrl: string,
    settings: ExtensionSettings,
  ): Promise<OAuthTokenResponse> {
    const url = new URL(responseUrl);

    // Surface IdP errors instead of passing an empty code to the token endpoint
    const errorCode = url.searchParams.get('error');
    if (errorCode) {
      const description = url.searchParams.get('error_description') ?? errorCode;
      throw new Error(`Authentication denied by IdP: ${description}`);
    }

    const code = url.searchParams.get('code');
    if (!code) throw new Error('No authorization code in redirect URL');

    const state = url.searchParams.get('state');
    const stored = await chrome.storage.session.get(['oauth_state', 'code_verifier']);
    await chrome.storage.session.remove(['oauth_state', 'code_verifier']);

    if (stored.oauth_state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack');
    }

    const tokenUrl = settings.ssoTokenUrl ?? this.getDefaultTokenUrl(settings);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: settings.ssoClientId,
      code,
      redirect_uri: redirectUrl,
      code_verifier: stored.code_verifier as string,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Token exchange failed (${response.status}): ${body}`);
    }

    return response.json() as Promise<OAuthTokenResponse>;
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
    let userInfoUrl: string;
    if (settings.ssoProvider === 'google') {
      userInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
    } else if (settings.ssoProvider === 'azure') {
      userInfoUrl = 'https://graph.microsoft.com/v1.0/me?$select=id,mail,displayName,userPrincipalName';
    } else if (settings.ssoProvider === 'okta') {
      const domain = this.resolveOktaDomain(settings);
      userInfoUrl = `https://${domain}/oauth2/v1/userinfo`;
    } else {
      // Custom OIDC — standard userinfo endpoint derived from authUrl
      const base = settings.ssoAuthUrl ?? '';
      userInfoUrl = base.replace(/\/authorize$/, '/userinfo');
    }

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

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

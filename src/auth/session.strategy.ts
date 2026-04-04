import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jose from 'jose';

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
}

/**
 * Session strategy that:
 * 1. Extracts the Next-Auth session cookie
 * 2. Decrypts it using shared AUTH_SECRET
 * 3. Extracts the access token from the decrypted payload
 * 4. Validates the access token against Authentik's JWKS
 */
@Injectable()
export class SessionStrategy extends PassportStrategy(Strategy, 'session') {
  private readonly authSecret: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly cookieName: string;
  private jwks: jose.JWTVerifyGetKey | null = null;

  constructor(private configService: ConfigService) {
    super();

    const authSecret = configService.get<string>('AUTH_SECRET');
    if (!authSecret) {
      throw new Error('AUTH_SECRET environment variable is required');
    }
    this.authSecret = authSecret;

    const issuer = configService.get<string>('AUTHENTIK_ISSUER');
    if (!issuer) {
      throw new Error('AUTHENTIK_ISSUER environment variable is required');
    }
    this.issuer = issuer;

    this.audience = configService.get<string>('AUTHENTIK_CLIENT_ID') ?? '';
    this.cookieName = 'authjs.session-token';
  }

  private async getJWKS(): Promise<jose.JWTVerifyGetKey> {
    if (!this.jwks) {
      // Use OIDC discovery to find the correct JWKS URI
      const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
      const response = await fetch(discoveryUrl);
      if (!response.ok) {
        throw new Error(
          `OIDC discovery failed: ${response.status} ${response.statusText}`,
        );
      }
      const config = await response.json();
      const jwksUri = config.jwks_uri;
      if (!jwksUri) {
        throw new Error('No jwks_uri found in OIDC discovery document');
      }
      console.log(`[SessionStrategy] Discovered JWKS URI: ${jwksUri}`);
      this.jwks = jose.createRemoteJWKSet(new URL(jwksUri));
    }
    return this.jwks;
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name && rest.length > 0) {
        cookies[name] = rest.join('=');
      }
    });
    return cookies;
  }

  private async decryptSessionCookie(
    encryptedToken: string,
    cookieName: string,
  ): Promise<any> {
    try {
      // Derive encryption key the same way Auth.js v5 does
      const secret = new TextEncoder().encode(this.authSecret);
      const derivedKey = await this.deriveKey(secret, cookieName);

      const { payload } = await jose.jwtDecrypt(encryptedToken, derivedKey);
      return payload;
    } catch (error) {
      console.error('[SessionStrategy] Cookie decryption failed:', error);
      throw new UnauthorizedException('Invalid session cookie');
    }
  }

  private async deriveKey(
    secret: Uint8Array,
    salt: string,
  ): Promise<Uint8Array> {
    // Auth.js v5 uses HKDF to derive the encryption key with:
    //   hash: SHA-256
    //   ikm: AUTH_SECRET
    //   salt: cookie name (e.g. "authjs.session-token")
    //   info: "Auth.js Generated Encryption Key (<cookie name>)"
    //   keylen: 64 bytes (512 bits) for A256CBC-HS512
    const encoder = new TextEncoder();
    const info = encoder.encode(`Auth.js Generated Encryption Key (${salt})`);
    const saltBytes = encoder.encode(salt);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      secret.buffer.slice(
        secret.byteOffset,
        secret.byteOffset + secret.byteLength,
      ) as ArrayBuffer,
      'HKDF',
      false,
      ['deriveBits'],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBytes,
        info: info,
      },
      keyMaterial,
      512,
    );

    return new Uint8Array(derivedBits);
  }

  private async validateAccessToken(
    accessToken: string,
  ): Promise<jose.JWTPayload> {
    try {
      const jwks = await this.getJWKS();
      const { payload } = await jose.jwtVerify(accessToken, jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });
      return payload;
    } catch (error) {
      console.error('[SessionStrategy] Token validation failed:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async validate(request: Request): Promise<SessionUser> {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      throw new UnauthorizedException('No session cookie');
    }

    const cookies = this.parseCookies(cookieHeader);

    // Try both secure and non-secure cookie names
    const secureCookieName = `__Secure-${this.cookieName}`;
    let sessionCookie = cookies[secureCookieName];
    let usedCookieName = secureCookieName;

    if (!sessionCookie) {
      sessionCookie = cookies[this.cookieName];
      usedCookieName = this.cookieName;
    }

    if (!sessionCookie) {
      throw new UnauthorizedException('Session cookie not found');
    }

    // Decrypt the Auth.js session cookie (salt = cookie name used)
    const sessionPayload = await this.decryptSessionCookie(
      sessionCookie,
      usedCookieName,
    );

    const accessToken = sessionPayload.accessToken as string | undefined;
    if (!accessToken) {
      throw new UnauthorizedException('No access token in session');
    }

    // Validate the access token against Authentik's JWKS
    const tokenPayload = await this.validateAccessToken(accessToken);

    if (!tokenPayload.sub) {
      throw new UnauthorizedException('Invalid token: no subject');
    }

    return {
      sub: tokenPayload.sub,
      email: tokenPayload.email as string | undefined,
      name: tokenPayload.name as string | undefined,
      groups: tokenPayload.groups as string[] | undefined,
    };
  }
}

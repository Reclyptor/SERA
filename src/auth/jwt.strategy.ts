import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  groups?: string[];
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private configService: ConfigService) {
    const issuer = configService.get<string>('AUTHENTIK_ISSUER');

    if (!issuer) {
      throw new Error('AUTHENTIK_ISSUER environment variable is required');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: configService.get<string>('AUTHENTIK_CLIENT_ID'),
      issuer: issuer,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxAge: 600000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${issuer}jwks/`,
      }),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return payload;
  }
}

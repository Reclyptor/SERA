import { Injectable, Logger } from '@nestjs/common';
import { validateUrl } from '../../../tools/security/url-validator';
import { SecretRedactorService } from '../../redaction/secret-redactor.service';

const MAX_BODY_CHARS = 100 * 1024;
const TRUNCATE_MARKER = '\n…[truncated]';

export interface UrlResolveInput {
  url: string;
}

export interface UrlResolveResult {
  text: string;
}

@Injectable()
export class UrlReferenceResolver {
  readonly kind = 'url';
  private readonly logger = new Logger(UrlReferenceResolver.name);

  constructor(private readonly redactor: SecretRedactorService) {}

  async resolve(input: UrlResolveInput): Promise<UrlResolveResult> {
    const validation = await validateUrl(input.url);
    if (!validation.valid) {
      return { text: `[url ${input.url}: ${validation.error}]` };
    }
    try {
      const response = await fetch(input.url, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'manual',
      });
      const text = await response.text();
      const truncated =
        text.length > MAX_BODY_CHARS
          ? text.slice(0, MAX_BODY_CHARS) + TRUNCATE_MARKER
          : text;
      // Redact any secrets the fetched body may carry — these reach the model
      // prompt and persist into chat history. See SPEC §9.9.
      const safe = this.redactor.redact(truncated);
      return {
        text: `\`\`\` (url ${input.url} → ${response.status})\n${safe}\n\`\`\``,
      };
    } catch (err) {
      this.logger.warn(`URL resolve failed for ${input.url}: ${String(err)}`);
      return { text: `[url ${input.url}: ${(err as Error).message}]` };
    }
  }
}

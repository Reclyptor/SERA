import { Inject, Injectable } from '@nestjs/common';
import {
  CONTEXT_ENGINE,
  type IContextEngine,
} from './engine/context-engine.interface';
import type { ContextPrepareInput, ContextPrepareResult } from './interfaces';

@Injectable()
export class ContextOrchestrationService {
  constructor(
    @Inject(CONTEXT_ENGINE) private readonly engine: IContextEngine,
  ) {}

  prepare(input: ContextPrepareInput): Promise<ContextPrepareResult> {
    return this.engine.prepare(input);
  }
}

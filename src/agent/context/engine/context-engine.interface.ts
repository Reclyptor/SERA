import type { ContextPrepareInput, ContextPrepareResult } from '../interfaces';

export const CONTEXT_ENGINE = Symbol('CONTEXT_ENGINE');

export interface IContextEngine {
  readonly name: string;
  prepare(input: ContextPrepareInput): Promise<ContextPrepareResult>;
}

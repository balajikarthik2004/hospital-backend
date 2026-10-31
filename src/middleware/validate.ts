import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { HttpError } from '../utils/helpers.js';

type Source = 'body' | 'query' | 'params';

/** Validates and replaces the given request segment with the parsed value. */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new HttpError(400, 'Validation failed', result.error.flatten().fieldErrors)
      );
    }
    if (source === 'body') req.body = result.data;
    else Object.defineProperty(req, source, { value: result.data, writable: true });
    next();
  };
}

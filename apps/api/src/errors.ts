import type { FastifyReply, FastifyRequest } from "fastify";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export function errorEnvelope(
  request: FastifyRequest,
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message, requestId: request.id } }
    : { error: { code, message, requestId: request.id, details } };
}

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return reply.code(statusCode).send(errorEnvelope(request, code, message, details));
}

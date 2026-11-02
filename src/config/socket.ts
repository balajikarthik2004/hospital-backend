import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export type SocketEvent =
  | 'vitals:recorded'
  | 'discharge:status-update'
  | 'discharge:flag-resolved'
  | 'discharge:approved'
  | 'discharge:completed'
  | 'bed:status-changed'
  | 'alert:critical-medication'
  | 'appointment:created'
  | 'prescription:new'
  | 'prescription:status-changed'
  | 'prescription:dispensed'
  | 'notification:general';

let io: IOServer | null = null;

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN === '*' ? true : env.CLIENT_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(); // allow anonymous read-only connections
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: string };
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
    } catch {
      /* ignore invalid token — connect anonymously */
    }
    next();
  });

  io.on('connection', (socket: Socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    if (socket.data.role) socket.join(`role:${socket.data.role}`);

    socket.on('subscribe', (room: string) => {
      if (typeof room === 'string' && room.length < 120) socket.join(room);
    });
    socket.on('unsubscribe', (room: string) => {
      if (typeof room === 'string') socket.leave(room);
    });
  });

  console.log('[socket] Socket.IO initialised');
  return io;
}

/** Broadcast to everyone (or to a room when `room` is given). */
export function emit(event: SocketEvent, payload: unknown, room?: string): void {
  if (!io) return;
  if (room) io.to(room).emit(event, payload);
  else io.emit(event, payload);
}

export function emitToUser(userId: string, event: SocketEvent, payload: unknown): void {
  emit(event, payload, `user:${userId}`);
}

export function emitToRole(role: string, event: SocketEvent, payload: unknown): void {
  emit(event, payload, `role:${role}`);
}

export function getIO(): IOServer | null {
  return io;
}

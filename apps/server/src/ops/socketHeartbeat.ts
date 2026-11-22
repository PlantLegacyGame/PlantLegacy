/**
 * Liveness for game sockets.
 *
 * A browser tab that dies without closing its socket - a crash, a killed
 * process, a laptop lid - leaves a connection this server still broadcasts to.
 * Nothing noticed: the peer stops reading, the kernel stops acknowledging, and
 * `bufferedAmount` grows until `writeIfHealthy` starts refusing to queue. The
 * dev log shows what that looks like from the inside: a 4.4 MB backlog on one
 * socket, `max_buffered_bytes` at 4 MB, and ~30,000 skipped sends, every tick,
 * forever. The socket never closes, and the world keeps paying for it.
 *
 * This is the standard `ws` pattern: ping every interval, clear the mark on any
 * pong, terminate whatever missed one. Kept pure so the rule is testable.
 */
export interface HeartbeatSocket {
  isAlive: boolean;
  ping(): void;
  terminate(): void;
}

/**
 * One sweep: terminate the sockets that missed the previous ping, ping the rest.
 * Returns the sockets that were terminated.
 */
export function heartbeatTick(sockets: Iterable<HeartbeatSocket>): HeartbeatSocket[] {
  const dead: HeartbeatSocket[] = [];
  for (const socket of sockets) {
    if (!socket.isAlive) {
      dead.push(socket);
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
      // A socket that cannot even be pinged is gone.
      dead.push(socket);
    }
  }
  return dead;
}

import koffi from 'koffi';

/**
 * Minimal cross-platform "is this socket readable?" check, used as the 3.6.2
 * fallback for GciTsNbPoll (which doesn't exist before 3.7). The GciTsNbResult
 * docs say: to avoid blocking, poll the fd from GciTsSocket to see whether a
 * non-blocking call's result is ready to read. This wraps the native poll
 * primitive for exactly that.
 *
 * Returns:
 *   1  — readable (a result is ready, or the socket has an error/hangup to read)
 *   0  — not readable within `timeoutMs`
 *  -1  — the poll could not be performed (no primitive, bad fd, or syscall error)
 */

// POSIX poll() events / Win32 WSAPoll() events. POLLRDNORM works for both.
const POLLRDNORM = 0x0100;
const POLLIN_POSIX = 0x0001;

type PollFn = (fd: number, timeoutMs: number) => number;

let pollFn: PollFn | null = null;
let initialized = false;

function initPoll(): void {
  if (initialized) return;
  initialized = true;
  try {
    if (process.platform === 'win32') {
      const ws2 = koffi.load('ws2_32.dll');
      // WSAPOLLFD { ULONG_PTR fd; SHORT events; SHORT revents; }
      koffi.struct('JasperWsaPollFd', {
        fd: 'uint64',
        events: 'int16',
        revents: 'int16',
      });
      const WSAPoll = ws2.func(
        'int __stdcall WSAPoll(_Inout_ JasperWsaPollFd *fdArray, unsigned long fds, int timeout)',
      );
      pollFn = (fd, timeoutMs) => {
        const pfd = { fd: BigInt(fd), events: POLLRDNORM, revents: 0 };
        const n = WSAPoll(pfd, 1, timeoutMs);
        if (n < 0) return -1;
        if (n === 0) return 0;
        return pfd.revents !== 0 ? 1 : 0;
      };
    } else {
      const libc = koffi.load(process.platform === 'darwin' ? 'libSystem.dylib' : 'libc.so.6');
      // struct pollfd { int fd; short events; short revents; }
      koffi.struct('JasperPollFd', {
        fd: 'int',
        events: 'int16',
        revents: 'int16',
      });
      const poll = libc.func(
        'int poll(_Inout_ JasperPollFd *fds, unsigned long nfds, int timeout)',
      );
      pollFn = (fd, timeoutMs) => {
        const pfd = { fd, events: POLLIN_POSIX, revents: 0 };
        const n = poll(pfd, 1, timeoutMs);
        if (n < 0) return -1;
        if (n === 0) return 0;
        return pfd.revents !== 0 ? 1 : 0;
      };
    }
  } catch {
    pollFn = null;
  }
}

/** Returns 1 if `fd` is readable, 0 if not within `timeoutMs`, -1 on failure. */
export function pollReadable(fd: number, timeoutMs: number): number {
  if (fd < 0) return -1;
  initPoll();
  if (!pollFn) return -1;
  try {
    return pollFn(fd, timeoutMs);
  } catch {
    return -1;
  }
}

/** Test seam: forget any cached poll primitive so the next call re-initializes. */
export function __resetForTest(): void {
  pollFn = null;
  initialized = false;
}

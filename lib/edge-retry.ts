// The runner reaches the API through the public edge, which now and then fails a request the control plane never
// answered. Sent once more:
// - a connect timeout, for any method: the request never left the runner (the control plane logs nothing);
// - a read (GET) whose socket failed (a reset, a closed socket), or that the edge answered with an HTML page instead of
//   the control plane's JSON: reading twice changes nothing.
// A write that failed after leaving the runner may have reached the server, so it is not sent again.
// No imports: selftest runs this file without Playwright.
export async function fetchOnceMoreOnEdgeFailure(url: string, init: RequestInit): Promise<Response> {
  const isRead = (init.method ?? 'GET').toUpperCase() === 'GET'
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    if (!isConnectTimeout(error) && !isRead) {
      throw error
    }
    console.warn(`${describe(error)} on ${url}; sending once more`)
    return await fetch(url, init)
  }
  if (isRead && isEdgePage(res)) {
    await res.text()
    console.warn(`edge page ${res.status} on ${url}; sending once more`)
    return await fetch(url, init)
  }
  return res
}

// Node's fetch (undici) wraps the socket error: `TypeError: fetch failed` with the reason in `cause`.
export function isConnectTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const cause = (error as { cause?: { code?: string; name?: string } }).cause
  if (cause === undefined || cause === null) {
    return false
  }
  return cause.code === 'UND_ERR_CONNECT_TIMEOUT' || cause.name === 'ConnectTimeoutError'
}

// The control plane answers JSON or nothing; an HTML page on the API host is the edge speaking.
function isEdgePage(res: Response): boolean {
  const type = res.headers.get('Content-Type') ?? ''
  return type.toLowerCase().startsWith('text/html')
}

function describe(error: unknown): string {
  if (isConnectTimeout(error)) {
    return 'connect timeout'
  }
  const cause = (error as { cause?: { code?: string } } | null)?.cause
  if (cause !== undefined && cause !== null && cause.code !== undefined) {
    return cause.code
  }
  return String(error)
}

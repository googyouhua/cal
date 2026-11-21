const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ROOT = path.resolve(process.env.ROOT || '/var/www/hotword-asr-lab')
const PORT = Number(process.env.PORT || 8080)
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 0)
const HTTPS_CERT = process.env.HTTPS_CERT || ''
const HTTPS_KEY = process.env.HTTPS_KEY || ''
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map'])

function resolveFile(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const relative = decoded === '/' ? '/index.html' : decoded
  const full = path.resolve(ROOT, '.' + relative)
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null
  return full
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(body)
}

function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
  }

  const file = resolveFile(req.url || '/')
  if (!file) return send(res, 400, 'Bad Request')

  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return send(res, 404, 'Not Found')
  }
  if (stat.isDirectory()) return send(res, 404, 'Not Found')

  const ext = path.extname(file).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const longLived =
    file.startsWith(path.join(ROOT, 'assets') + path.sep) ||
    file.startsWith(path.join(ROOT, 'ort') + path.sep) ||
    file.startsWith(path.join(ROOT, 'voice') + path.sep) ||
    /sherpa-onnx|silero_vad/.test(path.basename(file))

  const headers = {
    'Content-Type': type,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': longLived ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  }

  const gzip =
    COMPRESSIBLE.has(ext) &&
    stat.size > 1024 &&
    /\bgzip\b/.test(req.headers['accept-encoding'] || '')

  headers['Accept-Ranges'] = 'bytes'

  const range = req.headers.range
  if (!gzip && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      let start = match[1] === '' ? null : Number(match[1])
      let end = match[2] === '' ? null : Number(match[2])
      if (start === null && end !== null) {
        start = Math.max(0, stat.size - end)
        end = stat.size - 1
      }
      if (start !== null && end === null) end = stat.size - 1
      if (start !== null && start < stat.size && start <= end) {
        end = Math.min(end, stat.size - 1)
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1,
        })
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(file, { start, end }).pipe(res)
        return
      }
      return send(res, 416, 'Range Not Satisfiable', {
        'Content-Range': `bytes */${stat.size}`,
      })
    }
  }

  if (gzip) headers['Content-Encoding'] = 'gzip'
  if (!gzip) headers['Content-Length'] = stat.size

  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()

  const stream = fs.createReadStream(file)
  if (gzip) {
    stream.pipe(zlib.createGzip({ level: 6 })).pipe(res)
  } else {
    stream.pipe(res)
  }
  stream.on('error', () => res.destroy())
}

http.createServer(handleRequest).listen(PORT, HOST, () => {
  console.log(`hotword-asr-lab serving ${ROOT} on http://${HOST}:${PORT}`)
})

if (HTTPS_PORT && HTTPS_CERT && HTTPS_KEY) {
  https
    .createServer(
      { cert: fs.readFileSync(HTTPS_CERT), key: fs.readFileSync(HTTPS_KEY) },
      handleRequest,
    )
    .listen(HTTPS_PORT, HOST, () => {
      console.log(`hotword-asr-lab serving ${ROOT} on https://${HOST}:${HTTPS_PORT}`)
    })
}

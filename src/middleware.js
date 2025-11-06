import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';

/**
 * Cria um rate limiter com configuração padrão
 * @param {number} windowMs - Janela de tempo em milissegundos
 * @param {number} max - Número máximo de requisições
 * @param {string} errorMessage - Mensagem de erro
 * @param {Function} skipFn - Função para pular rate limiting (opcional)
 * @returns {RateLimitMiddleware}
 */
function createRateLimiter(windowMs, max, errorMessage, skipFn = null) {
  const config = {
    windowMs,
    max,
    message: { error: errorMessage },
    standardHeaders: true,
    legacyHeaders: false
  };

  if (skipFn) {
    config.skip = skipFn;
  }

  return rateLimit(config);
}

/**
 * Configuração do rate limiter geral
 * Limita requisições por IP para prevenir abuso
 */
export const generalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutos
  100,
  'Muitas requisições deste IP, tente novamente em 15 minutos',
  (req) => req.path === '/api/health' // Skip de rate limiting para health checks
);

/**
 * Rate limiter mais restritivo para parse de URLs
 * Previne abuso da API do YouTube
 */
export const parseApiLimiter = createRateLimiter(
  5 * 60 * 1000, // 5 minutos
  20,
  'Limite de análises excedido. Aguarde 5 minutos'
);

/**
 * Rate limiter para downloads individuais
 */
export const downloadLimiter = createRateLimiter(
  10 * 60 * 1000, // 10 minutos
  50,
  'Limite de downloads excedido. Aguarde 10 minutos'
);

/**
 * Rate limiter mais restritivo para downloads em lote
 */
export const batchDownloadLimiter = createRateLimiter(
  30 * 60 * 1000, // 30 minutos
  5,
  'Limite de downloads em lote excedido. Aguarde 30 minutos'
);

/**
 * Configuração do Helmet para headers de segurança HTTP
 */
export function setupHelmet(app) {
  app.use(helmet({
    // Configuração de Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "http:"], // Permite thumbnails do YouTube
        scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline necessário para scripts inline
        connectSrc: ["'self'"]
      }
    },
    // Previne clickjacking
    frameguard: {
      action: 'deny'
    },
    // Força HTTPS em produção
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    // Previne MIME type sniffing
    noSniff: true,
    // Desabilita X-Powered-By header
    hidePoweredBy: true,
    // Previne XSS
    xssFilter: true
  }));
}

/**
 * Configuração do CORS
 * @param {string} allowedOrigins - String com origens permitidas separadas por vírgula
 */
export function setupCors(allowedOrigins) {
  const origins = allowedOrigins ? allowedOrigins.split(',').map(o => o.trim()) : '*';

  return cors({
    origin: origins === '*' ? '*' : (origin, callback) => {
      // Permite requisições sem origem (mobile apps, Postman, etc)
      if (!origin) return callback(null, true);

      if (origins.includes(origin) || origins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Origem não permitida pelo CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
}

/**
 * Middleware centralizado de tratamento de erros
 */
export function errorHandler(err, req, res, next) {
  // Log do erro no servidor
  console.error('[Error Handler]', {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Erro de CORS
  if (err.message === 'Origem não permitida pelo CORS') {
    return res.status(403).json({
      error: 'Acesso negado: origem não permitida'
    });
  }

  // Erro de rate limit
  if (err.status === 429) {
    return res.status(429).json({
      error: err.message || 'Muitas requisições'
    });
  }

  // Erro de validação/bad request
  if (err.status === 400 || err.statusCode === 400) {
    return res.status(400).json({
      error: err.message || 'Requisição inválida'
    });
  }

  // Erro de timeout
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
    return res.status(504).json({
      error: 'Tempo limite excedido'
    });
  }

  // Erro genérico (não expõe detalhes em produção)
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Erro interno do servidor'
    : err.message || 'Erro desconhecido';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * Middleware para capturar erros assíncronos
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware para log de requisições
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  // Log quando a resposta terminar
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });

  next();
}

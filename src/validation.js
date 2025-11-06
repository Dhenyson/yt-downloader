import validator from 'validator';

/**
 * Valida se uma URL é do YouTube e retorna informações sobre ela
 * @param {string} inputUrl - URL a ser validada
 * @returns {{valid: boolean, type: string, id: string|null, error: string|null}}
 */
export function validateYouTubeUrl(inputUrl) {
  // Validação básica de URL
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, type: 'unknown', id: null, error: 'URL inválida ou ausente' };
  }

  // Limpa a URL
  const trimmed = inputUrl.trim();

  // Verifica se é uma URL válida
  if (!validator.isURL(trimmed, {
    protocols: ['http', 'https'],
    require_protocol: false
  })) {
    return { valid: false, type: 'unknown', id: null, error: 'Formato de URL inválido' };
  }

  // Adiciona protocolo se não existir
  const urlWithProtocol = trimmed.match(/^https?:\/\//) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(urlWithProtocol);

    // Lista de hostnames válidos do YouTube
    const validHosts = [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be'
    ];

    // Verifica se o hostname é válido
    if (!validHosts.includes(url.hostname)) {
      return { valid: false, type: 'unknown', id: null, error: 'URL não é do YouTube' };
    }

    // Extrai ID de playlist
    const listParam = url.searchParams.get('list');
    if (listParam && /^[a-zA-Z0-9_-]+$/.test(listParam)) {
      return { valid: true, type: 'playlist', id: listParam, error: null };
    }

    // Extrai ID de vídeo do parâmetro 'v'
    const vParam = url.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return { valid: true, type: 'video', id: vParam, error: null };
    }

    // Extrai ID de vídeo do path (youtu.be)
    if (url.hostname === 'youtu.be') {
      const pathId = url.pathname.slice(1).split('/')[0];
      if (pathId && /^[a-zA-Z0-9_-]{11}$/.test(pathId)) {
        return { valid: true, type: 'video', id: pathId, error: null };
      }
    }

    // Extrai ID de vídeo do path (/watch, /v/, /embed/)
    const pathMatch = url.pathname.match(/^\/(?:watch|v|embed)\/([a-zA-Z0-9_-]{11})/);
    if (pathMatch) {
      return { valid: true, type: 'video', id: pathMatch[1], error: null };
    }

    return { valid: false, type: 'unknown', id: null, error: 'URL do YouTube não contém ID de vídeo ou playlist válido' };

  } catch (error) {
    return { valid: false, type: 'unknown', id: null, error: 'Falha ao processar URL' };
  }
}

/**
 * Sanitiza um nome de arquivo removendo caracteres perigosos
 * e prevenindo path traversal
 * @param {string} name - Nome do arquivo a ser sanitizado
 * @returns {string} Nome sanitizado
 */
export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') {
    return 'download';
  }

  // Remove null bytes
  let sanitized = name.replace(/\0/g, '');

  // Previne path traversal
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(/[\/\\]/g, '_');

  // Remove caracteres perigosos do sistema de arquivos
  sanitized = sanitized.replace(/[\/:*?"<>|\n\r\t\x00-\x1f\x80-\x9f]/g, '_');

  // Remove espaços múltiplos
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Limita o tamanho do nome (muitos sistemas têm limite de 255 bytes)
  if (sanitized.length > 140) {
    sanitized = sanitized.slice(0, 140);
  }

  // Garante que não seja vazio ou apenas pontos
  if (!sanitized || /^\.+$/.test(sanitized)) {
    return 'download';
  }

  // Remove pontos no início e fim
  sanitized = sanitized.replace(/^\.+|\.+$/g, '');

  return sanitized || 'download';
}

/**
 * Valida o modo de download
 * @param {string} mode - Modo a ser validado
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateDownloadMode(mode) {
  const validModes = ['video', 'audio'];

  if (!mode || typeof mode !== 'string') {
    return { valid: false, error: 'Modo de download ausente' };
  }

  if (!validModes.includes(mode)) {
    return { valid: false, error: `Modo inválido. Use: ${validModes.join(', ')}` };
  }

  return { valid: true, error: null };
}

/**
 * Valida um array de itens para download em lote
 * @param {Array} items - Array de itens a ser validado
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateBatchItems(items) {
  if (!Array.isArray(items)) {
    return { valid: false, error: 'Items deve ser um array' };
  }

  if (items.length === 0) {
    return { valid: false, error: 'Array de items não pode estar vazio' };
  }

  if (items.length > 100) {
    return { valid: false, error: 'Máximo de 100 itens por lote' };
  }

  // Valida cada item
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { valid: false, error: 'Item inválido no array' };
    }

    if (!item.id || typeof item.id !== 'string') {
      return { valid: false, error: 'Item sem ID válido' };
    }

    // Valida formato do ID do vídeo
    if (!/^[a-zA-Z0-9_-]{11}$/.test(item.id)) {
      return { valid: false, error: `ID de vídeo inválido: ${item.id}` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Codifica valor de header seguindo RFC5987
 * @param {string} str - String a ser codificada
 * @returns {string} String codificada
 */
export function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (match, p1) => `%${p1.toUpperCase()}`);
}

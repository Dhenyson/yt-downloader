import { rmSync } from 'node:fs';

/**
 * Limpa um diretório de forma segura, tratando erros
 * @param {string} dir - Caminho do diretório a ser removido
 * @param {string} context - Contexto para log de erro (opcional)
 */
export function cleanupDirectory(dir, context = 'diretório') {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Erro ao limpar ${context}:`, err);
  }
}

/**
 * Remove um arquivo de forma segura, tratando erros
 * @param {string} filePath - Caminho do arquivo a ser removido
 */
export function cleanupFile(filePath) {
  try {
    rmSync(filePath, { force: true });
  } catch (err) {
    console.error('Erro ao remover arquivo:', err);
  }
}

/**
 * Configura handlers padrão para stream de leitura com cleanup
 * @param {ReadStream} readStream - Stream de leitura
 * @param {string} sessionDir - Diretório a ser limpo
 * @param {Function} onError - Callback adicional de erro (opcional)
 */
export function setupStreamCleanup(readStream, sessionDir, onError = null) {
  readStream.on('error', (err) => {
    console.error('Erro ao ler arquivo:', err);
    cleanupDirectory(sessionDir, 'diretório');
    if (typeof onError === 'function') {
      onError(err);
    }
  });

  readStream.on('close', () => {
    cleanupDirectory(sessionDir, 'diretório após envio');
  });
}

/**
 * Retorna uma resposta de erro de validação padronizada
 * @param {Response} res - Objeto de resposta Express
 * @param {string} message - Mensagem de erro
 * @returns {Response} Resposta de erro
 */
export function sendValidationError(res, message) {
  return res.status(400).json({ error: message });
}

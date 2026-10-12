export function apiAddress(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('Endereço da API inválido.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS para conectar à VPS. HTTP só é permitido em localhost.');
  }
  return url.href.replace(/\/$/, '');
}
export function rubAddress(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Endereço do RUB inválido.');
  return url;
}
export function targetAddress(base, caminho) {
  if (typeof caminho !== 'string' || !caminho.startsWith('/') || caminho.startsWith('//') || caminho.includes('\\')) throw new Error('Caminho de rotina inválido.');
  const url = new URL(caminho, base);
  if (url.origin !== base.origin) throw new Error('A rotina precisa estar no endereço do RUB configurado localmente.');
  return url.href;
}
export function template(value, day) {
  return String(value || '').replaceAll('{{data}}', day).replaceAll('{{dataBR}}', day.split('-').reverse().join('/'));
}
export function configFromEnv(env = process.env) {
  const config = { api: apiAddress(env.FLASHUB_API), chave: env.FLASHUB_KEY, id: env.FLASHUB_AGENT_ID,
    rub: rubAddress(env.RUB_URL), user: env.RUB_USER, pass: env.RUB_PASS,
    channel: env.FLASHUB_BROWSER || 'msedge' };
  if (!/^flh_[a-f0-9]{64}$/.test(config.chave || '')) throw new Error('Cole uma chave válida gerada no Flashub.');
  if (!/^[a-f0-9-]{36}$/.test(config.id || '') || !config.user || !config.pass) throw new Error('Preencha a identificação e as credenciais do RUB.');
  if (!['msedge', 'chrome'].includes(config.channel)) throw new Error('Navegador inválido.');
  return config;
}

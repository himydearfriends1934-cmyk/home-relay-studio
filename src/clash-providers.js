import yaml from 'js-yaml';
import { isPlainObject, normalizeName } from './utils.js';

const MAX_PROVIDER_DEPTH = 2;
const FETCH_TIMEOUT_MS = 15_000;

export async function expandClashProxyProviders(content, options = {}) {
  return expandClashProxyProvidersInner(content, {
    baseUrl: options.baseUrl || '',
    headers: options.headers || {},
    fetchText: options.fetchText || defaultFetchText,
    depth: Number.isInteger(options.depth) ? options.depth : 0,
  });
}

async function expandClashProxyProvidersInner(content, options) {
  const text = String(content ?? '');
  if (options.depth >= MAX_PROVIDER_DEPTH) {
    return { content: text, expanded: false, warnings: [] };
  }

  const root = parseYamlObject(text);
  if (!hasClashProviders(root)) {
    return { content: text, expanded: false, warnings: [] };
  }

  const providers = collectProviders(root['proxy-providers']);
  if (providers.length === 0) {
    return { content: text, expanded: false, warnings: [] };
  }

  const proxies = Array.isArray(root.proxies) ? root.proxies.filter(isPlainObject).slice() : [];
  const warnings = [];
  let fetchedProviderProxies = 0;

  for (const provider of providers) {
    const providerUrl = resolveProviderUrl(provider.url, options.baseUrl);
    if (!providerUrl) {
      warnings.push(`Skipped provider "${provider.name}" because its URL is invalid.`);
      continue;
    }

    try {
      const providerContent = await options.fetchText(providerUrl, options.headers);
      const nested = await expandClashProxyProvidersInner(providerContent, {
        ...options,
        baseUrl: providerUrl,
        depth: options.depth + 1,
      });
      warnings.push(...nested.warnings);
      const providerRoot = parseYamlObject(nested.content);
      const providerProxies = Array.isArray(providerRoot?.proxies) ? providerRoot.proxies : [];
      if (providerProxies.length === 0) {
        warnings.push(`Skipped provider "${provider.name}" because it did not expose a proxies list.`);
        continue;
      }
      const normalizedProviderProxies = providerProxies.filter(isPlainObject);
      fetchedProviderProxies += normalizedProviderProxies.length;
      proxies.push(...normalizedProviderProxies);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Skipped provider "${provider.name}" because it could not be fetched: ${message}`);
    }
  }

  if (fetchedProviderProxies === 0) {
    return { content: text, expanded: false, warnings };
  }

  return {
    content: yaml.dump({ proxies }, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    }),
    expanded: true,
    warnings,
  };
}

function hasClashProviders(root) {
  return isPlainObject(root) && isPlainObject(root['proxy-providers']) && Object.keys(root['proxy-providers']).length > 0;
}

function collectProviders(value) {
  if (!isPlainObject(value)) return [];
  return Object.entries(value)
    .map(([name, provider]) => ({
      name: normalizeName(name),
      url: normalizeName(provider?.url || ''),
    }))
    .filter((provider) => provider.url);
}

function resolveProviderUrl(providerUrl, baseUrl) {
  try {
    return new URL(providerUrl, baseUrl || 'http://127.0.0.1').toString();
  } catch {
    return '';
  }
}

function parseYamlObject(text) {
  try {
    const parsed = yaml.load(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function defaultFetchText(url, headers) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'HomeRelayStudio/0.1',
      ...(headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching provider.`);
  }
  return response.text();
}

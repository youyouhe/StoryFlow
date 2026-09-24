/**
 * Provider registry + capability binding resolution (P4).
 *
 * Resolution rules (Hypit's routing law):
 *  - a binding names exactly one endpoint for a capability;
 *  - a single unbound endpoint that offers the capability is auto-selected;
 *  - SEVERAL unbound endpoints offering one capability is an ERROR that names
 *    them — never a silent pick, never a fallback to another account;
 *  - a bound endpoint that does not offer the capability is an error.
 */
import type { CapabilityId, EndpointConfig, Provider, ProviderContext, RuntimeProfile } from './types';

export class BindingError extends Error {
  readonly candidates: string[];
  constructor(message: string, candidates: string[] = []) {
    super(message);
    this.name = 'BindingError';
    this.candidates = candidates;
  }
}

export interface ResolvedEndpoint {
  /** Instance name, e.g. 'minimax.cn'. */
  name: string;
  provider: Provider;
  config: EndpointConfig;
  credentialSlot?: string;
}

export type ProviderRegistry = Map<string, Provider>;

export const createRegistry = (providers: readonly Provider[]): ProviderRegistry => {
  const registry: ProviderRegistry = new Map();
  for (const p of providers) registry.set(p.id, p);
  return registry;
};

/** Endpoints (by instance name) whose provider offers the capability. */
export const capabilityCandidates = (
  registry: ProviderRegistry,
  profile: RuntimeProfile,
  capability: CapabilityId,
): string[] => {
  const out: string[] = [];
  for (const [name, spec] of Object.entries(profile.endpoints)) {
    const provider = registry.get(spec.use);
    if (provider?.capabilities.includes(capability)) out.push(name);
  }
  return out.sort();
};

/**
 * Resolve the one endpoint that serves a capability. Throws BindingError when
 * ambiguous (naming every candidate) or unbound/unavailable — the caller must
 * surface the reason, never retry elsewhere.
 */
export const resolveCapability = (
  registry: ProviderRegistry,
  profile: RuntimeProfile,
  capability: CapabilityId,
): ResolvedEndpoint => {
  const candidates = capabilityCandidates(registry, profile, capability);
  const bound = profile.bindings[capability];

  if (bound) {
    const spec = profile.endpoints[bound];
    if (!spec) {
      throw new BindingError(
        `能力 ${capability} 绑定了不存在的端点「${bound}」——请检查 storyflow.runtime.json`,
        candidates,
      );
    }
    const provider = registry.get(spec.use);
    if (!provider) {
      throw new BindingError(`端点「${bound}」引用了未注册的 Provider「${spec.use}」`, candidates);
    }
    if (!provider.capabilities.includes(capability)) {
      throw new BindingError(
        `端点「${bound}」(${provider.label}) 不提供能力 ${capability}——绑定无效，不会自动改道`,
        candidates,
      );
    }
    return { name: bound, provider, config: spec.config ?? {}, credentialSlot: spec.credential?.slot };
  }

  if (candidates.length === 1) {
    const name = candidates[0];
    const spec = profile.endpoints[name];
    const provider = registry.get(spec.use)!;
    return { name, provider, config: spec.config ?? {}, credentialSlot: spec.credential?.slot };
  }
  if (candidates.length === 0) {
    throw new BindingError(`没有端点提供能力 ${capability}——请在 storyflow.runtime.json 配置 endpoints`, []);
  }
  throw new BindingError(
    `能力 ${capability} 有多个可用端点（${candidates.join('、')}）但未绑定——请在 storyflow.runtime.json 的 bindings 里指定其一`,
    candidates,
  );
};

/** Build the provider's execution context (secret resolved from the store). */
export const contextFor = (
  resolved: ResolvedEndpoint,
  getCredential: (slot: string) => string | undefined,
): ProviderContext => ({
  config: resolved.config,
  apiKey: resolved.credentialSlot ? (getCredential(resolved.credentialSlot) ?? '') : '',
});

/** Registry + profile bundled for app surfaces (one resolve path everywhere). */
export interface ServiceHub {
  registry: ProviderRegistry;
  profile: RuntimeProfile;
  resolve: (capability: CapabilityId) => ResolvedEndpoint;
  context: (endpoint: ResolvedEndpoint) => ProviderContext;
}

export const createServiceHub = (
  registry: ProviderRegistry,
  profile: RuntimeProfile,
  getCredential: (slot: string) => string | undefined,
): ServiceHub => ({
  registry,
  profile,
  resolve: (capability) => resolveCapability(registry, profile, capability),
  context: (endpoint) => contextFor(endpoint, getCredential),
});

/**
 * Startup check "every route has a policy" (ADR-0001, ADR-0004; SR-AUTHZ-01): each route handler must name an
 * operation of the contract manifest, with the same HTTP method and path. A missing or mismatched operation stops
 * the application before it accepts requests — so no handler can borrow the policy of another operation.
 */
import { Inject, Injectable, RequestMethod, type OnApplicationBootstrap, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { AuthzManifest } from '@evia/contracts/authz';
import { OPERATION_ID } from '../../platform/http/operation-id.ts';
import { POLICY_SOURCE, type PolicySource } from './policy-source.ts';

export interface DiscoveredRoute {
  readonly handler: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string | undefined;
}

/** Joins controller and handler paths: '/', 'api/health' → '/api/health'. */
export function joinPath(...parts: readonly unknown[]): string {
  const joined = parts
    .flatMap((part) => (typeof part === 'string' ? part.split('/') : []))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

/** OpenAPI path template → Express route template: /work-orders/{workOrderId} → /work-orders/:workOrderId */
export const toRouteTemplate = (path: string): string => path.replace(/\{([^}]+)\}/g, ':$1');

export function routeProblems(routes: readonly DiscoveredRoute[], manifest: AuthzManifest): string[] {
  return routes.flatMap(({ handler, method, path, operationId = '' }) => {
    const where = `${handler} (${method} ${path})`;
    const operation = Object.hasOwn(manifest, operationId) ? manifest[operationId] : undefined;
    if (operation === undefined) return [`${where}: brak operationId z kontraktu z polityką x-evia-authz`];
    const expected = `${operation.method} ${toRouteTemplate(operation.path)}`;
    return expected === `${method} ${path}`
      ? []
      : [`${where}: operationId ${operationId} w kontrakcie to ${operation.method} ${operation.path}`];
  });
}

@Injectable()
export class RoutePolicyCheck implements OnApplicationBootstrap {
  readonly #discovery: DiscoveryService;
  readonly #scanner: MetadataScanner;
  readonly #reflector: Reflector;
  readonly #policies: PolicySource;

  constructor(
    @Inject(DiscoveryService) discovery: DiscoveryService,
    @Inject(MetadataScanner) scanner: MetadataScanner,
    @Inject(Reflector) reflector: Reflector,
    @Inject(POLICY_SOURCE) policies: PolicySource,
  ) {
    this.#discovery = discovery;
    this.#scanner = scanner;
    this.#reflector = reflector;
    this.#policies = policies;
  }

  routes(): DiscoveredRoute[] {
    return this.#discovery.getControllers().flatMap(({ instance, metatype }) => {
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      const controller = metatype as Type;
      const base: unknown = this.#reflector.get(PATH_METADATA, controller);
      return this.#scanner.getAllMethodNames(prototype).flatMap((name) => {
        const handler = prototype[name] as (...args: unknown[]) => unknown;
        const path: unknown = this.#reflector.get(PATH_METADATA, handler);
        if (path === undefined) return [];
        const method = this.#reflector.get<RequestMethod>(METHOD_METADATA, handler);
        return [
          {
            handler: `${controller.name}.${name}`,
            method: RequestMethod[method].toLowerCase(),
            path: joinPath(base, path),
            operationId: this.#reflector.get<string | undefined>(OPERATION_ID, handler),
          },
        ];
      });
    });
  }

  onApplicationBootstrap(): void {
    const problems = routeProblems(this.routes(), this.#policies.manifest);
    if (problems.length > 0) throw new Error(`Deny-by-default: trasy bez polityki z kontraktu:\n${problems.join('\n')}`);
  }
}

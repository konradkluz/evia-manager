/** Composition root (ADR-0001): platform first, then the modules. */
import { Module, type DynamicModule } from '@nestjs/common';
import { AuthorizationModule } from './modules/authorization/index.ts';
import { PlatformModule, type PlatformDependencies } from './platform/platform.module.ts';

@Module({})
export class AppModule {
  static register(dependencies: PlatformDependencies): DynamicModule {
    return { module: AppModule, imports: [PlatformModule.register(dependencies), AuthorizationModule] };
  }
}

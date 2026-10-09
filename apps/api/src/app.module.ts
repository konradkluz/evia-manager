/** Composition root (ADR-0001): platform first, then the modules. */
import { Module, type DynamicModule } from '@nestjs/common';
import { AuditModule } from './modules/audit/index.ts';
import { AuthorizationModule } from './modules/authorization/index.ts';
import { CatalogModule } from './modules/catalog/index.ts';
import { CustomersModule } from './modules/customers/index.ts';
import { IdentityModule } from './modules/identity/index.ts';
import { PartiesModule } from './modules/parties/index.ts';
import { ProceduresModule } from './modules/procedures/index.ts';
import { SitesModule } from './modules/sites/index.ts';
import { WorkOrdersModule } from './modules/work-orders/index.ts';
import { PlatformModule, type PlatformDependencies } from './platform/platform.module.ts';

@Module({})
export class AppModule {
  static register(dependencies: PlatformDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(dependencies),
        IdentityModule,
        CatalogModule,
        CustomersModule,
        PartiesModule,
        SitesModule,
        WorkOrdersModule,
        ProceduresModule,
        AuditModule,
        AuthorizationModule,
      ],
    };
  }
}

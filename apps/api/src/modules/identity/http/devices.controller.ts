/**
 * HTTP surface of the management of devices (EVM-095; W-15, W-17). The handlers contain no authorization - the global guard decides before they run (the
 * operation in the manifest, CSRF, the web channel, the role, the step-up); here only the call and the response. The answers are parsed with the schemas of the
 * contract in the service, so only the fields of the contract leave (SR-DATA-03).
 */
import type { AccountDeviceList, ManagedDeviceList, UserDevicesSummary } from '@evia/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { DeviceAdminService } from '../application/device-admin.service.ts';

function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

@Controller()
export class DevicesController {
  readonly #devices: DeviceAdminService;

  constructor(@Inject(DeviceAdminService) devices: DeviceAdminService) {
    this.#devices = devices;
  }

  @Get('/api/v1/account/devices')
  @OperationId('listAccountDevices')
  listAccountDevices(@Req() request: Request): Promise<AccountDeviceList> {
    return this.#devices.listOwn(requirePrincipal(request));
  }

  @Post('/api/v1/account/devices/:deviceId/logout')
  @OperationId('logoutAccountDevice')
  @HttpCode(204)
  async logoutAccountDevice(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.#devices.logoutOwn(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Get('/api/v1/devices')
  @OperationId('listDevices')
  listDevices(
    @Query() query: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ManagedDeviceList> {
    return this.#devices.list(requirePrincipal(request), query, webEventContext(request, response));
  }

  @Post('/api/v1/devices/:deviceId/logout')
  @OperationId('logoutDevice')
  @HttpCode(204)
  async logoutDevice(@Param() params: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#devices.logout(requirePrincipal(request), params, webEventContext(request, response));
  }

  @Post('/api/v1/devices/:deviceId/wipe')
  @OperationId('wipeDevice')
  @HttpCode(204)
  async wipeDevice(
    @Param() params: unknown,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.#devices.wipe(requirePrincipal(request), params, body, webEventContext(request, response));
  }

  @Get('/api/v1/users/:userId/devices/summary')
  @OperationId('getUserDevicesSummary')
  getUserDevicesSummary(
    @Param() params: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDevicesSummary> {
    return this.#devices.summary(requirePrincipal(request), params, webEventContext(request, response));
  }
}

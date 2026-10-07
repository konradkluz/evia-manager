/**
 * Consistency of the catalogue configuration (EVM-019 AC3; SR-INPUT-02): one pure check over the whole starting data
 * (service catalogue, process templates with stages, document kinds, work order templates with items and payment plans)
 * that runs in the quality gate. Every finding names the code of the element it concerns (`elementCode`), so a failure
 * reads "garage_full_process: payment shares sum to 90" and not "something is wrong". The database repeats what a CHECK
 * can say (code pattern, share range, vocabularies); what spans rows — the sum of shares, a stage's output document
 * kinds (an array column cannot be a foreign key), default parameters against their schema — only this check can.
 */
import { parseParameters, isParameterSetCode } from './parameter-sets.ts';
import {
  CONFIDENTIALITIES,
  MAX_LIST_ITEMS,
  PARTY_KINDS,
  SERVICE_CATEGORIES,
  SITE_TYPES,
  WAITING_ON,
  isConfigCode,
} from './vocabularies.ts';

export interface DocumentKindConfig {
  readonly code: string;
  readonly name: string;
  readonly confidentiality: string;
}

export interface ServiceItemConfig {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly parameterSetCode: string | null;
  /** Processes the item brings, in order. */
  readonly procedureTemplateCodes: readonly string[];
}

export interface StageConfig {
  readonly code: string;
  readonly name: string;
  readonly defaultWaitingOn: string | null;
  readonly defaultWaitingOnPartyKind: string | null;
  readonly outputDocumentKindCodes: readonly string[];
}

export interface ProcedureTemplateConfig {
  readonly code: string;
  readonly name: string;
  readonly stages: readonly StageConfig[];
}

export interface TemplateItemConfig {
  readonly serviceItemCode: string;
  readonly defaultQuantity: number;
  readonly defaultParameters: Readonly<Record<string, unknown>>;
}

export interface PaymentMilestoneConfig {
  readonly code: string;
  readonly name: string;
  readonly sharePercent: number;
  readonly invoiceHint: string;
  readonly paymentTermDays: number;
}

export interface WorkOrderTemplateConfig {
  readonly code: string;
  readonly name: string;
  readonly siteTypeHint: string | null;
  readonly items: readonly TemplateItemConfig[];
  readonly paymentMilestones: readonly PaymentMilestoneConfig[];
}

export interface CatalogConfig {
  readonly documentKinds: readonly DocumentKindConfig[];
  readonly serviceItems: readonly ServiceItemConfig[];
  readonly procedureTemplates: readonly ProcedureTemplateConfig[];
  readonly workOrderTemplates: readonly WorkOrderTemplateConfig[];
}

export interface ConsistencyIssue {
  /** The code of the element the finding concerns; nested elements are dotted (`dso_connection.power_of_attorney`). */
  readonly elementCode: string;
  /** Stable rule name, e.g. `payment_shares_sum`. */
  readonly rule: string;
  readonly detail: string;
}

/** The share of every payment plan must add up to this (domain-model.md: whole percent, 0–100; here 1–100 per milestone). */
export const PAYMENT_SHARES_TOTAL = 100;

class Findings {
  readonly issues: ConsistencyIssue[] = [];

  add(elementCode: string, rule: string, detail: string): void {
    this.issues.push({ elementCode, rule, detail });
  }

  /** The code pattern; the offending code itself is configuration, not user input, so it can be named. */
  code(elementCode: string, value: string): void {
    if (!isConfigCode(value)) this.add(elementCode, 'code_pattern', 'the code does not match ^[a-z][a-z0-9_]{1,63}$');
  }

  oneOf(elementCode: string, rule: string, value: string, allowed: readonly string[]): void {
    if (!allowed.includes(value)) this.add(elementCode, rule, `"${value}" is not an allowed value`);
  }

  duplicates(scope: string, codes: readonly string[]): void {
    const seen = new Set<string>();
    for (const code of codes) {
      if (seen.has(code)) this.add(code, 'duplicate_code', `the code is used twice in ${scope}`);
      seen.add(code);
    }
  }
}

function checkDocumentKinds(config: CatalogConfig, findings: Findings): void {
  for (const kind of config.documentKinds) {
    findings.code(kind.code, kind.code);
    findings.oneOf(kind.code, 'confidentiality', kind.confidentiality, CONFIDENTIALITIES);
  }
  findings.duplicates(
    'document_kinds',
    config.documentKinds.map((kind) => kind.code),
  );
}

function checkServiceItems(config: CatalogConfig, findings: Findings): void {
  const procedures = new Set(config.procedureTemplates.map((procedure) => procedure.code));
  for (const item of config.serviceItems) {
    findings.code(item.code, item.code);
    findings.oneOf(item.code, 'category', item.category, SERVICE_CATEGORIES);
    if (item.parameterSetCode !== null && !isParameterSetCode(item.parameterSetCode)) {
      findings.add(item.code, 'unknown_parameter_set', `parameterSetCode "${item.parameterSetCode}" has no schema in the code`);
    }
    for (const procedureCode of item.procedureTemplateCodes) {
      if (!procedures.has(procedureCode))
        findings.add(item.code, 'unknown_procedure_template', `"${procedureCode}" is not a process template`);
    }
  }
  findings.duplicates(
    'service_items',
    config.serviceItems.map((item) => item.code),
  );
}

function checkStage(procedureCode: string, stage: StageConfig, documentKinds: ReadonlySet<string>, findings: Findings): void {
  const element = `${procedureCode}.${stage.code}`;
  findings.code(element, stage.code);
  const { defaultWaitingOn: waitingOn, defaultWaitingOnPartyKind: partyKind } = stage;
  if (waitingOn !== null) findings.oneOf(element, 'default_waiting_on', waitingOn, WAITING_ON);
  if (partyKind !== null) findings.oneOf(element, 'party_kind', partyKind, PARTY_KINDS);
  if ((waitingOn === 'party') !== (partyKind !== null)) {
    findings.add(element, 'waiting_on_party_kind', 'a party kind is given exactly when the stage waits for a party');
  }
  for (const kind of stage.outputDocumentKindCodes) {
    if (!documentKinds.has(kind)) findings.add(element, 'unknown_document_kind', `output document kind "${kind}" does not exist`);
  }
}

function checkProcedureTemplates(config: CatalogConfig, findings: Findings): void {
  const documentKinds = new Set(config.documentKinds.map((kind) => kind.code));
  for (const procedure of config.procedureTemplates) {
    findings.code(procedure.code, procedure.code);
    if (procedure.stages.length === 0) findings.add(procedure.code, 'no_stages', 'a process template needs at least one stage');
    for (const stage of procedure.stages) checkStage(procedure.code, stage, documentKinds, findings);
    findings.duplicates(
      procedure.code,
      procedure.stages.map((stage) => stage.code),
    );
  }
  findings.duplicates(
    'procedure_templates',
    config.procedureTemplates.map((procedure) => procedure.code),
  );
}

function checkTemplateItem(
  templateCode: string,
  item: TemplateItemConfig,
  items: ReadonlyMap<string, ServiceItemConfig>,
  findings: Findings,
): void {
  const element = `${templateCode}.${item.serviceItemCode}`;
  const service = items.get(item.serviceItemCode);
  if (service === undefined) {
    findings.add(element, 'unknown_service_item', `"${item.serviceItemCode}" is not in the service catalogue`);
    return;
  }
  if (!Number.isInteger(item.defaultQuantity) || item.defaultQuantity < 1 || item.defaultQuantity > 100) {
    findings.add(element, 'default_quantity', 'the default quantity is a whole number from 1 to 100');
  }
  if (service.parameterSetCode === null) {
    if (Object.keys(item.defaultParameters).length > 0)
      findings.add(element, 'parameters_without_set', 'the item has no parameter set, so no default parameters');
    return;
  }
  const result = parseParameters(service.parameterSetCode, item.defaultParameters, 'defaults');
  if (!result.ok) {
    const where = result.issues.map((issue) => `${issue.path || '(value)'}: ${issue.code}`).join(', ');
    findings.add(element, 'invalid_default_parameters', where);
  }
}

function checkPaymentPlan(template: WorkOrderTemplateConfig, findings: Findings): void {
  for (const milestone of template.paymentMilestones) {
    const element = `${template.code}.${milestone.code}`;
    findings.code(element, milestone.code);
    if (!Number.isInteger(milestone.sharePercent) || milestone.sharePercent < 1 || milestone.sharePercent > PAYMENT_SHARES_TOTAL) {
      findings.add(element, 'share_percent_range', 'a share is a whole percent from 1 to 100');
    }
    if (!Number.isInteger(milestone.paymentTermDays) || milestone.paymentTermDays < 0 || milestone.paymentTermDays > 365) {
      findings.add(element, 'payment_term_days', 'the payment term is 0–365 days');
    }
  }
  findings.duplicates(
    template.code,
    template.paymentMilestones.map((milestone) => milestone.code),
  );
  const total = template.paymentMilestones.reduce((sum, milestone) => sum + milestone.sharePercent, 0);
  if (total !== PAYMENT_SHARES_TOTAL) {
    findings.add(template.code, 'payment_shares_sum', `the shares of the payment plan sum to ${total}, not ${PAYMENT_SHARES_TOTAL}`);
  }
}

function checkWorkOrderTemplates(config: CatalogConfig, findings: Findings): void {
  const items = new Map(config.serviceItems.map((item) => [item.code, item]));
  for (const template of config.workOrderTemplates) {
    findings.code(template.code, template.code);
    if (template.siteTypeHint !== null) findings.oneOf(template.code, 'site_type_hint', template.siteTypeHint, SITE_TYPES);
    for (const item of template.items) checkTemplateItem(template.code, item, items, findings);
    findings.duplicates(
      template.code,
      template.items.map((item) => item.serviceItemCode),
    );
    checkPaymentPlan(template, findings);
  }
  findings.duplicates(
    'work_order_templates',
    config.workOrderTemplates.map((template) => template.code),
  );
}

function checkSizes(config: CatalogConfig, findings: Findings): void {
  const lists: Array<[string, number]> = [
    ['document_kinds', config.documentKinds.length],
    ['service_items', config.serviceItems.length],
    ['procedure_templates', config.procedureTemplates.length],
    ['work_order_templates', config.workOrderTemplates.length],
  ];
  for (const [name, size] of lists) {
    if (size > MAX_LIST_ITEMS)
      findings.add(name, 'too_many_elements', `${size} elements, the API returns at most ${MAX_LIST_ITEMS} per list`);
  }
}

/** All findings of the configuration; empty means consistent. */
export function validateCatalogConfig(config: CatalogConfig): ConsistencyIssue[] {
  const findings = new Findings();
  checkDocumentKinds(config, findings);
  checkProcedureTemplates(config, findings);
  checkServiceItems(config, findings);
  checkWorkOrderTemplates(config, findings);
  checkSizes(config, findings);
  return findings.issues;
}

/** The test of the gate: throws one error that lists every finding with the code of its element. */
export class CatalogConfigError extends Error {
  readonly issues: readonly ConsistencyIssue[];

  constructor(issues: readonly ConsistencyIssue[]) {
    super(issues.map((issue) => `${issue.elementCode} [${issue.rule}]: ${issue.detail}`).join('\n'));
    this.name = 'CatalogConfigError';
    this.issues = issues;
  }
}

export function assertCatalogConfigConsistent(config: CatalogConfig): void {
  const issues = validateCatalogConfig(config);
  if (issues.length > 0) throw new CatalogConfigError(issues);
}

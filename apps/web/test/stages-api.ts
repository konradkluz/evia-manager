import type { ProcedureList, ProcedureStage } from '@evia/contracts';

/** Synthetic processes and stages of the order ZL-2026-0042 for the pickers "Etap" (EVM-048). */
const stage = (n: number, name: string): ProcedureStage => ({
  id: `01968f3e-0000-7000-8000-0000000f1${String(n).padStart(3, '0')}`,
  code: `stage_${String(n)}`,
  name,
  position: n,
  status: 'todo',
  dueDate: null,
  overdue: false,
  responsibleUser: null,
  waitingOn: null,
  waitingParty: null,
  waitingSince: null,
  waitingDays: null,
  blockedReason: null,
  startedAt: null,
  completedOn: null,
  version: 1,
});

export const STAGE_CONDITIONS = stage(1, 'Uzgodnienie warunków');
export const STAGE_AGREEMENT = stage(2, 'Umowa z OSD');
export const STAGE_INSTALLATION = stage(3, 'Montaż i uruchomienie');

export const STAGES = [STAGE_CONDITIONS, STAGE_AGREEMENT, STAGE_INSTALLATION] as const;

export function stageName(id: string | null | undefined): string | null {
  return STAGES.find((entry) => entry.id === id)?.name ?? null;
}

export const PROCEDURE_LIST: ProcedureList = {
  items: [
    {
      id: '01968f3e-0000-7000-8000-0000000a1001',
      code: 'osd',
      name: 'Uzgodnienia z OSD',
      position: 1,
      progress: { done: 0, total: 2 },
      stages: [STAGE_CONDITIONS, STAGE_AGREEMENT],
    },
    {
      id: '01968f3e-0000-7000-8000-0000000a1002',
      code: 'install',
      name: 'Instalacja',
      position: 2,
      progress: { done: 0, total: 1 },
      stages: [STAGE_INSTALLATION],
    },
  ],
  openStageCount: 3,
};

import type { DeviceState } from '@evia/contracts';
import { Clock } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { silenceOf, STATE_MARKERS, stateLabel, UNKNOWN_STATE_MARKER } from './device-view.ts';

/**
 * The state of a device as icon + word (never the colour alone; flows/16 → W-15, W-17, proposal P-14) and, for an active phone
 * silent for 3 days or more, "Brak kontaktu od N dni" with the clock (from 7 days: "Dane zleceń ukryte w telefonie").
 */
export function DeviceStateLabel({
  state,
  lastContactAt,
  now,
  showSilence = true,
}: {
  readonly state: DeviceState;
  readonly lastContactAt: string;
  readonly now: number;
  readonly showSilence?: boolean;
}) {
  const { t } = useTranslation();
  const marker = Object.hasOwn(STATE_MARKERS, state) ? STATE_MARKERS[state] : UNKNOWN_STATE_MARKER;
  const Icon = marker.icon;
  const silence = showSilence && state === 'active' ? silenceOf(lastContactAt, now) : null;
  return (
    <span className="flex flex-col gap-stack-xs">
      <span className="inline-flex items-center gap-inline-sm">
        <Icon aria-hidden="true" className={`size-icon-sm shrink-0 ${marker.tone}`} />
        {stateLabel(t, state)}
      </span>
      {silence === null ? null : (
        <span className="inline-flex items-center gap-inline-sm text-body-sm text-text-secondary">
          <Clock aria-hidden="true" className="size-icon-sm shrink-0 text-icon-secondary" />
          {silence.hidden
            ? `${t('devices.silence.days', { count: silence.days })} · ${t('devices.silence.hidden')}`
            : t('devices.silence.days', { count: silence.days })}
        </span>
      )}
    </span>
  );
}

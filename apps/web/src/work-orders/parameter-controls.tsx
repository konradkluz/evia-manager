import { RadioGroup, Select, TextField } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { PARAMETER_TEXT_MAX, type ParameterField } from '../i18n/parameter-fields.ts';
import {
  BOOLEAN_NO,
  BOOLEAN_YES,
  fieldsOf,
  type ParameterErrorCode,
  type ParameterErrors,
  type ParameterValues,
} from './scope-parameters.ts';

/**
 * The typed controls of the technical parameters of one set (EVM-035 AC4, ustalenie B2; SR-INPUT-01, SR-INPUT-02): yes / no as
 * radios, a list as a select with Polish labels, a number as a text field with its unit and a decimal keyboard, the two free
 * technical texts as short fields. Which fields exist is decided by the set of the item — the person cannot add a key. An optional
 * choice has "Nie określono" (the field is then absent from the request). The server validates again.
 */
export function ParameterControls({
  setCode,
  values,
  errors,
  disabled = false,
  onChange,
}: {
  readonly setCode: string | null;
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
  readonly disabled?: boolean;
  readonly onChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const errorText = (field: ParameterField, code: ParameterErrorCode | undefined): string | undefined => {
    switch (code) {
      case undefined:
        return undefined;
      case 'required':
        return t('workOrder.params.required');
      case 'number':
        return t('workOrder.params.number');
      case 'range':
        return t('workOrder.params.range', { max: field.kind === 'number' ? field.max : 0 });
      case 'phasesForAc':
        return t('workOrder.params.phasesForAc');
      case 'phasesForDc':
        return t('workOrder.params.phasesForDc');
    }
  };
  const labelOf = (field: ParameterField): string =>
    field.required ? field.label : t('workOrder.scopeAdd.optional', { label: field.label });

  return (
    <>
      {fieldsOf(setCode).map((field) => {
        const value = values[field.key] ?? '';
        const error = errorText(field, errors[field.key]);
        const errorProps = error === undefined ? {} : { error };
        switch (field.kind) {
          case 'boolean':
            return (
              <RadioGroup
                key={field.key}
                legend={labelOf(field)}
                value={value}
                disabled={disabled}
                options={[
                  { value: BOOLEAN_YES, label: t('workOrder.params.yes') },
                  { value: BOOLEAN_NO, label: t('workOrder.params.no') },
                  ...(field.required ? [] : [{ value: '', label: t('workOrder.params.unset') }]),
                ]}
                onChange={(next) => {
                  onChange(field.key, next);
                }}
                {...errorProps}
              />
            );
          case 'choice':
            return (
              <Select
                key={field.key}
                label={labelOf(field)}
                value={value}
                disabled={disabled}
                options={[
                  { value: '', label: field.required ? t('workOrder.params.choose') : t('workOrder.params.unset') },
                  ...field.options.map(([optionValue, label]) => ({ value: optionValue, label })),
                ]}
                onChange={(next) => {
                  onChange(field.key, next);
                }}
                {...errorProps}
              />
            );
          case 'phases':
            return (
              <Select
                key={field.key}
                label={labelOf(field)}
                value={value}
                disabled={disabled}
                options={[
                  { value: '', label: t('workOrder.params.unset') },
                  { value: '1', label: t('workOrder.params.phaseOne') },
                  { value: '3', label: t('workOrder.params.phaseThree') },
                ]}
                onChange={(next) => {
                  onChange(field.key, next);
                }}
                {...errorProps}
              />
            );
          case 'number':
            return (
              <TextField
                key={field.key}
                label={labelOf(field)}
                value={value}
                disabled={disabled}
                inputMode="decimal"
                suffix={field.unit}
                onChange={(event) => {
                  onChange(field.key, event.target.value);
                }}
                {...errorProps}
              />
            );
          case 'text':
            return (
              <TextField
                key={field.key}
                label={labelOf(field)}
                value={value}
                disabled={disabled}
                hint={t('workOrder.params.tooLong', { max: PARAMETER_TEXT_MAX })}
                onChange={(event) => {
                  onChange(field.key, event.target.value.slice(0, field.max));
                }}
                {...errorProps}
              />
            );
        }
      })}
    </>
  );
}

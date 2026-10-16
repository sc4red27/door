'use client';

import { useState } from 'react';
import { generateTerms } from '@/actions/admin';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Checkbox, Field, Input, Label } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { planTerms } from '@/lib/terms';

/**
 * Enter the first term once; every following term up to today is created
 * (spring "<year>-1" / fall "<year>-2"). The preview uses the same plan the
 * server recomputes on submit.
 */
export function TermGenerator({ existing, today }: { existing: string[]; today: string }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const filled = name && start && end;
  const plan = filled ? planTerms({ name, start_date: start, end_date: end }, today) : null;
  const terms = plan && 'terms' in plan ? plan.terms : [];
  const created = terms.filter((term) => !existing.includes(term.name)).length;

  return (
    <ActionForm action={generateTerms} className="grid gap-3">
      <Field label={t.admin.firstTerm} htmlFor="gen-name" hint={t.admin.firstTermHint}>
        <Input
          id="gen-name"
          name="name"
          required
          maxLength={7}
          placeholder="2024-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.admin.startDate} htmlFor="gen-start">
          <Input id="gen-start" name="start_date" type="date" required value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label={t.admin.endDate} htmlFor="gen-end">
          <Input id="gen-end" name="end_date" type="date" required value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="gen-current" name="set_current" defaultChecked />
        <Label htmlFor="gen-current">{t.admin.makeLatestCurrent}</Label>
      </div>

      {plan && 'error' in plan ? (
        <p className="text-sm text-destructive">{t.admin.termPlanErrors[plan.error]}</p>
      ) : null}
      {terms.length > 0 ? (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium text-heading">{fmt(t.admin.termPreview, { n: terms.length, created })}</p>
          <ul className="max-h-60 divide-y overflow-auto rounded-lg border text-sm" aria-label={t.admin.termPreviewLabel}>
            {terms.map((term, i) => (
              <li key={term.name} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="font-medium tabular-nums text-heading">{term.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {term.start_date} – {term.end_date}
                </span>
                {existing.includes(term.name) ? (
                  <Badge variant="secondary">{t.admin.termExists}</Badge>
                ) : i === terms.length - 1 ? (
                  <Badge>{t.admin.termLatest}</Badge>
                ) : (
                  <Badge variant="outline">{t.admin.termNew}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <SubmitButton disabled={terms.length === 0}>{fmt(t.admin.createTerms, { n: created })}</SubmitButton>
      </div>
    </ActionForm>
  );
}

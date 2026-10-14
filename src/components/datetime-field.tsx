'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/form';

/**
 * datetime-local has no timezone, so the browser converts the chosen local
 * time to an ISO instant and submits that in a hidden field.
 */
export function DateTimeField({ id, name, required }: { id: string; name: string; required?: boolean }) {
  const [iso, setIso] = useState('');
  return (
    <>
      <Input
        id={id}
        type="datetime-local"
        required={required}
        onChange={(event) => {
          const date = new Date(event.target.value);
          setIso(Number.isNaN(date.getTime()) ? '' : date.toISOString());
        }}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

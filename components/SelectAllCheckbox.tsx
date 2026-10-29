"use client";

import { useEffect, useRef, type ChangeEvent } from "react";

/**
 * "Select all on this page" for the /inbox bulk form. Ticks or clears every
 * `input[name="id"]` in the same form, and shows the mixed state when only some
 * are ticked. Without JavaScript it does nothing and each row's own checkbox still
 * works, so the bulk form degrades rather than breaks.
 */
export function SelectAllCheckbox({ formId }: { formId: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = document.getElementById(formId);
    const box = ref.current;
    if (!(form instanceof HTMLFormElement) || !box) return;
    const sync = () => {
      const all = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="id"]'));
      const ticked = all.filter((i) => i.checked).length;
      box.checked = all.length > 0 && ticked === all.length;
      box.indeterminate = ticked > 0 && ticked < all.length;
    };
    // Ignore this box's own change: the form listener runs before React's onChange
    // below and would otherwise undo the click before it is applied.
    const onFormChange = (event: Event) => {
      if (event.target !== box) sync();
    };
    sync();
    form.addEventListener("change", onFormChange);
    return () => form.removeEventListener("change", onFormChange);
  }, [formId]);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="id"]')) {
      input.checked = event.target.checked;
    }
    event.target.indeterminate = false;
  }

  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input
        ref={ref}
        type="checkbox"
        onChange={onChange}
        className="size-4 rounded border-slate-300 accent-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
      />
      Select all on this page
    </label>
  );
}

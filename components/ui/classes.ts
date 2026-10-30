// Shared class strings for plain <button>, <a> and <Link> controls in the triage UI,
// where the Button component (a <button> only) does not fit. Every one is at least
// 44px tall (min-h-11) with a visible focus ring.

export const BUTTON_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

/** Opens the delete confirm page: red outline, so it reads as different from Close and Archive. */
export const BUTTON_DANGER_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950";

/** The one button that actually deletes, on the confirm page. */
export const BUTTON_DANGER =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600";

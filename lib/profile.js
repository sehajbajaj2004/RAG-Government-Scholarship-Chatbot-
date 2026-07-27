// The four inputs (spec §3), exact enumerations. Shared by the form and the prompt
// builder so the options a user can pick and the values the server will accept can
// never drift apart.
//
// NFR-2: these four coarse values are the only user data that exists. Income is a
// band, never a figure. Nothing here is persisted server-side (INP-3).

export const COURSE_LEVELS = ['UG', 'PG', 'Professional'];

export const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS', 'PwD', 'Minority'];

// En dashes are intentional — these strings go verbatim into the prompt (§6.3).
export const INCOME_BANDS = ['<2L', '2–4L', '4–6L', '6–8L', '>8L'];

// `value` is what the prompt says; `label` is what the form shows.
export const STAGES = [
  { value: 'fresh', label: 'Just finished 12th (fresh)' },
  { value: 'renewal', label: 'Continuing student (renewal)' },
];

export const PROFILE_FIELDS = [
  { key: 'course_level', legend: 'Course level', options: COURSE_LEVELS },
  { key: 'category', legend: 'Category', options: CATEGORIES },
  { key: 'income_band', legend: 'Family income', options: INCOME_BANDS },
  {
    key: 'stage',
    legend: 'Stage',
    options: STAGES.map((s) => s.value),
    labels: Object.fromEntries(STAGES.map((s) => [s.value, s.label])),
  },
];

export const EMPTY_PROFILE = {
  course_level: '',
  category: '',
  income_band: '',
  stage: '',
};

/** INP-1/INP-2: all four required, each must be one of the allowed values. */
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return ['course_level', 'category', 'income_band', 'stage'];
  return PROFILE_FIELDS.filter((f) => !f.options.includes(profile[f.key])).map((f) => f.key);
}

export function isCompleteProfile(profile) {
  return validateProfile(profile).length === 0;
}

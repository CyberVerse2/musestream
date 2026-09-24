/** stream categories, shared by the server and the app */
export const CATEGORIES = ['Music', 'Art', 'Games', 'Food', 'IRL', 'Talk', 'Story'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Placeholder for the database types.
 * Replaced by the output of `pnpm db:types` (Supabase CLI) once the first migration exists
 * (ROADMAP 0.3). Do not edit by hand.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = Record<string, never>;
